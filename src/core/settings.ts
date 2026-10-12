import { mergeSettings } from "../vendor/kit/settings";
import { fillMissingRowModels, migrateEndpointList, type EndpointConfig } from "../vendor/kit/endpoint_config";
import type { EndpointChoice } from "../vendor/kit/endpoint-source";
import {
  DEFAULT_REQUEST_SETTINGS, foldLegacyThinking, sanitizeRequestSettings,
  type LegacyRequestMigration, type RequestSettings,
} from "../vendor/kit/sampling-profiles";
import { MODE } from "./llm/client";
import { BUILTIN_PRESETS, NEUTRAL, normalizeDials, userPresetId, type Dials, type Preset } from "./dials";

export interface UserPreset { name: string; dials: Dials }

export interface LingoTunerSettings {
  endpoints: EndpointConfig[];
  overrideFolder: string;
  userPresets: UserPreset[];
  lastDials: Dials;
  logbookEnabled: boolean;
  logbookFolder: string;
  newNoteFolder: string;
  /** Wahl gegenüber dem LLM Endpoint Manager (optionales Nachbar-Plugin); leer = automatisch. */
  choice: EndpointChoice;
  /** Sampling-/Denk-Ueberschreibungen und Denkstufe je Modus (hier nur "transform"). */
  request: RequestSettings;
}

export const DEFAULT_SETTINGS: LingoTunerSettings = {
  endpoints: [{ url: "http://127.0.0.1:1234" }],
  overrideFolder: "",
  userPresets: [],
  lastDials: { ...NEUTRAL },
  logbookEnabled: false,
  logbookFolder: "LingoTuner",
  newNoteFolder: "",
  choice: {},
  request: DEFAULT_REQUEST_SETTINGS,
};

function presetName(raw: unknown): string {
  return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
}

function sanitizePresets(raw: unknown): UserPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: UserPreset[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const name = presetName((item as { name?: unknown }).name).trim();
    if (name === "") continue;
    out.push({ name, dials: normalizeDials((item as { dials?: unknown }).dials) });
  }
  return out;
}

export function loadSettings(raw: unknown): LingoTunerSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw) as LingoTunerSettings & { suppressThinking?: unknown; timeoutSec?: unknown; model?: unknown };
  const rawList = merged.endpoints as unknown as (string | EndpointConfig)[] | undefined;
  const rawChoice = (merged as { choice?: unknown }).choice;
  const choice: EndpointChoice = rawChoice && typeof rawChoice === "object"
    ? { ...((rawChoice as EndpointChoice).endpointId ? { endpointId: String((rawChoice as EndpointChoice).endpointId) } : {}),
        ...((rawChoice as EndpointChoice).model ? { model: String((rawChoice as EndpointChoice).model) } : {}) }
    : {};
  // suppressThinking ist Legacy (migriert von loadRequestSettings nach request.thinking.transform),
  // timeoutSec entfaellt seit dem Verbindungs-Tausch (die Fristen der Verbindung sind statisch).
  // Beide duerfen nicht als Fremdfeld durchgereicht werden — sonst persistiert saveData() sie weiter.
  // Das globale Modell (Welle 17) geht einmal in die Zeilen ohne Modell und faellt aus dem Ergebnis, sonst liefe die
  // Migration bei jedem Start erneut und fuellte eine absichtlich geleerte Zeile wieder.
  const { suppressThinking: _legacySuppress, timeoutSec: _legacyTimeout, model: legacyModel, ...clean } = merged;
  return {
    ...clean,
    endpoints: fillMissingRowModels(migrateEndpointList(undefined, rawList), legacyModel),
    lastDials: normalizeDials(merged.lastDials),
    userPresets: sanitizePresets(merged.userPresets),
    choice,
    request: sanitizeRequestSettings(merged.request).settings,
  };
}

/** Das alte `suppressThinking` (vor den Profilen) wandert einmalig nach `request.thinking[MODE]`; die Regel
 *  steht im Kit (`foldLegacyThinking`), hier nur Feldname und Modus. Das Altfeld loescht `loadSettings`. */
export const LEGACY_REQUEST_MIGRATIONS: readonly LegacyRequestMigration[] = [(raw, request) => foldLegacyThinking(request, MODE, raw.suppressThinking)];

export function allPresets(s: Pick<LingoTunerSettings, "userPresets">): Preset[] {
  return [
    ...BUILTIN_PRESETS,
    ...s.userPresets.map((p) => ({ id: userPresetId(p.name), label: p.name, dials: p.dials })),
  ];
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function upsertUserPreset(list: UserPreset[], name: string, dials: Dials): { list: UserPreset[]; replaced: boolean } {
  const clean = name.trim();
  const idx = list.findIndex((p) => same(p.name, clean));
  const entry = { name: clean, dials: { ...dials } };
  if (idx === -1) return { list: [...list, entry], replaced: false };
  const next = [...list];
  next[idx] = entry;
  return { list: next, replaced: true };
}

export function removeUserPreset(list: UserPreset[], name: string): UserPreset[] {
  return list.filter((p) => !same(p.name, name));
}
