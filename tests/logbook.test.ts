import { describe, it, expect } from "vitest";
import { logbookPath, renderLogEntry, LOGBOOK_FRONTMATTER } from "../src/core/logbook";
import { NEUTRAL } from "../src/core/dials";
import { t } from "../src/vendor/kit/i18n";
import "../src/i18n/strings";

describe("logbook", () => {
  it("Pfad ist Monatsnotiz im Ordner, Wurzel ohne Praefix", () => {
    const d = new Date(2026, 8, 7, 15, 4);
    expect(logbookPath("LT", d)).toBe("LT/LingoTuner 2026-09.md");
    expect(logbookPath("", d)).toBe("LingoTuner 2026-09.md");
    expect(LOGBOOK_FRONTMATTER).toBe("---\ntype: lingotuner-log\n---\n");
  });
  it("Eintrag traegt Zeit, Modell, Regler, Anmerkung, Original und Ergebnis als Zitat", () => {
    const s = renderLogEntry({ at: new Date(2026, 8, 7, 15, 4), model: "m", dials: { ...NEUTRAL, social: 2 }, note: "duzen", input: "A\nB", output: "C" });
    expect(s).toContain("## 2026-09-07 15:04 · m");
    // Reglerzeile NUR lokalisiert — die frueher angehaengte englische Haelfte
    // („· directness 0, context 0, social 2, semantics 0") ist weg.
    expect(s).toContain(t("logbook.dials", "0", "0", "2", "0"));
    expect(s).not.toContain("· directness 0");
    expect(s).toContain("duzen");
    expect(s).toContain("> A\n> B");
    expect(s).toContain("> C");
    expect(s.endsWith("\n")).toBe(true);
  });
});
