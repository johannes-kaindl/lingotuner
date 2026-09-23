// uebernommen aus vault-rag/src/sse.ts (streamSSE) und obsidian-transmute/src/obsidian/http.ts (probe), 2026-09-07
import { requestUrl } from "obsidian";
import { StreamHttpError, type StreamInit, type StreamOutcome, type StreamTransport } from "../core/llm/client";
import { parseSSE } from "../vendor/kit/sse";
import { ThinkSplitter } from "../vendor/kit/think-splitter";
import { classifyEndpointStatus, extractModelIds, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { withTimeout } from "../vendor/kit/timeout";
import { probeBaseUrl, probeEndpoint as probeBackend, type CapabilityFetch } from "../vendor/kit/capabilities";
import type { BackendId } from "../vendor/kit/sampling-profiles";

/** Streamt einen OpenAI-kompatiblen SSE-Stream ueber XMLHttpRequest — `requestUrl` kann nicht
 *  streamen, `fetch` scheitert im Renderer haeufiger an CORS. Inline-<think> wird per ThinkSplitter
 *  in den Reasoning-Kanal gezogen; das erste `finish_reason` wird durchgereicht (Truncation). */
function streamSSE(
  url: string,
  init: StreamInit,
  onContent: (t: string) => void,
  onReasoning: (t: string) => void,
  signal?: AbortSignal,
): Promise<StreamOutcome> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const splitter = new ThinkSplitter();
    let content = "", reasoning = "", model = "", buffer = "", seen = 0;
    let finishReason: string | undefined;
    const emit = (c: string, r: string): void => {
      if (c) { content += c; onContent(c); }
      if (r) { reasoning += r; onReasoning(r); }
    };
    const drain = (p: { content: string[]; reasoning: string[]; model?: string; finishReason?: string }): void => {
      if (!model && p.model) model = p.model;
      if (finishReason === undefined && p.finishReason) finishReason = p.finishReason;
      for (const r of p.reasoning) emit("", r);
      for (const c of p.content) { const s = splitter.push(c); emit(s.content, s.reasoning); }
    };
    const pump = (): void => {
      const text = xhr.responseText;
      buffer += text.slice(seen);
      seen = text.length;
      const p = parseSSE(buffer);
      buffer = p.rest;
      drain(p);
    };
    const abortError = (): Error => { const e = new Error("Aborted"); e.name = "AbortError"; return e; };

    xhr.open(init.method, url);
    for (const [k, v] of Object.entries(init.headers)) xhr.setRequestHeader(k, v);
    xhr.onprogress = (): void => pump();
    xhr.onerror = (): void => reject(new Error("network"));
    xhr.onabort = (): void => reject(abortError());
    xhr.onload = (): void => {
      pump();
      drain(parseSSE(buffer));
      const tail = splitter.flush();
      emit(tail.content, tail.reasoning);
      if (xhr.status < 200 || xhr.status >= 300) reject(new StreamHttpError(xhr.status, xhr.responseText));
      else resolve({ content, reasoning, model, finishReason });
    };
    // Ein bereits abgebrochenes Signal feuert kein `abort`-Ereignis mehr — ohne diesen Guard
    // ginge die Anfrage raus und die Zusage bliebe fuer immer offen (der Test lief in den Timeout).
    if (signal?.aborted) { reject(abortError()); return; }
    if (signal) signal.addEventListener("abort", () => xhr.abort());
    xhr.send(init.body);
  });
}

export const xhrTransport: StreamTransport = { stream: streamSSE };

type Wire = { status: number; text: string; timedOut: boolean; error: string | null };

async function send(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Wire> {
  const work = requestUrl({ url, method: "GET", headers, throw: false })
    .then((res) => ({ status: res.status, text: res.text, timedOut: false, error: null }))
    .catch((err: unknown) => ({ status: 0, text: "", timedOut: false, error: err instanceof Error ? err.message : String(err) }));
  const raced = await withTimeout(work, timeoutMs, window);
  return raced.timedOut ? { status: 0, text: "", timedOut: true, error: null } : raced.value;
}

/** Erreichbarkeits-Probe gegen GET /v1/models — mit Schluessel, sonst meldet ein gehosteter
 *  Anbieter 401 und der Endpunkt gilt still als tot. */
export async function probeEndpoint(ep: EndpointConfig, timeoutMs: number): Promise<EndpointStatus> {
  const res = await send(`${normalizeEndpoint(ep.url)}/v1/models`, timeoutMs, authHeaders(ep.apiKey));
  if (res.timedOut) return classifyEndpointStatus({ kind: "timeout" });
  if (res.error !== null) return classifyEndpointStatus({ kind: "error", message: res.error });
  let body: unknown = null;
  try { body = JSON.parse(res.text); } catch { /* kein JSON → not-an-llm-api */ }
  return classifyEndpointStatus({ kind: "response", status: res.status, body });
}

export async function listModels(ep: EndpointConfig, timeoutMs: number): Promise<string[]> {
  const res = await send(`${normalizeEndpoint(ep.url)}/v1/models`, timeoutMs, authHeaders(ep.apiKey));
  if (res.timedOut || res.error !== null || res.status < 200 || res.status >= 300) return [];
  try { return extractModelIds(JSON.parse(res.text)).sort(); } catch { return []; }
}

/** EIN Client je Endpunkt-Zeile fuer die Kit-Endpoint-Liste (Status-Icon UND Modell-Liste). */
export function clientFor(ep: EndpointConfig, timeoutMs: number): { probe(): Promise<EndpointStatus>; listModels(): Promise<string[]> } {
  return { probe: () => probeEndpoint(ep, timeoutMs), listModels: () => listModels(ep, timeoutMs) };
}

const fetchJsonAdapter: CapabilityFetch = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method ?? "GET", headers: req.headers, body: req.body, throw: false });
  if (res.status < 200 || res.status >= 300) return null;
  try { return { json: JSON.parse(res.text) as unknown }; } catch { return null; }
};

const BACKEND_CACHE_MS = 30_000;
let backendCache: { url: string; backend: BackendId; at: number } | null = null;

/** Welches Backend hinter einer URL steckt — 30 s je URL zwischengespeichert (dieselbe Regel
 *  wie der Modelllisten-Cache), bei Aenderung der URL verworfen. Spec § 3.1. */
export async function cachedProbe(url: string, model: string): Promise<BackendId | null> {
  const now = Date.now();
  if (backendCache && backendCache.url === url && now - backendCache.at < BACKEND_CACHE_MS) return backendCache.backend;
  const { backend } = await probeBackend(fetchJsonAdapter, probeBaseUrl(url), model);
  backendCache = { url, backend, at: now };
  return backend;
}
