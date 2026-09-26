import { describe, it, expect } from "vitest";
import { streamTune, type TuneRequest } from "../src/core/llm/client";
import { errorMessageKey, classifyNetworkFailure } from "../src/core/llm/errors";
import { createChatClient as createKitClient, type ChatClientOptions, type SseTransport } from "../src/vendor/kit-obsidian/chat-client";

const msgs = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }];
const ep = { url: "http://127.0.0.1:1234/v1/", apiKey: "k" };
const timeouts = { firstChunkSec: 60, idleSec: 120 };

/** Node hat kein `window`: eine Uhr ueber die globalen Timer (Kit-Vertrag: der Client bekommt sie injiziert). */
const nodeClock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};
const createChatClient = (o: Omit<ChatClientOptions, "clock">) => createKitClient({ ...o, clock: nodeClock });

interface Seen { url?: string; body?: Record<string, unknown>; headers?: Record<string, string> }

/** Fake-Transport im Kit-Vertrag: `onChunk` mit data:-Zeilen, aufgeloest mit dem Status. */
function fakeTransport(chunks: string[], status = 200, seen: Seen = {}): SseTransport {
  return {
    postStream: (url, body, headers, onChunk) => {
      seen.url = url; seen.body = body as Record<string, unknown>; seen.headers = headers;
      for (const c of chunks) onChunk(c);
      return Promise.resolve(status);
    },
  };
}
const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content: string, extra: Record<string, unknown> = {}): string => sse({ model: "m", choices: [{ delta: { content }, ...extra }] });
const DONE = "data: [DONE]\n\n";

function req(over: Partial<TuneRequest> = {}): TuneRequest {
  return { messages: msgs, endpoint: ep, model: "", sentModel: "", params: {}, timeouts, ...over };
}
const run = (t: SseTransport, over: Partial<TuneRequest> = {}) => streamTune(createChatClient({ transport: t }), req(over));

