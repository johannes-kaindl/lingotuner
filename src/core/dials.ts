/** Regler-Modell — die einzige Wahrheit ueber Dimensionen, Stufen und Presets.
 *  Obsidian-frei; das Modell bekommt nie eine Zahl, sondern den Stufennamen (prompt-text.ts). */

export type Level = -2 | -1 | 0 | 1 | 2;
export type Dimension = "directness" | "context" | "social" | "semantics";
export type Dials = Record<Dimension, Level>;

export const LEVELS: readonly Level[] = [-2, -1, 0, 1, 2];
export const DIMENSIONS: readonly Dimension[] = ["directness", "context", "social", "semantics"];

export const NEUTRAL: Dials = { directness: 0, context: 0, social: 0, semantics: 0 };

export interface Preset {
  id: string;
  /** null = ausgeliefertes Preset, Name kommt aus t(`preset.${id}`); sonst Nutzername. */
  label: string | null;
  dials: Dials;
}

export const BUILTIN_PRESETS: readonly Preset[] = [
  { id: "neutral", label: null, dials: { directness: 0, context: 0, social: 0, semantics: 0 } },
  { id: "clarity", label: null, dials: { directness: -2, context: -2, social: -2, semantics: -2 } },
  { id: "collegial", label: null, dials: { directness: -1, context: 0, social: 1, semantics: 0 } },
  { id: "polite", label: null, dials: { directness: 2, context: 1, social: 2, semantics: 1 } },
];

export function clampLevel(n: unknown): Level {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  const c = Math.max(-2, Math.min(2, v));
  return c as Level;
}

export function normalizeDials(raw: unknown): Dials {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Dials;
  for (const d of DIMENSIONS) out[d] = clampLevel(r[d]);
  return out;
}

export function sameDials(a: Dials, b: Dials): boolean {
  return DIMENSIONS.every((d) => a[d] === b[d]);
}

export function presetFor(dials: Dials, presets: readonly Preset[]): string | null {
  const hit = presets.find((p) => sameDials(p.dials, dials));
  return hit ? hit.id : null;
}

export function isNoop(dials: Dials, note: string): boolean {
  return sameDials(dials, NEUTRAL) && note.trim().length === 0;
}

export function levelKey(dim: Dimension, level: Level): string {
  return `level.${dim}.${level}`;
}

export function userPresetId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `user-${slug || "preset"}`;
}
