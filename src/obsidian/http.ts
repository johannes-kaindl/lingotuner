// uebernommen aus obsidian-transmute/src/obsidian/http.ts (probe), 2026-09-07; Chat-Transport seit 2026-09-26 aus obsidian-kit 0.43.0 (chat-client)
import { requestUrl } from "obsidian";
import { createChatClient, type ChatClient } from "../vendor/kit-obsidian/chat-client";
import { createShortcutsChatTransport, requestUrlTransport, transportFor, xhrSseTransport, type TransportChoice } from "../vendor/kit-obsidian/chat-transport";
import type { ShortcutsBridge } from "../vendor/kit-obsidian/shortcuts-bridge";
import type { ClockPort } from "../vendor/kit-obsidian/clock";
import type { EndpointSourceResult } from "../vendor/kit/endpoint-source";
import { classifyEndpointStatus, extractModelIds, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { withTimeout } from "../vendor/kit/timeout";
import { probeBaseUrl, probeEndpoint as probeBackend, type CapabilityFetch } from "../vendor/kit/capabilities";
import type { BackendId } from "../vendor/kit/sampling-profiles";

/** Idle-Frist des Chat-Clients: Stille seit dem letzten Chunk. Die Frist bis zum ERSTEN Chunk ist
 *  `timeoutSec` aus den Einstellungen (Reasoning-Modelle und JIT-Laden brauchen dort Minuten). */
export const CHAT_IDLE_TIMEOUT_MS = 120_000;

/** Puffer auf die Kurzbefehl-Frist: die Bruecke meldet ihr Timeout selbst (408), der Client darf
 *  nicht vorher abbrechen, waehrend sie noch wartet. */
export const SHORTCUT_CLIENT_SLACK_MS = 10_000;

type SourceTransport = Pick<EndpointSourceResult, "transport" | "shortcut">;

/** Transportwahl und Erst-Chunk-Frist fuer einen aufgeloesten Endpunkt. HTTP: XHR-Stream, bei
 *  Origin-/CORS-Weigerung einmal ohne Stream ueber `requestUrl` (die Weigerung haengt an der
 *  Instanz, Kit-Vertrag). Kurzbefehl (Apple Intelligence): one-shot ueber die Bruecke, kein
 *  HTTP-Fallback; die Frist ist mindestens Kurzbefehl-Frist plus Puffer. Wirft, wenn ein
 *  Shortcuts-Endpunkt ohne Bruecke oder ohne Kurzbefehl-Angabe ankommt (Konfigurationsfehler). */
export function chatSetupFor(
  firstChunkTimeoutSec: number, source: SourceTransport | null, bridge: Pick<ShortcutsBridge, "run"> | null,
): { choice: TransportChoice; firstChunkMs: number } {
  const shortcut = source?.shortcut;
  const choice = transportFor(source ?? {}, {
    http: xhrSseTransport, httpFallback: requestUrlTransport,
    ...(bridge && shortcut ? { shortcuts: createShortcutsChatTransport({ bridge, shortcut }) } : {}),
  });
  const base = firstChunkTimeoutSec * 1000;
  const firstChunkMs = source?.transport === "shortcuts" && shortcut ? Math.max(base, shortcut.timeoutMs + SHORTCUT_CLIENT_SLACK_MS) : base;
  return { choice, firstChunkMs };
}

/** EIN Chat-Client je Endpunkt, Transport und Zeitlimit. */
export function makeChatClient(
  firstChunkTimeoutSec: number, source: SourceTransport | null, bridge: Pick<ShortcutsBridge, "run"> | null,
  deps: { clock?: ClockPort } = {},
): ChatClient {
  const { choice, firstChunkMs } = chatSetupFor(firstChunkTimeoutSec, source, bridge);
  return createChatClient({
    transport: choice.primary, ...(choice.fallback ? { fallbackTransport: choice.fallback } : {}),
    firstChunkTimeoutMs: firstChunkMs, idleTimeoutMs: CHAT_IDLE_TIMEOUT_MS,
    ...(deps.clock ? { clock: deps.clock } : {}),
  });
}

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
  if (!/^https?:/i.test(url)) return null; // Sentinel-URL eines Kurzbefehl-Endpunkts (apple-shortcuts://…): kein HTTP-Ziel
  const now = Date.now();
  if (backendCache && backendCache.url === url && now - backendCache.at < BACKEND_CACHE_MS) return backendCache.backend;
  const { backend } = await probeBackend(fetchJsonAdapter, probeBaseUrl(url), model);
  backendCache = { url, backend, at: now };
  return backend;
}
