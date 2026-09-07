import { describe, it, expect } from "vitest";
import { STRINGS } from "../src/i18n/strings";
import { DIMENSIONS, LEVELS, BUILTIN_PRESETS } from "../src/core/dials";

describe("strings", () => {
  it("EN und DE tragen dieselben Schluessel", () => {
    const en = Object.keys(STRINGS.en).sort();
    const de = Object.keys(STRINGS.de).sort();
    expect(de).toEqual(en);
  });

  it("jede Stufe jeder Dimension hat einen Namen, jedes Preset ein Label", () => {
    const en = STRINGS.en as Record<string, string>;
    for (const d of DIMENSIONS) for (const l of LEVELS) expect(en[`level.${d}.${l}`], `level.${d}.${l}`).toBeTruthy();
    for (const p of BUILTIN_PRESETS) expect(en[`preset.${p.id}`]).toBeTruthy();
  });
});
