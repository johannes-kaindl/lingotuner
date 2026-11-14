import { vi } from "vitest";
import type { ThinkingLevel } from "../../src/vendor/kit/sampling-profiles";
import type { FamilyId } from "../../src/vendor/kit/sampling-profiles";
import type { BackendId } from "../../src/vendor/kit/sampling-profiles";
import type { ViewDeps } from "../../src/obsidian/view";
import type { ApiErrorCode } from "../../src/vendor/kit/endpoint-source";

export interface FakeEndpoints {
  list: Array<{ id: string; label: string; defaultModel?: string }>;
  active?: string;
  choice?: { endpointId?: string; model?: string };
  lists?: Record<string, { models: string[]; reachable: boolean }>;
  /** Grund einer verwaisten Wahl (`source().reason`), wie ihn die Kit-Verbindung meldet. */
  reason?: ApiErrorCode;
}

/** Fake der Kit-Verbindung fuer die Modellzeile (`ModelBarConnection`, Kit 0.87.0 bis 0.89.0). Ohne `endpoints` ein Adapter ohne Manager (`endpoints()` leer: die Zeile zeigt eine Liste ohne Gruppen);
 *  mit `endpoints` die Gruppen je Endpunkt, `setChoice` schreibt die Wahl und meldet an die Abonnenten wie `LlmConnection`. */
export function mkLlm(init: { models?: string[]; model?: string; defaultModel?: string; reachable?: boolean; endpoints?: FakeEndpoints } = {}) {
  const st = { model: init.model ?? "", models: init.models ?? [], reachable: init.reachable ?? true, defaultModel: init.defaultModel };
  const fe: FakeEndpoints = init.endpoints ?? { list: [] };
  const subs = new Set<() => void>();
  const notify = (): void => { for (const cb of [...subs]) cb(); };
  return {
    st,
    fe,
    subs,
    notify,
    models: vi.fn((_o?: { force?: boolean }) => Promise.resolve({ models: [...st.models], reachable: st.reachable })),
    setModel: vi.fn((m: string) => { st.model = m; return Promise.resolve(); }),
    modelInUse: () => st.model,
    source: () => ({ ...(st.defaultModel === undefined ? {} : { defaultModel: st.defaultModel }), ...(fe.reason === undefined ? {} : { reason: fe.reason }) }),
    endpoints: () => fe.list,
    activeEndpointId: () => fe.active,
    modelsOf: vi.fn((id: string, _o?: { force?: boolean }) => Promise.resolve(fe.lists?.[id] ?? { models: [], reachable: false })),
    choice: () => fe.choice ?? {},
    setChoice: vi.fn((c: { endpointId?: string; model?: string }) => { fe.choice = c; if (c.endpointId !== undefined) fe.active = c.endpointId; fe.reason = undefined; notify(); return Promise.resolve(); }),
    subscribe: (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
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
