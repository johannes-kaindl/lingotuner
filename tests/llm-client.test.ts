import { describe, it, expect } from "vitest";
import { streamTune, StreamHttpError, type StreamTransport, type StreamOutcome } from "../src/core/llm/client";
import { errorMessageKey, classifyNetworkFailure } from "../src/core/llm/errors";

const msgs = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }];
const ep = { url: "http://127.0.0.1:1234/v1/", apiKey: "k" };

function fake(outcome: () => Promise<StreamOutcome>, seen: { url?: string; init?: { headers: Record<string, string>; body: string } } = {}): StreamTransport {
  return {
    stream: (url, init, onContent) => {
      seen.url = url; seen.init = init;
      return outcome().then((o) => { if (o.content) onContent(o.content); return o; });
    },
  };
}

describe("streamTune", () => {
  it("baut URL, Auth-Header und Body mit stream:true und Suppress-Parametern", async () => {
    const seen: { url?: string; init?: { headers: Record<string, string>; body: string } } = {};
    const t = fake(() => Promise.resolve({ content: "ok", reasoning: "", model: "m" }), seen);
    const r = await streamTune(t, { messages: msgs, endpoint: ep, model: "qwen", suppressThinking: true });
    expect(r).toEqual({ ok: true, text: "ok", reasoning: "", model: "m", truncated: false });
    expect(seen.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(seen.init?.headers["Authorization"]).toBe("Bearer k");
    const body = JSON.parse(seen.init?.body ?? "{}") as Record<string, unknown>;
    expect(body.model).toBe("qwen");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual(msgs);
    expect(body.reasoning_effort).toBe("none");
  });

  it("schickt keine Suppress-Parameter, wenn Denken an ist", async () => {
    const seen: { init?: { headers: Record<string, string>; body: string } } = {};
    const t = fake(() => Promise.resolve({ content: "ok", reasoning: "", model: "m" }), seen);
    await streamTune(t, { messages: msgs, endpoint: ep, model: "qwen", suppressThinking: false });
    expect(JSON.parse(seen.init?.body ?? "{}")).not.toHaveProperty("reasoning_effort");
  });

  it("meldet truncated bei finish_reason length, Ergebnis bleibt nutzbar", async () => {
    const t = fake(() => Promise.resolve({ content: "halb", reasoning: "", model: "m", finishReason: "length" }));
    const r = await streamTune(t, { messages: msgs, endpoint: ep, model: "", suppressThinking: true });
    expect(r).toMatchObject({ ok: true, text: "halb", truncated: true });
  });

  it("leerer Content mit Reasoning → thought-only; ganz leer → empty", async () => {
    const a = await streamTune(fake(() => Promise.resolve({ content: "  ", reasoning: "denk", model: "m" })), { messages: msgs, endpoint: ep, model: "", suppressThinking: false });
    expect(a).toMatchObject({ ok: false, error: { kind: "thought-only" } });
    const b = await streamTune(fake(() => Promise.resolve({ content: "", reasoning: "", model: "m" })), { messages: msgs, endpoint: ep, model: "", suppressThinking: false });
    expect(b).toMatchObject({ ok: false, error: { kind: "empty" } });
  });

  it("HTTP-Fehler traegt Status und Klartext aus dem Body", async () => {
    const t = fake(() => Promise.reject(new StreamHttpError(401, '{"error":{"message":"Not authenticated"}}')));
    const r = await streamTune(t, { messages: msgs, endpoint: ep, model: "", suppressThinking: false });
    expect(r).toMatchObject({ ok: false, error: { kind: "http", status: 401, detail: "Not authenticated" } });
  });

  it("Abbruch behaelt den Teiltext", async () => {
    const t: StreamTransport = {
      stream: (_u, _i, onContent) => { onContent("teil"); const e = new Error("Aborted"); e.name = "AbortError"; return Promise.reject(e); },
    };
    const r = await streamTune(t, { messages: msgs, endpoint: ep, model: "", suppressThinking: false });
    expect(r).toEqual({ ok: false, error: { kind: "aborted" }, partial: "teil" });
  });

  it("Netzfehler → network", async () => {
    const r = await streamTune(fake(() => Promise.reject(new Error("net"))), { messages: msgs, endpoint: ep, model: "", suppressThinking: false });
    expect(r).toMatchObject({ ok: false, error: { kind: "network" } });
  });
});

describe("errors", () => {
  it("errorMessageKey bildet i18n-Schluessel und Argumente", () => {
    expect(errorMessageKey({ kind: "http", status: 500, detail: "boom" })).toEqual({ key: "error.http", args: ["500", "boom"] });
    expect(errorMessageKey({ kind: "cors-suspected" })).toEqual({ key: "error.corsSuspected", args: [] });
    expect(errorMessageKey({ kind: "thought-only" }).key).toBe("error.thoughtOnly");
  });
  it("classifyNetworkFailure: Probe gruen + Stream rot = CORS-Verdacht", () => {
    expect(classifyNetworkFailure(true)).toEqual({ kind: "cors-suspected" });
    expect(classifyNetworkFailure(false)).toEqual({ kind: "network" });
  });
});
