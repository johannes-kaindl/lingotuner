import { mergeSettings } from "../vendor/kit/settings";
import { migrateEndpointList, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { BUILTIN_PRESETS, NEUTRAL, normalizeDials, userPresetId, type Dials, type Preset } from "./dials";

export interface UserPreset { name: string; dials: Dials }

export interface LingoTunerSettings {
  endpoints: EndpointConfig[];
  /** leer = Server entscheidet (modellagnostisch, GET /v1/models liefert die Liste) */
  model: string;
  suppressThinking: boolean;
  timeoutSec: number;
  overrideFolder: string;
  userPresets: UserPreset[];
  lastDials: Dials;
  logbookEnabled: boolean;
  logbookFolder: string;
  newNoteFolder: string;
}

export const TIMEOUT_SEC_MIN = 5;

export const DEFAULT_SETTINGS: LingoTunerSettings = {
  endpoints: [{ url: "http://127.0.0.1:1234" }],
  model: "",
  suppressThinking: true,
  timeoutSec: 60,
  overrideFolder: "",
  userPresets: [],
  lastDials: { ...NEUTRAL },
  logbookEnabled: false,
  logbookFolder: "LingoTuner",
  newNoteFolder: "",
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
  const merged = mergeSettings(DEFAULT_SETTINGS, raw);
  const rawList = merged.endpoints as unknown as (string | EndpointConfig)[] | undefined;
  return {
    ...merged,
    endpoints: migrateEndpointList(undefined, rawList),
    lastDials: normalizeDials(merged.lastDials),
    userPresets: sanitizePresets(merged.userPresets),
    timeoutSec: Math.max(TIMEOUT_SEC_MIN, Number(merged.timeoutSec) || DEFAULT_SETTINGS.timeoutSec),
  };
}

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
