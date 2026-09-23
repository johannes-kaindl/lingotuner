import { describe, it, expect } from "vitest";
import { buildTuneParams } from "../src/core/llm/client";
import type { BackendId, FamilyId } from "../src/vendor/kit/sampling-profiles";

// Goldene Requests (Rezept 8): erzeugt ueber die Request-Bau-Funktion DES PLUGINS
// (buildTuneParams, fester Modus "transform") — nicht ueber resolveRequestParams direkt,
// sonst pruefte der Test das Kit statt das Plugin. Denkstufe ist die Modus-Vorgabe "off":
// die Wirkung einer Denkstufe ist bereits in code-kits eigenen resolveRequestParams-Tests
// abgedeckt (Task 2 des Plans).
describe("goldene Requests — transform, Denkstufe aus, ohne Ueberschreibung", () => {
  const families: (FamilyId | null)[] = ["qwen3.8", "qwen3.6", "gemma4", "gpt-oss", null];
  const backends: BackendId[] = ["lmstudio", "openwebui", "unknown"];

  const EXPECTED: Record<string, Record<BackendId, Record<string, number | string>>> = {
    "qwen3.8": {
      lmstudio: { temperature: 0.2, top_p: 0.8, top_k: 20, min_p: 0, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.8, reasoning_effort: "none" },
      ollama: {}, openai: {},
    },
    "qwen3.6": {
      lmstudio: { temperature: 0.2, top_p: 0.95, top_k: 20, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.95, top_k: 20, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" },
      ollama: {}, openai: {},
    },
    "gemma4": {
      lmstudio: { temperature: 0.2, top_p: 0.95, top_k: 64, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.95, top_k: 64, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" },
      ollama: {}, openai: {},
    },
    "gpt-oss": {
      lmstudio: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      openwebui: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      unknown: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      ollama: {}, openai: {},
    },
    "null": {
      lmstudio: { temperature: 0.2, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, reasoning_effort: "none" },
      unknown: { temperature: 0.2 },
      ollama: {}, openai: {},
    },
  };

  for (const family of families) {
    for (const backend of backends) {
      it(`${family ?? "unbekannt"} × ${backend}`, () => {
        const { params } = buildTuneParams({ family, backend, thinking: "off" });
        expect(params).toEqual(EXPECTED[family ?? "null"][backend]);
      });
    }
  }

  it("nie chat_template_kwargs oder reasoning_budget, unabhaengig von Familie/Backend", () => {
    for (const family of families) for (const backend of backends) {
      const { params } = buildTuneParams({ family, backend, thinking: "off" });
      expect(params).not.toHaveProperty("chat_template_kwargs");
      expect(params).not.toHaveProperty("reasoning_budget");
    }
  });

  it("eine Ueberschreibung fuer die aufgeloeste Familie gewinnt", () => {
    const { params } = buildTuneParams({ family: "qwen3.8", backend: "lmstudio", thinking: "off", overrides: { temperature: 0.9 } });
    expect(params.temperature).toBe(0.9);
  });
});
