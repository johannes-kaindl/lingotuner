// Anbieter-Muster: vault-rag/src/plugin_api.ts (apiVersion, ok-diskriminierte Union, duenner Adapter ueber Deps)
import { isNoop, type Dials, type Preset } from "./dials";
import type { TuneResult } from "./llm/client";
import { errorMessageKey } from "./llm/errors";

export const LINGOTUNER_API_VERSION = 1;

export type TuneApiResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: "unknown-preset" | "noop" | "failed"; message?: string };

export interface LingoTunerApi {
  readonly apiVersion: number;
  presets(): { id: string; dials: Dials }[];
  tune(text: string, style: Dials | string, opts?: { note?: string; signal?: AbortSignal }): Promise<TuneApiResult>;
}

export interface ApiDeps {
  presets(): Preset[];
  run(text: string, dials: Dials, note: string, signal?: AbortSignal): Promise<TuneResult>;
}

export function createLingoTunerApi(deps: ApiDeps): LingoTunerApi {
  return {
    apiVersion: LINGOTUNER_API_VERSION,
    presets() { return deps.presets().map((p) => ({ id: p.id, dials: { ...p.dials } })); },
    async tune(text, style, opts) {
      let dials: Dials;
      if (typeof style === "string") {
        const p = deps.presets().find((x) => x.id === style || x.label === style);
        if (p === undefined) return { ok: false, reason: "unknown-preset" };
        dials = p.dials;
      } else {
        dials = style;
      }
      const note = opts?.note ?? "";
      if (isNoop(dials, note)) return { ok: false, reason: "noop" };
      const r = await deps.run(text, dials, note, opts?.signal);
      if (r.ok) return { ok: true, text: r.text, truncated: r.truncated };
      return { ok: false, reason: "failed", message: errorMessageKey(r.error).key };
    },
  };
}
