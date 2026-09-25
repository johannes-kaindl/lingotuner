// uebernommen aus obsidian-transmute/src/obsidian/lab.ts, 2026-09-25 (dort aus koda-agent/src/obsidian/lab.ts,
// dort aus vault-rag/src/lab_client.ts — die Kette bleibt sichtbar; zuvor hier: vault-rag, 2026-09-07). apiVersion 4 (turnId).
/** Liest llm-labs oeffentliche API defensiv aus dem Plugin-Register.
 *
 *  Bewusst bei JEDEM Aufruf statt einmal beim Laden: das Lab kann zur Laufzeit
 *  aktiviert oder deaktiviert werden, und der Zugriff ist nur ein Objekt-Lookup. */
const SUPPORTED_API_VERSION = 4;
const PLUGIN_ID = "llm-lab";

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
  /** apiVersion 2: Endpunkt-Schluessel zur exakten Maskierung, nie im Record. */
  secrets?: string[];
  /** apiVersion 2: Pfade der Notizen, die in den Aufruf eingeflossen sind. */
  contextPaths?: string[];
  /** apiVersion 3: der stabile Anteil des System-Prompts (ohne Retrieval-Kontext,
   *  ohne Nutzereingabe). Grundlage des Prompt-Fassungsvergleichs im Lab. */
  promptTemplate?: string;
  /** apiVersion 4: klammert mehrere Aufrufe, die zu EINER Nutzer-Handlung gehoeren
   *  (hier: ein Tunen = eine turnId). */
  turnId?: string;
}

export interface LabApi {
  apiVersion: number;
  status(): { apiVersion: number; recording: boolean };
  log(input: LabLogInput): string;
}

export function readLabApi(app: unknown): LabApi | null {
  const reg = (app as { plugins?: { plugins?: Record<string, unknown> } } | null | undefined)
    ?.plugins?.plugins;
  if (reg === null || typeof reg !== "object") return null;

  const api = (reg[PLUGIN_ID] as { api?: unknown } | undefined)?.api as LabApi | undefined;
  if (!api || api.apiVersion !== SUPPORTED_API_VERSION) return null;

  const complete = typeof api.status === "function" && typeof api.log === "function";
  return complete ? api : null;
}
