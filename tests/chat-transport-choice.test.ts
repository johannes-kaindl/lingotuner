import { describe, it, expect } from "vitest";
import { makeChatClient, chatSetupFor, SHORTCUT_CLIENT_SLACK_MS } from "../src/obsidian/http";
import { streamTune } from "../src/core/llm/client";
import { classifyShortcutFailure, errorMessageKey } from "../src/core/llm/errors";
import { requestUrlTransport, xhrSseTransport } from "../src/vendor/kit-obsidian/chat-transport";
import type { ShortcutResult, ShortcutRun } from "../src/vendor/kit-obsidian/shortcuts-bridge";

const msgs = [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "usr" }];
const apple = { url: "apple-shortcuts://on-device" };
const nodeClock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};
const shortcutSource = (timeoutMs = 30_000) => ({ transport: "shortcuts" as const, shortcut: { name: "Apple LLM", timeoutMs } });

function fakeBridge(result: ShortcutResult): { bridge: { run(r: ShortcutRun): Promise<ShortcutResult> }; calls: ShortcutRun[] } {
  const calls: ShortcutRun[] = [];
  return { calls, bridge: { run: (r) => { calls.push(r); return Promise.resolve(result); } } };
}

describe("chatSetupFor — Transportwahl", () => {
  it("HTTP-Endpunkt: XHR-Stream mit requestUrl-Fallback, Frist wie eingestellt", () => {
    const s = chatSetupFor(60, { transport: "http" }, null);
    expect(s.choice.primary).toBe(xhrSseTransport);
    expect(s.choice.fallback).toBe(requestUrlTransport);
    expect(s.firstChunkMs).toBe(60_000);
  });

  it("ohne Quelle (lokale Liste) gilt HTTP", () => {
    const s = chatSetupFor(60, null, null);
    expect(s.choice.primary).toBe(xhrSseTransport);
  });

  it("Shortcuts-Endpunkt: eigener Transport, kein HTTP-Fallback", () => {
    const { bridge } = fakeBridge({ ok: true, result: "x", durationMs: 1 });
    const s = chatSetupFor(60, shortcutSource(), bridge);
    expect(s.choice.primary).not.toBe(xhrSseTransport);
    expect(s.choice.fallback).toBeUndefined();
  });

  it("Client-Frist ist mindestens Kurzbefehl-Frist plus Puffer, nie kuerzer als eingestellt", () => {
    const { bridge } = fakeBridge({ ok: true, result: "x", durationMs: 1 });
    expect(chatSetupFor(60, shortcutSource(30_000), bridge).firstChunkMs).toBe(60_000);
    expect(chatSetupFor(60, shortcutSource(120_000), bridge).firstChunkMs).toBe(120_000 + SHORTCUT_CLIENT_SLACK_MS);
  });

  it("Shortcuts-Endpunkt ohne Bruecke ist ein Konfigurationsfehler und wirft", () => {
    expect(() => chatSetupFor(60, shortcutSource(), null)).toThrow();
  });
});

describe("Anfrage ueber den Kurzbefehl", () => {
  const run = (bridge: { run(r: ShortcutRun): Promise<ShortcutResult> }, model: string) =>
    streamTune(
      makeChatClient(60, shortcutSource(), bridge, { clock: nodeClock }),
      { messages: msgs, endpoint: apple, model, sentModel: model, params: { temperature: 0.2 }, timeouts: { firstChunkSec: 60, idleSec: 120 } },
    );

  it.each(["", "Apple Model"])("liefert die Antwort auf einmal, sentModel %j wird vertragen", async (model) => {
    const { bridge, calls } = fakeBridge({ ok: true, result: "Hallo", durationMs: 5 });
    const r = await run(bridge, model);
    expect(r).toMatchObject({ ok: true, text: "Hallo" });
    expect(calls).toEqual([{ shortcut: "Apple LLM", input: "sys\n\nusr", timeoutMs: 30_000 }]);
  });

  it("Zeitueberschreitung der Bruecke kommt als http 408 mit Grund an", async () => {
    const { bridge } = fakeBridge({ ok: false, reason: "timeout", message: "Kurzbefehl antwortet nicht", durationMs: 30_000 });
    const r = await run(bridge, "");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(408);
    expect(classifyShortcutFailure(r.status ?? 0, r.errorText)).toEqual({ kind: "shortcut", reason: "timeout", detail: "Kurzbefehl antwortet nicht" });
  });
});

describe("classifyShortcutFailure", () => {
  const body = (reason: string, message = "m") => JSON.stringify({ error: { message, reason } });
  it.each([
    [408, "timeout", "timeout"], [429, "busy", "busy"], [499, "cancel", "cancel"], [502, "error", "error"],
  ])("Status %i mit Grund %s", (status, reason, expected) => {
    expect(classifyShortcutFailure(status, body(reason))).toMatchObject({ kind: "shortcut", reason: expected });
  });
  it("501 ohne Grund im Koerper ist die Werkzeug-Grenze", () => {
    expect(classifyShortcutFailure(501, JSON.stringify({ error: { message: "tool calls" } }))).toMatchObject({ reason: "unsupported" });
  });
  it("ohne lesbaren Koerper entscheidet der Status", () => {
    expect(classifyShortcutFailure(408, undefined)).toMatchObject({ reason: "timeout", detail: "" });
    expect(classifyShortcutFailure(500, "kein json")).toMatchObject({ reason: "error", detail: "kein json" });
  });
  it("hat je Grund einen Text-Schluessel", () => {
    const e = classifyShortcutFailure(408, body("timeout"));
    expect(errorMessageKey(e).key).toBe("error.shortcut.timeout");
  });
});
