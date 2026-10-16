import { describe, it, expect } from "vitest";
import { DEFAULT_REQUEST_SETTINGS, type BackendId, type FamilyId } from "../src/vendor/kit/sampling-profiles";
import { DONE, delta, fakeTransport, makeConnection, type Seen } from "./helpers/connection";

// Goldene Requests (Rezept 8): erzeugt ueber die Verbindung DES PLUGINS (Modus "transform", Familie aus
// dem Modellnamen, Backend aus der Erkennung) — der Body, der am Transport ankommt, ist der Request.
// Denkstufe ist die Modus-Vorgabe "off": die Wirkung einer Denkstufe ist bereits in code-kits eigenen
// resolveRequestParams-Tests abgedeckt (Task 2 des Plans).
const MODEL_OF: Record<string, string> = { "qwen3.8": "qwen3.8-27b", "qwen3.6": "qwen3.6-35b", gemma4: "gemma-4-12b", "gpt-oss": "gpt-oss-20b", null: "irgendein-modell" };

/** Der Body ohne die Felder, die der Client selbst setzt (`model`, `messages`, `stream`). */
async function sentParams(family: FamilyId | null, backend: BackendId, overrides: Record<string, number | string> = {}): Promise<Record<string, unknown>> {
  const seen: Seen = {};
  const request = { ...DEFAULT_REQUEST_SETTINGS, thinking: { transform: "off" as const }, overrides: family === null ? {} : { transform: { [family]: overrides } } };
  const llm = makeConnection({ transport: fakeTransport([delta("ok"), DONE], 200, seen), backend, settings: { model: MODEL_OF[String(family)], request } });
  await llm.complete({ messages: [{ role: "user", content: "x" }] });
  const { model: _m, messages: _msg, stream: _s, ...params } = seen.body ?? {};
  return params;
}
describe("goldene Requests — transform, Denkstufe aus, ohne Ueberschreibung", () => {
  const families: (FamilyId | null)[] = ["qwen3.8", "qwen3.6", "gemma4", "gpt-oss", null];
  const backends: BackendId[] = ["lmstudio", "openwebui", "unknown"];

  const EXPECTED: Record<string, Record<BackendId, Record<string, number | string>>> = {
    "qwen3.8": {
      lmstudio: { temperature: 0.2, top_p: 0.8, top_k: 20, min_p: 0, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.8, reasoning_effort: "none" },
      ollama: {}, openai: {}, anthropic: {},
    },
    "qwen3.6": {
      lmstudio: { temperature: 0.2, top_p: 0.95, top_k: 20, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.95, top_k: 20, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" },
      ollama: {}, openai: {}, anthropic: {},
    },
    "gemma4": {
      // code-kit 0.28.0: LM Studio ignoriert "none" bei gemma 4 (das Denken landete im Antworttext), "aus" sendet dort die niedrigste Stufe.
      lmstudio: { temperature: 0.2, top_p: 0.95, top_k: 64, reasoning_effort: "low" },
      openwebui: { temperature: 0.2, top_p: 0.95, top_k: 64, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" },
      ollama: {}, openai: {}, anthropic: {},
    },
    "gpt-oss": {
      lmstudio: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      openwebui: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      unknown: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      ollama: {}, openai: {}, anthropic: {},
    },
    "null": {
      lmstudio: { temperature: 0.2, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, reasoning_effort: "none" },
      unknown: { temperature: 0.2 },
      ollama: {}, openai: {}, anthropic: {},
    },
  };

  for (const family of families) {
    for (const backend of backends) {
      it(`${family ?? "unbekannt"} × ${backend}`, async () => {
        const params = await sentParams(family, backend);
        expect(params).toEqual(EXPECTED[family ?? "null"][backend]);
      });
    }
  }

  it("nie chat_template_kwargs oder reasoning_budget, unabhaengig von Familie/Backend", async () => {
    for (const family of families) for (const backend of backends) {
      const params = await sentParams(family, backend);
      expect(params).not.toHaveProperty("chat_template_kwargs");
      expect(params).not.toHaveProperty("reasoning_budget");
    }
  });

  it("eine Ueberschreibung fuer die aufgeloeste Familie gewinnt", async () => {
    const params = await sentParams("qwen3.8", "lmstudio", { temperature: 0.9 });
    expect(params.temperature).toBe(0.9);
  });
});
