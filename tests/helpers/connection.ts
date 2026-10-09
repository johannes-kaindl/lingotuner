import type { App } from "obsidian";
import { createLlmConnection, type LlmConnection, type LlmConnectionSettings } from "../../src/vendor/kit-obsidian/llm-connection";
import type { SseTransport } from "../../src/vendor/kit-obsidian/chat-client";
import type { BackendId } from "../../src/vendor/kit/sampling-profiles";
import { MODE } from "../../src/core/llm/client";
import { DEFAULT_SETTINGS } from "../../src/core/settings";

/** Node hat kein `window`: eine Uhr ueber die globalen Timer (Kit-Vertrag: die Verbindung bekommt sie injiziert). */
export const nodeClock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

export interface Seen { url?: string; body?: Record<string, unknown>; headers?: Record<string, string> }

/** Fake-Transport im Kit-Vertrag: `onChunk` mit data:-Zeilen, aufgeloest mit dem Status. */
export function fakeTransport(chunks: string[], status = 200, seen: Seen = {}): SseTransport {
  return {
    postStream: (url, body, headers, onChunk) => {
      seen.url = url; seen.body = body as Record<string, unknown>; seen.headers = headers;
      for (const c of chunks) onChunk(c);
      return Promise.resolve(status);
    },
  };
}
export const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
export const delta = (content: string, extra: Record<string, unknown> = {}): string => sse({ model: "m", choices: [{ delta: { content }, ...extra }] });
export const DONE = "data: [DONE]\n\n";

export interface ConnOptions {
  transport: SseTransport;
  /** Fallback-Transport (Origin-Weigerung), sonst keiner. */
  fallback?: SseTransport;
  settings?: Partial<LlmConnectionSettings>;
  backend?: BackendId;
  timeouts?: { idleMs?: number; firstChunkMs?: number };
  notices?: string[];
  /** Erreichbarkeit der lokalen Zeile (Default: immer erreichbar). */
  probe?: () => Promise<boolean>;
}

/** Die Verbindung des Plugins ohne Obsidian: lokale Liste, Probe immer gruen, eigener Transport. */
export function makeConnection(o: ConnOptions): LlmConnection {
  const settings: LlmConnectionSettings = {
    endpoints: [{ url: "http://127.0.0.1:1234/v1/", apiKey: "k" }],
    model: "qwen",
    request: DEFAULT_SETTINGS.request,
    ...o.settings,
  };
  const app = { plugins: { plugins: {} } } as unknown as App;
  return createLlmConnection({
    app, pluginId: "lingotuner", caller: "lingotuner", capability: "chat", mode: MODE, clock: nodeClock,
    getSettings: () => settings,
    persist: (patch) => { Object.assign(settings, patch); return Promise.resolve(); },
    probe: o.probe ?? (() => Promise.resolve(true)),
    listModels: () => Promise.resolve(["qwen"]),
    backendOf: () => Promise.resolve(o.backend ?? null),
    transports: { http: o.transport, ...(o.fallback ? { httpFallback: o.fallback } : { fallback: "none" as const }) },
    ...(o.timeouts ? { timeouts: o.timeouts } : {}),
    notice: (text) => { o.notices?.push(text); },
  });
}

/** Eine Verbindung, die ein Ergebnis liefert, ohne Netz. */
export function fakeConnection(content: string, reasoning = ""): unknown {
  const source = { kind: "local", config: { url: "http://l" }, model: "m", sentModel: "m", family: null, familySource: "none", backend: "unknown", backendSource: "none" };
  return {
    resolve: () => Promise.resolve(source),
    models: () => Promise.resolve({ models: [], reachable: true }),
    invalidate: () => undefined,
    complete: () => Promise.resolve({
      ok: true, content, reasoning, toolCalls: [], truncated: false, streamed: true, model: "m",
      timing: { startedAt: 0, firstChunkAt: 1, endedAt: 2 }, redactions: 0, facts: null, deviations: [], source,
    }),
  };
}

