import { DEFAULT_IDLE_TIMEOUT_MS, JIT_FIRST_CHUNK_TIMEOUT_MS, type ChatResult, type ChatTiming } from "../../vendor/kit-obsidian/chat-client";
import type { NoEndpointResult } from "../../vendor/kit-obsidian/llm-connection";
import type { ShortcutTransportConfig } from "../../vendor/kit/endpoint-source";
import type { TuneError } from "./errors";

/** Modus dieses Plugins in der Sampling-Profile-Tabelle — lingotuner formt Text treu um,
 *  ohne zu erfinden (Spec § 4.1: "transform"). Nur EIN Modus, deshalb hier fest verdrahtet. */
export const MODE = "transform";

export type TuneResult =
  | { ok: true; text: string; reasoning: string; model: string; truncated: boolean; finishReason?: string; ttftMs?: number }
  | { ok: false; error: TuneError; partial: string; reasoning?: string; finishReason?: string; status?: number; errorText?: string; ttftMs?: number };

/** Zeit bis zum ersten Byte (auch Reasoning) — der Wert, den das Lab als `ttftMs` fuehrt. */
function ttftOf(t: ChatTiming): { ttftMs?: number } {
  return t.firstChunkAt !== undefined ? { ttftMs: t.firstChunkAt - t.startedAt } : {};
}

/** Puffer auf die Kurzbefehl-Frist (Kit `llm-connection`): der Client darf nicht vor der Bruecke abbrechen. */
const SHORTCUT_CLIENT_SLACK_MS = 10_000;

/** Das Ergebnis der Verbindung (`llm.complete`) als `TuneResult`. Die Verbindung liefert Transport, Fristen,
 *  Fallback, Schwaerzung und Fehlerkoerper; hier bleibt, was nur lingotuner kennt: die Klassen `thought-only`/
 *  `empty` und die Uebersetzung der Kit-Fehlerarten in `TuneError`. `shortcut` nennt die Kurzbefehl-Frist des
 *  Endpunkts (hebt die Frist des ersten Chunks, nur fuer den Text „nach N s“). */
export function toTuneResult(r: ChatResult | NoEndpointResult, shortcut?: Pick<ShortcutTransportConfig, "timeoutMs">): TuneResult {
  const ttft = ttftOf(r.timing);
  if (r.ok) {
    if (r.content.trim() === "") return emptyResult(r.content, r.reasoning, r.finishReason, ttft);
    return { ok: true, text: r.content, reasoning: r.reasoning, model: r.model ?? "", truncated: r.truncated, ...(r.finishReason !== undefined ? { finishReason: r.finishReason } : {}), ...ttft };
  }
  switch (r.kind) {
    case "aborted": return { ok: false, error: { kind: "aborted" }, partial: r.partial, ...ttft };
    case "timeout": {
      const firstChunkMs = Math.max(JIT_FIRST_CHUNK_TIMEOUT_MS, shortcut ? shortcut.timeoutMs + SHORTCUT_CLIENT_SLACK_MS : 0);
      const seconds = (r.timing.firstChunkAt === undefined ? firstChunkMs : DEFAULT_IDLE_TIMEOUT_MS) / 1000;
      return { ok: false, error: { kind: "timeout", seconds }, partial: r.partial, ...ttft };
    }
    case "network": return { ok: false, error: { kind: "network" }, partial: r.partial, ...ttft };
    // Abgeschnitten ohne Text (das Denken hat das Budget verbraucht) ist fuer lingotuner
    // dieselbe Lage wie zuvor: leerer Inhalt, mit oder ohne Gedanken — `finishReason` bleibt sichtbar.
    case "truncated": return emptyResult(r.partial, r.reasoning, "length", ttft);
    case "http":
    case "overflow":
      return {
        ok: false, error: { kind: "http", status: r.status ?? 0, detail: r.detail }, partial: r.partial,
        reasoning: r.reasoning, ...(r.status !== undefined ? { status: r.status } : {}),
        ...(r.body !== undefined ? { errorText: r.body } : {}), ...ttft,
      };
    case "no-endpoint": return { ok: false, error: { kind: "network" }, partial: r.partial };
  }
}

function emptyResult(partial: string, reasoning: string, finishReason: string | undefined, ttft: { ttftMs?: number }): TuneResult {
  return {
    ok: false, error: reasoning.trim() !== "" ? { kind: "thought-only" } : { kind: "empty" }, partial, reasoning,
    ...(finishReason !== undefined ? { finishReason } : {}), ...ttft,
  };
}
