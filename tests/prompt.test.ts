import { describe, it, expect } from "vitest";
import { buildMessages, systemPrompt, examplesFor } from "../src/core/prompt";
import { PROMPT_TEXT } from "../src/core/prompt-text";
import { DIMENSIONS, NEUTRAL, type Dials } from "../src/core/dials";
import { exampleKey, type ExampleLevel } from "../src/core/examples/types";

const LANGS = ["en", "de"] as const;
const LEVELS: ExampleLevel[] = [-2, -1, 1, 2];

describe("Beispielbank", () => {
  for (const lang of LANGS) {
    it(`${lang}: 16 Paare, je Dimension und Stufe genau eines, before != after`, () => {
      const ex = examplesFor(lang);
      expect(ex).toHaveLength(16);
      const keys = new Set(ex.map((p) => exampleKey(p.dimension, p.level)));
      expect(keys.size).toBe(16);
      for (const p of ex) {
        expect(p.before.trim()).not.toBe("");
        expect(p.after.trim()).not.toBe("");
        expect(p.before).not.toBe(p.after);
      }
    });
  }
});

describe("buildMessages", () => {
  for (const lang of LANGS) {
    it(`${lang}: jedes der 16 Paare landet mit seinem Stufennamen im Prompt`, () => {
      for (const p of examplesFor(lang)) {
        const dials: Dials = { ...NEUTRAL, [p.dimension]: p.level };
        const [sys] = buildMessages("x", dials, { lang });
        expect(sys.role).toBe("system");
        expect(sys.content).toContain(p.before);
        expect(sys.content).toContain(p.after);
        expect(sys.content).toContain(PROMPT_TEXT[lang].levels[p.dimension][p.level]);
      }
    });
  }

  it("Stufe 0 erzeugt keine Anweisung fuer die Dimension", () => {
    const [sys] = buildMessages("x", { ...NEUTRAL, social: 2 }, { lang: "en" });
    for (const d of DIMENSIONS) {
      if (d === "social") continue;
      for (const l of LEVELS) expect(sys.content).not.toContain(PROMPT_TEXT.en.levels[d][l]);
    }
  });

  it("der Text steht allein in der Nutzer-Nachricht", () => {
    const msgs = buildMessages("Hallo Welt", { ...NEUTRAL, directness: -1 }, { lang: "de" });
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: "user", content: "Hallo Welt" });
  });

  it("die Anmerkung kommt mit Vorrangs-Satz hinter die Regler, und nur wenn nicht leer", () => {
    const withNote = buildMessages("x", NEUTRAL, { lang: "en", note: "use first names" })[0].content;
    expect(withNote).toContain(PROMPT_TEXT.en.noteHead);
    expect(withNote).toContain("use first names");
    expect(withNote.indexOf(PROMPT_TEXT.en.noteHead)).toBeGreaterThan(withNote.indexOf(PROMPT_TEXT.en.role));
    const without = buildMessages("x", { ...NEUTRAL, context: 1 }, { lang: "en", note: "  " })[0].content;
    expect(without).not.toContain(PROMPT_TEXT.en.noteHead);
  });

  it("systemPrompt ist der stabile Teil: gleich mit und ohne Anmerkung", () => {
    const d: Dials = { ...NEUTRAL, semantics: -2 };
    expect(systemPrompt(d, { lang: "en", note: "a" })).toBe(systemPrompt(d, { lang: "en" }));
    expect(buildMessages("x", d, { lang: "en" })[0].content).toBe(systemPrompt(d, { lang: "en" }));
  });

  it("Overrides ersetzen System-Prosa und einzelne Paare", () => {
    const d: Dials = { ...NEUTRAL, directness: 2 };
    const [sys] = buildMessages("x", d, {
      lang: "de",
      overrides: { system: "MEIN SYSTEM", examples: { "directness:2": { before: "VORHER", after: "NACHHER" } } },
    });
    expect(sys.content.startsWith("MEIN SYSTEM")).toBe(true);
    expect(sys.content).toContain("VORHER");
    expect(sys.content).toContain("NACHHER");
    expect(sys.content).not.toContain(PROMPT_TEXT.de.role);
  });

  it("die Invarianten stehen in jedem Prompt, auch bei reiner Anmerkung", () => {
    const [sys] = buildMessages("x", NEUTRAL, { lang: "de", note: "kuerzer" });
    for (const inv of PROMPT_TEXT.de.invariants) expect(sys.content).toContain(inv);
  });
});
