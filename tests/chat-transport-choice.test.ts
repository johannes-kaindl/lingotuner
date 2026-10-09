import { describe, it, expect } from "vitest";
import { toTuneResult } from "../src/core/llm/client";
import { classifyShortcutFailure, errorMessageKey } from "../src/core/llm/errors";
import { createChatClient } from "../src/vendor/kit-obsidian/chat-client";
import { createShortcutsChatTransport } from "../src/vendor/kit-obsidian/chat-transport";
import type { ShortcutResult, ShortcutRun } from "../src/vendor/kit-obsidian/shortcuts-bridge";
import { nodeClock } from "./helpers/connection";

const msgs = [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "usr" }];
const apple = { url: "apple-shortcuts://on-device" };
const SHORTCUT = { name: "Apple LLM", timeoutMs: 30_000 };

function fakeBridge(result: ShortcutResult): { bridge: { run(r: ShortcutRun): Promise<ShortcutResult> }; calls: ShortcutRun[] } {
  const calls: ShortcutRun[] = [];
  return { calls, bridge: { run: (r) => { calls.push(r); return Promise.resolve(result); } } };
}

// Der Kurzbefehl-Transport selbst gehoert dem Kit; hier steht, was lingotuner daraus macht.
describe("Anfrage ueber den Kurzbefehl", () => {
  const run = async (bridge: { run(r: ShortcutRun): Promise<ShortcutResult> }, model: string) => {
    const client = createChatClient({ transport: createShortcutsChatTransport({ bridge, shortcut: SHORTCUT }), clock: nodeClock });
    return toTuneResult(await client.complete({ endpoint: apple, model, messages: msgs, params: { temperature: 0.2 } }), SHORTCUT);
  };

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

describe("toTuneResult — Frist im Timeout-Text", () => {
  const timeout = { ok: false as const, kind: "timeout" as const, detail: "", partial: "", reasoning: "", timing: { startedAt: 0, endedAt: 1 } };
  it("ohne Kurzbefehl: erster Chunk 600 s, danach Leerlauf 120 s", () => {
    expect(toTuneResult(timeout)).toMatchObject({ error: { kind: "timeout", seconds: 600 } });
    expect(toTuneResult({ ...timeout, timing: { startedAt: 0, firstChunkAt: 1, endedAt: 2 } })).toMatchObject({ error: { kind: "timeout", seconds: 120 } });
  });
  it("Kurzbefehl mit langer Frist hebt die Frist des ersten Chunks (Kurzbefehl + 10 s)", () => {
    expect(toTuneResult(timeout, { timeoutMs: 900_000 })).toMatchObject({ error: { kind: "timeout", seconds: 910 } });
    expect(toTuneResult(timeout, { timeoutMs: 30_000 })).toMatchObject({ error: { kind: "timeout", seconds: 600 } });
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
