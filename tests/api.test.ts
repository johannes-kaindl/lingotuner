import { describe, it, expect, vi } from "vitest";
import { createLingoTunerApi, LINGOTUNER_API_VERSION } from "../src/core/api";
import { BUILTIN_PRESETS, NEUTRAL } from "../src/core/dials";

describe("LingoTunerApi", () => {
  const run = vi.fn(() => Promise.resolve({ ok: true as const, text: "out", reasoning: "", model: "m", truncated: false }));
  const api = createLingoTunerApi({ presets: () => [...BUILTIN_PRESETS], run });

  it("traegt apiVersion und die Presets", () => {
    expect(api.apiVersion).toBe(LINGOTUNER_API_VERSION);
    expect(api.presets().map((p) => p.id)).toContain("clarity");
  });
  it("tune mit Preset-Namen loest auf und liefert Text", async () => {
    const r = await api.tune("x", "clarity", { note: "n" });
    expect(r).toEqual({ ok: true, text: "out", truncated: false });
    expect(run).toHaveBeenCalledWith("x", BUILTIN_PRESETS[1].dials, "n", undefined);
  });
  it("unbekanntes Preset, Noop und Fehler werden benannt", async () => {
    expect(await api.tune("x", "nope")).toEqual({ ok: false, reason: "unknown-preset" });
    expect(await api.tune("x", NEUTRAL)).toEqual({ ok: false, reason: "noop" });
    const failing = createLingoTunerApi({ presets: () => [], run: () => Promise.resolve({ ok: false as const, error: { kind: "network" as const }, partial: "" }) });
    expect(await failing.tune("x", { ...NEUTRAL, social: 1 })).toMatchObject({ ok: false, reason: "failed" });
  });
});
