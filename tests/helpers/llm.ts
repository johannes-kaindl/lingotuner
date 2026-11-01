import { vi } from "vitest";
import type { ThinkingLevel } from "../../src/vendor/kit/sampling-profiles";
import type { FamilyId } from "../../src/vendor/kit/sampling-profiles";
import type { BackendId } from "../../src/vendor/kit/sampling-profiles";
import type { ViewDeps } from "../../src/obsidian/view";

/** Fake der Kit-Verbindung fuer die Modellzeile (`ModelBarConnection`: models, setModel, modelInUse, source). */
export function mkLlm(init: { models?: string[]; model?: string; defaultModel?: string; reachable?: boolean } = {}) {
  const st = { model: init.model ?? "", models: init.models ?? [], reachable: init.reachable ?? true, defaultModel: init.defaultModel };
  return {
    st,
    models: vi.fn((_o?: { force?: boolean }) => Promise.resolve({ models: [...st.models], reachable: st.reachable })),
    setModel: vi.fn((m: string) => { st.model = m; return Promise.resolve(); }),
    modelInUse: () => st.model,
    source: () => (st.defaultModel === undefined ? {} : { defaultModel: st.defaultModel }),
  };
}

/** Zustand der Denk-Steuerung, wie `main.ts` ihn aus den Einstellungen liest. */
export function mkThinking(init: { family?: FamilyId | null; backend?: BackendId; level?: ThinkingLevel; onLevel?: ThinkingLevel; levelPicker?: boolean } = {}) {
  const st = { family: init.family ?? null, backend: init.backend ?? ("lmstudio" as BackendId), level: init.level ?? ("off" as ThinkingLevel), onLevel: init.onLevel ?? ("low" as ThinkingLevel), levelPicker: init.levelPicker ?? false };
  const thinking: ViewDeps["thinking"] = {
    family: () => st.family,
    backend: () => st.backend,
    current: () => st.level,
    onLevel: () => st.onLevel,
    setLevel: (l) => { st.level = l; return Promise.resolve(); },
    levelPicker: () => st.levelPicker,
  };
  return { st, thinking };
}
