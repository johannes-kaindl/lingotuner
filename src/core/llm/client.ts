import { normalizeEndpoint } from "../../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../../vendor/kit/endpoint_config";
import { errorMessageFromText } from "../../vendor/kit/error_body";
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

export class StreamHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Stream HTTP ${status}`);
    this.name = "StreamHttpError";
  }
}

export interface StreamInit { method: "POST"; headers: Record<string, string>; body: string }
export interface StreamOutcome { content: string; reasoning: string; model: string; finishReason?: string }

/** Netz-Port. Die Implementierung (XHR) lebt in src/obsidian/http.ts — der Kern bleibt obsidian-frei. */
export interface StreamTransport {
  stream(
    url: string,
    init: StreamInit,
    onContent: (t: string) => void,
    onReasoning: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamOutcome>;
}

export interface TuneRequest {
  messages: ChatMessage[];
  endpoint: EndpointConfig;
  /** Modell, wie es der Nutzer/die Liste kennt (Anzeige, Logbuch). */
  model: string;
  /** Modell, wie es tatsaechlich gesendet wird (nach `aliasOf`-Aufloesung). */
  sentModel: string;
  params: Record<string, number | string>;
  signal?: AbortSignal;
  onToken?: (t: string) => void;
  onReasoning?: (t: string) => void;
}

export type TuneResult =
  | { ok: true; text: string; reasoning: string; model: string; truncated: boolean; finishReason?: string }
  | { ok: false; error: TuneError; partial: string; reasoning?: string; finishReason?: string; status?: number; errorText?: string };

export async function streamTune(transport: StreamTransport, req: TuneRequest): Promise<TuneResult> {
  const base = normalizeEndpoint(req.endpoint.url);
  const body = JSON.stringify({
    model: req.sentModel,
    messages: req.messages,
    stream: true,
    ...req.params,
  });
  let partial = "";
  const onContent = (t: string): void => { partial += t; req.onToken?.(t); };
  const onReasoning = (t: string): void => { req.onReasoning?.(t); };
  try {
    const out = await transport.stream(
      `${base}/v1/chat/completions`,
      { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(req.endpoint.apiKey) }, body },
      onContent, onReasoning, req.signal,
    );
    if (out.content.trim() === "") {
      return {
        ok: false, error: out.reasoning.trim() !== "" ? { kind: "thought-only" } : { kind: "empty" }, partial,
        reasoning: out.reasoning, ...(out.finishReason !== undefined ? { finishReason: out.finishReason } : {}),
      };
    }
    return { ok: true, text: out.content, reasoning: out.reasoning, model: out.model, truncated: out.finishReason === "length", ...(out.finishReason !== undefined ? { finishReason: out.finishReason } : {}) };
  } catch (e) {
    if (e instanceof StreamHttpError) {
      return { ok: false, error: { kind: "http", status: e.status, detail: errorMessageFromText(e.body) ?? e.body.slice(0, 200) }, partial, status: e.status, errorText: e.body };
    }
    if (e instanceof Error && e.name === "AbortError") return { ok: false, error: { kind: "aborted" }, partial };
    return { ok: false, error: { kind: "network" }, partial };
  }
}
