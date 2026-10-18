import { describe, it, expect } from "vitest";
import { toTuneResult } from "../src/core/llm/client";
import { errorMessageKey, classifyNetworkFailure } from "../src/core/llm/errors";
import type { SseTransport } from "../src/vendor/kit-obsidian/chat-client";
import { DONE, delta, fakeTransport, makeConnection, sse, type Seen } from "./helpers/connection";

const msgs = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }];

interface RunOpts {
  settings?: Parameters<typeof makeConnection>[0]["settings"];
  fallback?: SseTransport;
  timeouts?: { idleMs?: number; firstChunkMs?: number };
  signal?: AbortSignal;
  onToken?: (t: string) => void;
  onReasoning?: (t: string) => void;
  messages?: typeof msgs;
}
/** Ein Tunen ueber die Verbindung des Plugins, dann die Uebersetzung in `TuneResult`. */
async function run(transport: SseTransport, o: RunOpts = {}) {
  const llm = makeConnection({ transport, ...(o.settings ? { settings: o.settings } : {}), ...(o.fallback ? { fallback: o.fallback } : {}), ...(o.timeouts ? { timeouts: o.timeouts } : {}) });
  const r = await llm.complete({ messages: o.messages ?? msgs }, {
    ...(o.signal ? { signal: o.signal } : {}), ...(o.onToken ? { onToken: o.onToken } : {}), ...(o.onReasoning ? { onReasoning: o.onReasoning } : {}),
  });
  return toTuneResult(r, r.source.shortcut);
}

describe("Tunen ueber die Verbindung", () => {
  it("sendet das aufgeloeste Modell und nichts Altes", async () => {
    const seen: Seen = {};
    await run(fakeTransport([delta("ok"), DONE], 200, seen), { settings: { model: "qwen/qwen3.8-27b" }, messages: [] });
    expect(seen.body).toMatchObject({ model: "qwen/qwen3.8-27b", messages: [], stream: true, temperature: 0.2 });
    expect(seen.body).not.toHaveProperty("chat_template_kwargs");
    expect(seen.body).not.toHaveProperty("reasoning_budget");
  });

  it("baut URL und Auth-Header; Ergebnis traegt Text, Modell des Servers und kein truncated", async () => {
    const seen: Seen = {};
    const r = await run(fakeTransport([delta("ok"), DONE], 200, seen));
    expect(r).toMatchObject({ ok: true, text: "ok", reasoning: "", model: "m", truncated: false });
    expect(seen.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(seen.headers?.["Authorization"]).toBe("Bearer k");
    expect(seen.body).toMatchObject({ model: "qwen", stream: true, messages: msgs });
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

  it("abgeschnitten ohne Text bleibt thought-only — finishReason bleibt sichtbar", async () => {
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

  it("Origin-Weigerung: die Verbindung wiederholt einmal ohne Stream ueber den Fallback", async () => {
    const refuse: SseTransport = { postStream: () => { const e = new Error("refused"); e.name = "StreamNetworkError"; return Promise.reject(e); } };
    const full = fakeTransport([JSON.stringify({ model: "m", choices: [{ message: { content: "voll" }, finish_reason: "stop" }] })]);
    const r = await run(refuse, { fallback: full });
    expect(r).toMatchObject({ ok: true, text: "voll" });
  });

  it("Timeout vor dem ersten Chunk nennt die Frist der Verbindung (600 s), danach die Leerlauf-Frist (120 s)", async () => {
    const t: SseTransport = {
      postStream: (_u, _b, _h, _c, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); })),
    };
    const r = await run(t, { timeouts: { firstChunkMs: 20, idleMs: 20 } });
    expect(r).toMatchObject({ ok: false, error: { kind: "timeout", seconds: 600 } });
    const later: SseTransport = {
      postStream: (_u, _b, _h, onChunk, signal) => new Promise((_res, rej) => { onChunk(sse({ choices: [{ delta: { reasoning_content: "x" } }] })); signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); }),
    };
    const r2 = await run(later, { timeouts: { firstChunkMs: 5_000, idleMs: 20 } });
    expect(r2).toMatchObject({ ok: false, error: { kind: "timeout", seconds: 120 } });
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
    expect(errorMessageKey({ kind: "transport-missing", text: "kein Transport" })).toEqual({ key: "error.transportMissing", args: ["kein Transport"] });
    expect(errorMessageKey({ kind: "thought-only" }).key).toBe("error.thoughtOnly");
    expect(errorMessageKey({ kind: "timeout", seconds: 60 })).toEqual({ key: "error.timeout", args: ["60"] });
  });
  it("classifyNetworkFailure: Probe gruen + Stream rot = CORS-Verdacht", () => {
    expect(classifyNetworkFailure(true)).toEqual({ kind: "cors-suspected" });
    expect(classifyNetworkFailure(false)).toEqual({ kind: "network" });
  });
});