describe("streamTune", () => {
  it("sends the resolved params and the sent model, nothing legacy", async () => {
    const seen: Seen = {};
    await run(fakeTransport([delta("ok"), DONE], 200, seen), { model: "qwen/qwen3.8-27b", sentModel: "qwen/qwen3.8-27b@4bit", messages: [], params: { temperature: 0.2, top_p: 0.8, reasoning_effort: "none" } });
    expect(seen.body).toEqual({ model: "qwen/qwen3.8-27b@4bit", messages: [], stream: true, temperature: 0.2, top_p: 0.8, reasoning_effort: "none" });
  });

  it("baut URL und Auth-Header, Body traegt genau die uebergebenen Parameter", async () => {
    const seen: Seen = {};
    const r = await run(fakeTransport([delta("ok"), DONE], 200, seen), { model: "qwen", sentModel: "qwen", params: { temperature: 0.2, reasoning_effort: "none" } });
    expect(r).toMatchObject({ ok: true, text: "ok", reasoning: "", model: "m", truncated: false });
    expect(seen.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(seen.headers?.["Authorization"]).toBe("Bearer k");
    expect(seen.body).toMatchObject({ model: "qwen", stream: true, messages: msgs, reasoning_effort: "none" });
    expect(seen.body).not.toHaveProperty("chat_template_kwargs");
    expect(seen.body).not.toHaveProperty("reasoning_budget");
  });

  it("schickt keine Parameter, die nicht mitgegeben wurden", async () => {
    const seen: Seen = {};
    await run(fakeTransport([delta("ok"), DONE], 200, seen), { params: { temperature: 0.2 } });
    expect(seen.body).not.toHaveProperty("reasoning_effort");
  });

  it("trennt Inline-<think> in den Reasoning-Kanal und reicht Token durch", async () => {
    const tokens: string[] = [];
    const thoughts: string[] = [];
    const r = await run(fakeTransport([delta("<think>weil</think>Hal"), delta("lo"), DONE]), { onToken: (t) => tokens.push(t), onReasoning: (t) => thoughts.push(t) });
    expect(r).toMatchObject({ ok: true, text: "Hallo", reasoning: "weil" });
    expect(tokens.join("")).toBe("Hallo");
    expect(thoughts.join("")).toBe("weil");
  });

  it("meldet truncated bei finish_reason length, Ergebnis bleibt nutzbar", async () => {
    const r = await run(fakeTransport([delta("halb", { finish_reason: "length" }), DONE]));
    expect(r).toMatchObject({ ok: true, text: "halb", truncated: true, finishReason: "length" });
  });

  it("leerer Content mit Reasoning → thought-only; ganz leer → empty", async () => {
    const a = await run(fakeTransport([sse({ choices: [{ delta: { reasoning_content: "denk" } }] }), delta("  "), DONE]));
    expect(a).toMatchObject({ ok: false, error: { kind: "thought-only" }, reasoning: "denk" });
    const b = await run(fakeTransport([delta(""), DONE]));
    expect(b).toMatchObject({ ok: false, error: { kind: "empty" } });
  });

  it("abgeschnitten ohne Text bleibt thought-only bzw. empty — finishReason bleibt sichtbar", async () => {
    const r = await run(fakeTransport([sse({ choices: [{ delta: { reasoning_content: "denk" }, finish_reason: "length" }] }), DONE]));
    expect(r).toMatchObject({ ok: false, error: { kind: "thought-only" }, finishReason: "length" });
  });

  it("HTTP-Fehler traegt Status und Klartext aus dem Body", async () => {
    const r = await run(fakeTransport(['{"error":{"message":"Not authenticated"}}'], 401));
    expect(r).toMatchObject({ ok: false, error: { kind: "http", status: 401, detail: "Not authenticated" }, status: 401 });
  });

  it("Kontext-Ueberlauf wird wie ein HTTP-Fehler gemeldet", async () => {
    const r = await run(fakeTransport(['{"error":{"message":"maximum context length exceeded"}}'], 400));
    expect(r).toMatchObject({ ok: false, error: { kind: "http", status: 400 } });
  });

  it("Abbruch behaelt den Teiltext", async () => {
    const ctrl = new AbortController();
    const t: SseTransport = {
      postStream: (_u, _b, _h, onChunk, signal) => new Promise((_res, rej) => {
        onChunk(delta("teil"));
        signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
        ctrl.abort();
      }),
    };
    const r = await run(t, { signal: ctrl.signal });
    expect(r).toMatchObject({ ok: false, error: { kind: "aborted" }, partial: "teil" });
  });

  it("Netzfehler → network", async () => {
    const t: SseTransport = { postStream: () => Promise.reject(new Error("net")) };
    expect(await run(t)).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("Origin-Weigerung: der Client wiederholt einmal ohne Stream ueber den Fallback", async () => {
    const refuse: SseTransport = { postStream: () => { const e = new Error("refused"); e.name = "StreamNetworkError"; return Promise.reject(e); } };
    const full = fakeTransport([JSON.stringify({ model: "m", choices: [{ message: { content: "voll" }, finish_reason: "stop" }] })]);
    const r = await streamTune(createChatClient({ transport: refuse, fallbackTransport: full }), req());
    expect(r).toMatchObject({ ok: true, text: "voll" });
  });

  it("Timeout: Sekunden aus der Frist, die galt (vor dem ersten Chunk = timeoutSec)", async () => {
    const t: SseTransport = {
      postStream: (_u, _b, _h, _c, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); })),
    };
    const r = await streamTune(createChatClient({ transport: t, firstChunkTimeoutMs: 20, idleTimeoutMs: 20 }), req({ timeouts: { firstChunkSec: 7, idleSec: 120 } }));
    expect(r).toMatchObject({ ok: false, error: { kind: "timeout", seconds: 7 } });
  });

  it("liefert ttftMs, sobald ein Byte ankam (auch Reasoning)", async () => {
    const r = await run(fakeTransport([delta("ok"), DONE]));
    expect(r.ttftMs).toBeGreaterThanOrEqual(0);
  });
});

describe("errors", () => {
  it("errorMessageKey bildet i18n-Schluessel und Argumente", () => {
    expect(errorMessageKey({ kind: "http", status: 500, detail: "boom" })).toEqual({ key: "error.http", args: ["500", "boom"] });
    expect(errorMessageKey({ kind: "cors-suspected" })).toEqual({ key: "error.corsSuspected", args: [] });
    expect(errorMessageKey({ kind: "thought-only" }).key).toBe("error.thoughtOnly");
    expect(errorMessageKey({ kind: "timeout", seconds: 60 })).toEqual({ key: "error.timeout", args: ["60"] });
  });
  it("classifyNetworkFailure: Probe gruen + Stream rot = CORS-Verdacht", () => {
    expect(classifyNetworkFailure(true)).toEqual({ kind: "cors-suspected" });
    expect(classifyNetworkFailure(false)).toEqual({ kind: "network" });
  });
});
