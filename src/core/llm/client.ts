import type { EndpointConfig } from "../../vendor/kit/endpoint_config";
import type { ChatClient, ChatTiming } from "../../vendor/kit-obsidian/chat-client";
import {
  resolveRequestParams,
  type BackendId, type FamilyId, type FieldId, type ResolvedRequest, type ResponseFacts, type ThinkingLevel,
} from "../../vendor/kit/sampling-profiles";
import type { ChatMessage } from "../prompt";
import type { TuneError } from "./errors";

/** Modus dieses Plugins in der Sampling-Profile-Tabelle — lingotuner formt Text treu um,
 *  ohne zu erfinden (Spec § 4.1: "transform"). Nur EIN Modus, deshalb hier fest verdrahtet. */
export const MODE = "transform";

/** Wandelt ein `TuneResult` in die Eingabe fuer `checkResponse` (Spec § 3.3). `null`, wenn
 *  gar keine Server-Antwort vorlag (Abbruch, Netzfehler, Timeout, CORS-Verdacht) — dafuer
 *  hat `checkResponse` keine sinnvolle Aussage. */
export function responseFactsFromResult(result: TuneResult): ResponseFacts | null {
  if (result.ok) {
    return {
      status: 200, finishReason: result.finishReason ?? null, content: result.text,
      reasoning: result.reasoning, responseModel: result.model,
    };
  }
  switch (result.error.kind) {
    case "http":
      return {
        status: result.status ?? result.error.status, errorText: result.errorText ?? result.error.detail,
        finishReason: result.finishReason ?? null, content: "", reasoning: result.reasoning ?? "",
      };
    case "thought-only":
    case "empty":
      return { status: 200, finishReason: result.finishReason ?? null, content: "", reasoning: result.reasoning ?? "" };
    default:
      return null;
  }
}

/** Die Request-Bau-Funktion DES PLUGINS (Rezept 8): nur sie kennt lingotuners festen Modus.
 *  Goldene Requests laufen dagegen, nicht gegen resolveRequestParams direkt — sonst pruefte
 *  der Test das Kit statt das Plugin. */
export function buildTuneParams(input: {
  family: FamilyId | null;
  backend: BackendId;
  thinking: ThinkingLevel;
  overrides?: Partial<Record<FieldId, number | string>>;
}): ResolvedRequest {
  return resolveRequestParams({ family: input.family, mode: MODE, backend: input.backend, thinking: input.thinking, overrides: input.overrides });
}

export interface TuneRequest {
  messages: ChatMessage[];
  endpoint: EndpointConfig;
  /** Modell, wie es der Nutzer/die Liste kennt (Anzeige, Logbuch). */
  model: string;
  /** Modell, wie es tatsaechlich gesendet wird (nach `aliasOf`-Aufloesung). */
  sentModel: string;
  params: Record<string, number | string>;
  /** Fristen, die der Client fuer diesen Lauf traegt — nur fuer den Text „nach N s“ im Timeout-Fehler. */
  timeouts: { firstChunkSec: number; idleSec: number };
  signal?: AbortSignal;
  onToken?: (t: string) => void;
  onReasoning?: (t: string) => void;
}

export type TuneResult =
  | { ok: true; text: string; reasoning: string; model: string; truncated: boolean; finishReason?: string; ttftMs?: number }
  | { ok: false; error: TuneError; partial: string; reasoning?: string; finishReason?: string; status?: number; errorText?: string; ttftMs?: number };

/** Zeit bis zum ersten Byte (auch Reasoning) — der Wert, den das Lab als `ttftMs` fuehrt. */
function ttftOf(t: ChatTiming): { ttftMs?: number } {
  return t.firstChunkAt !== undefined ? { ttftMs: t.firstChunkAt - t.startedAt } : {};
}

/** Ein Tunen ueber den Kit-Chat-Client. Der Client liefert Transport, Fristen, Fallback und
 *  Fehlerkoerper; hier bleibt, was nur lingotuner kennt: die Klassen `thought-only`/`empty` und
 *  die Uebersetzung der Kit-Fehlerarten in `TuneError`. */
export async function streamTune(client: ChatClient, req: TuneRequest): Promise<TuneResult> {
  const r = await client.complete({
    endpoint: req.endpoint, model: req.sentModel, messages: req.messages, params: req.params,
    ...(req.signal ? { signal: req.signal } : {}),
    ...(req.onToken ? { onToken: req.onToken } : {}),
    ...(req.onReasoning ? { onReasoning: req.onReasoning } : {}),
  });
  const ttft = ttftOf(r.timing);
  if (r.ok) {
    if (r.content.trim() === "") return emptyResult(r.content, r.reasoning, r.finishReason, ttft);
    return { ok: true, text: r.content, reasoning: r.reasoning, model: r.model ?? "", truncated: r.truncated, ...(r.finishReason !== undefined ? { finishReason: r.finishReason } : {}), ...ttft };
  }
  switch (r.kind) {
    case "aborted": return { ok: false, error: { kind: "aborted" }, partial: r.partial, ...ttft };
    case "timeout": {
      const seconds = r.timing.firstChunkAt === undefined ? req.timeouts.firstChunkSec : req.timeouts.idleSec;
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
  }
}

function emptyResult(partial: string, reasoning: string, finishReason: string | undefined, ttft: { ttftMs?: number }): TuneResult {
  return {
    ok: false, error: reasoning.trim() !== "" ? { kind: "thought-only" } : { kind: "empty" }, partial, reasoning,
    ...(finishReason !== undefined ? { finishReason } : {}), ...ttft,
  };
}
