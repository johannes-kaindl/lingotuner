import { describe, it, expect } from "vitest";
import { splitStable } from "../src/vendor/kit/stream-blocks";

/** Rauchprobe des VENDORINGS, nicht des Algorithmus: `splitStable` wird seit 0.33.1 nicht mehr
 *  hier gepflegt, sondern aus code-kit vendored (`tools/sync-kit.sh`). Die drei Faelle bleiben
 *  stehen, weil ein leeres oder halb kopiertes Vendor-Modul sonst erst im Stream auffiele —
 *  und dort als Plugin-Fehler aussaehe. */
describe("splitStable (vendored)", () => {
  it("schneidet an der letzten Absatzgrenze", () => {
    expect(splitStable("A\n\nB\n\nC lae")).toEqual({ stable: "A\n\nB\n\n", tail: "C lae" });
  });
  it("eine Leerzeile im offenen Codeblock ist keine Grenze", () => {
    expect(splitStable("```\nx\n\ny")).toEqual({ stable: "", tail: "```\nx\n\ny" });
  });
  it("ohne Grenze bleibt alles tail", () => {
    expect(splitStable("nur eine Zeile")).toEqual({ stable: "", tail: "nur eine Zeile" });
  });
});
