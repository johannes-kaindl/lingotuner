import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

// Kit-Vertrag: die `*_CSS`-Konstanten der gevendorten Bausteine gehoeren wortgleich in die styles.css
// (vendort wird nur das Verhalten, die Darstellung ist eine Kopie).
describe("Kit-CSS", () => {
  it("jede gevendorte *_CSS-Konstante steht wortgleich in styles.css", () => {
    expect(findVendoredCss("src/vendor/kit-obsidian").length).toBeGreaterThan(0);
    expect(missingKitCss("src/vendor/kit-obsidian", readFileSync("styles.css", "utf8"))).toEqual([]);
  });
});
