// vendored from obsidian-kit@0.46.0, src/obsidian/lab-client.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Konsumentenseite von llm-labs Plugin-API (`app.plugins.plugins["llm-lab"].api`, Vertrag v4).
 *
 *  Herkunft (Welle 8, 2026-09-25): vier byte-gleiche Kopien (bis auf Kommentare) —
 *  `koda-agent/src/obsidian/lab.ts`, `obsidian-transmute/src/obsidian/lab.ts`,
 *  `vault-rag/src/lab_client.ts`, `lingotuner/src/obsidian/lab.ts`; eine Kopier-Kette mit dem
 *  Ursprung vault-rag, dort wiederum nach dem Defensiv-Lese-Bauplan von
 *  `koda-agent/src/obsidian/retrieval.ts`. Der Vertrag selbst gehört llm-lab
 *  (`llm-lab/src/plugin_api.ts`, `LLM_LAB_API_VERSION`); die Typen hier sind seine Spiegelung.
 *
 *  **Was neu ist:** die Kopien lieferten bei jedem Hindernis still `null` — ein Lab mit
 *  apiVersion 5 sah aus wie kein Lab. `findLabApi` nennt den Grund (`version-mismatch` samt
 *  gefundener und erwarteter Version), den ein Konsument einmal ins Log schreiben kann.
 *  `readLabApi` bleibt als Kurzform, damit ein Tausch den Aufrufer nicht umbauen muss.
 *
 *  **Die Version wird strikt geprüft**, nicht als Untergrenze: llm-lab erhöht sie bei jeder
 *  BRECHENDEN Änderung. Ein neueres Lab kann einen Aufruf nach altem Vertrag falsch lesen.
 *
 *  **Gelesen wird bei jedem Aufruf**, nicht einmal beim Laden: das Lab kann zur Laufzeit an-
 *  und abgeschaltet werden, und der Zugriff ist nur ein Objekt-Lookup.
 *
 *  `logToLab` bündelt, was alle Aufrufstellen gleich taten: Lookup, `log()` in `try`, und ein
 *  Wächter gegen ein fremdes Plugin, das entgegen dem Vertrag eine Promise zurückgibt
 *  (vault-rag, koda-agent, obsidian-transmute — lingotuner fehlte er). Telemetrie reißt den
 *  Aufrufer nie mit. */

export const LAB_PLUGIN_ID = "llm-lab";
export const LAB_API_VERSION = 4;

/** Spiegel von `LabLogInput` aus llm-lab v4. */
export interface LabLogInput {
  plugin: string;
  feature: string;
  model: string;
  endpointUrl: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  content: string;
  reasoning?: string;
  finishReason?: string;
  latencyMs: number;
  ttftMs?: number;
  error?: string;
  /** Endpunkt-Schlüssel zur exakten Maskierung — wandert nie in den Record. */
  secrets?: string[];
  /** Vault-Pfade der Notizen, die in den Aufruf eingeflossen sind (Ordner-Filter im Lab). */
  contextPaths?: string[];
  /** Der stabile Anteil des System-Prompts — Grundlage des Fassungsvergleichs im Lab. */
  promptTemplate?: string;
  /** Klammert mehrere Aufrufe EINER Nutzer-Handlung (Agent-Loop). Einmal je Handlung vergeben. */
  turnId?: string;
}

export interface LabApi {
  apiVersion: number;
  status(): { apiVersion: number; recording: boolean };
  /** Gibt die Record-id SYNCHRON zurück und wirft laut Vertrag nie. */
  log(input: LabLogInput): string;
}

export type LabUnavailableReason = "no-registry" | "not-loaded" | "no-api" | "version-mismatch" | "incomplete";

export type LabLookup =
  | { ok: true; api: LabApi }
  | { ok: false; reason: LabUnavailableReason; detail: string; found?: unknown; expected?: number };

export type LabLogOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: LabUnavailableReason | "log-threw" | "log-not-sync"; detail: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function findLabApi(app: unknown): LabLookup {
  const plugins = isRecord(app) ? app.plugins : undefined;
  const reg = isRecord(plugins) ? plugins.plugins : undefined;
  if (!isRecord(reg)) return { ok: false, reason: "no-registry", detail: "app.plugins.plugins not found" };
  const plugin = reg[LAB_PLUGIN_ID];
  if (plugin === undefined || plugin === null) {
    return { ok: false, reason: "not-loaded", detail: `plugin "${LAB_PLUGIN_ID}" not installed or not enabled` };
  }
  const api = isRecord(plugin) ? plugin.api : undefined;
  if (!isRecord(api)) return { ok: false, reason: "no-api", detail: `plugin "${LAB_PLUGIN_ID}" exposes no api` };
  if (api.apiVersion !== LAB_API_VERSION) {
    return {
      ok: false, reason: "version-mismatch", found: api.apiVersion, expected: LAB_API_VERSION,
      detail: `llm-lab apiVersion ${String(api.apiVersion)}, expected ${LAB_API_VERSION}`,
    };
  }
  if (typeof api.status !== "function" || typeof api.log !== "function") {
    return { ok: false, reason: "incomplete", detail: "llm-lab api lacks status() or log()" };
  }
  return { ok: true, api: api as unknown as LabApi };
}

/** Kurzform: die API oder `null` — Signatur der bisherigen Kopien. */
export function readLabApi(app: unknown): LabApi | null {
  const r = findLabApi(app);
  return r.ok ? r.api : null;
}

/** Schreibt einen Aufruf ins Lab, falls es da ist. Wirft nie. */
export function logToLab(app: unknown, input: LabLogInput): LabLogOutcome {
  const found = findLabApi(app);
  if (!found.ok) return { ok: false, reason: found.reason, detail: found.detail };
  let ret: unknown;
  try {
    ret = found.api.log(input);
  } catch (e) {
    return { ok: false, reason: "log-threw", detail: e instanceof Error ? e.message : String(e) };
  }
  if (typeof ret === "string") return { ok: true, id: ret };
  // Vertrag verletzt: eine etwaige Promise abfangen, bevor sie als unhandled rejection den
  // Aufrufer mitreißt.
  void Promise.resolve(ret).catch(() => undefined);
  return { ok: false, reason: "log-not-sync", detail: "llm-lab log() returned no string id" };
}
