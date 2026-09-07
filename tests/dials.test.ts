import { describe, it, expect } from "vitest";
import {
  BUILTIN_PRESETS, NEUTRAL, DIMENSIONS, clampLevel, normalizeDials, sameDials, presetFor, isNoop, levelKey, userPresetId,
} from "../src/core/dials";

describe("dials", () => {
  it("clampLevel rundet und begrenzt auf -2..2, Unsinn wird 0", () => {
    expect(clampLevel(3)).toBe(2);
    expect(clampLevel(-7)).toBe(-2);
    expect(clampLevel(1.4)).toBe(1);
    expect(clampLevel("x")).toBe(0);
    expect(clampLevel(undefined)).toBe(0);
  });

  it("normalizeDials fuellt fehlende Dimensionen mit 0 und verwirft fremde Felder", () => {
    const d = normalizeDials({ directness: -2, semantics: 9, foo: 1 });
    expect(d).toEqual({ directness: -2, context: 0, social: 0, semantics: 2 });
    expect(Object.keys(d)).toEqual([...DIMENSIONS]);
  });

  it("presetFor findet das Preset mit exakt gleichen Werten, sonst null", () => {
    expect(presetFor(NEUTRAL, BUILTIN_PRESETS)).toBe("neutral");
    expect(presetFor({ ...NEUTRAL, social: 1 }, BUILTIN_PRESETS)).toBeNull();
    expect(presetFor({ directness: -2, context: -2, social: -2, semantics: -2 }, BUILTIN_PRESETS)).toBe("clarity");
  });

  it("isNoop: alle 0 und leere Anmerkung → true; eine Anmerkung allein reicht fuer einen Lauf", () => {
    expect(isNoop(NEUTRAL, "")).toBe(true);
    expect(isNoop(NEUTRAL, "   ")).toBe(true);
    expect(isNoop(NEUTRAL, "duzen")).toBe(false);
    expect(isNoop({ ...NEUTRAL, context: 1 }, "")).toBe(false);
  });

  it("levelKey bildet den i18n-Schluessel", () => {
    expect(levelKey("directness", -2)).toBe("level.directness.-2");
  });

  it("die vier ausgelieferten Presets sind eindeutig und vollstaendig", () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual(["neutral", "clarity", "collegial", "polite"]);
    for (const p of BUILTIN_PRESETS) expect(p.label).toBeNull();
  });

  it("userPresetId ist stabil und kollidiert nicht mit builtin-Ids", () => {
    expect(userPresetId("Mail an Chef")).toBe("user-mail-an-chef");
    expect(userPresetId("neutral")).toBe("user-neutral");
  });

  it("sameDials vergleicht alle vier Dimensionen", () => {
    expect(sameDials(NEUTRAL, { ...NEUTRAL })).toBe(true);
    expect(sameDials(NEUTRAL, { ...NEUTRAL, semantics: -1 })).toBe(false);
  });
});
