import { normalizeEndpoint } from "../../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../../vendor/kit/endpoint_config";
import { suppressParams } from "../../vendor/kit/reasoning";
import { effectiveSuppress } from "../../vendor/kit/think-toggle";
import { errorMessageFromText } from "../../vendor/kit/error_body";
import type { ChatMessage } from "../prompt";
import type { TuneError } from "./errors";

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
  model: string;
  suppressThinking: boolean;
  signal?: AbortSignal;
  onToken?: (t: string) => void;
  onReasoning?: (t: string) => void;
}

export type TuneResult =
  | { ok: true; text: string; reasoning: string; model: string; truncated: boolean }
  | { ok: false; error: TuneError; partial: string };

const TEMPERATURE = 0.3;

export async function streamTune(transport: StreamTransport, req: TuneRequest): Promise<TuneResult> {
  const base = normalizeEndpoint(req.endpoint.url);
  const body = JSON.stringify({
    model: req.model,
    messages: req.messages,
    stream: true,
    temperature: TEMPERATURE,
    ...suppressParams(effectiveSuppress(req.model, req.suppressThinking)),
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
      return { ok: false, error: out.reasoning.trim() !== "" ? { kind: "thought-only" } : { kind: "empty" }, partial };
    }
    return { ok: true, text: out.content, reasoning: out.reasoning, model: out.model, truncated: out.finishReason === "length" };
  } catch (e) {
    if (e instanceof StreamHttpError) {
      return { ok: false, error: { kind: "http", status: e.status, detail: errorMessageFromText(e.body) ?? e.body.slice(0, 200) }, partial };
    }
    if (e instanceof Error && e.name === "AbortError") return { ok: false, error: { kind: "aborted" }, partial };
    return { ok: false, error: { kind: "network" }, partial };
  }
}
