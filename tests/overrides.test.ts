import { describe, it, expect } from "vitest";
import {
  exampleFileName, parseExampleFile, renderExampleFile, loadOverrides, writeShippedTexts, SYSTEM_FILE,
} from "../src/core/examples/overrides";

function memFs(files: Record<string, string>) {
  return {
    files,
    reader: { read: (p: string) => Promise.resolve(p in files ? files[p] : null) },
    writer: {
      exists: (p: string) => Promise.resolve(p in files),
      write: (p: string, c: string) => { files[p] = c; return Promise.resolve(); },
      ensureFolder: () => Promise.resolve(),
    },
  };
}

describe("overrides", () => {
  it("Dateiname traegt Dimension und Stufe", () => {
    expect(exampleFileName("directness", -2)).toBe("directness_-2.md");
    expect(exampleFileName("social", 1)).toBe("social_1.md");
  });

  it("parseExampleFile liest ## before / ## after, trimmt, ist gross-klein-tolerant", () => {
    const p = parseExampleFile("## Before\n\nHallo  \n\n## after\nHi\n");
    expect(p).toEqual({ before: "Hallo", after: "Hi" });
    expect(parseExampleFile("nur Text")).toBeNull();
    expect(parseExampleFile("## before\n\n## after\nx")).toBeNull();
  });

  it("renderExampleFile ist die Umkehrung von parseExampleFile", () => {
    const pair = { before: "A\nB", after: "C" };
    expect(parseExampleFile(renderExampleFile(pair))).toEqual(pair);
  });

  it("leerer Ordner → keine Overrides, keine Probleme", async () => {
    const fs = memFs({});
    const r = await loadOverrides(fs.reader, "");
    expect(r).toEqual({ overrides: {}, problems: [] });
  });

  it("Teil-Override: nur vorhandene Dateien ersetzen, kaputte werden gemeldet und uebersprungen", async () => {
    const fs = memFs({
      "LT/system.md": "MEIN SYSTEM",
      "LT/context_2.md": "## before\nx\n## after\ny",
      "LT/social_-1.md": "kaputt",
    });
    const r = await loadOverrides(fs.reader, "LT/");
    expect(r.overrides.system).toBe("MEIN SYSTEM");
    expect(r.overrides.examples).toEqual({ "context:2": { before: "x", after: "y" } });
    expect(r.problems).toEqual(["LT/social_-1.md"]);
  });

  it("leere system.md heisst Auslieferungsstand, nicht leerer Prompt", async () => {
    const fs = memFs({ "LT/system.md": "  \n" });
    const r = await loadOverrides(fs.reader, "LT");
    expect(r.overrides.system).toBeUndefined();
  });

  it("writeShippedTexts legt 17 Dateien an und ueberspringt vorhandene", async () => {
    const fs = memFs({ "LT/directness_1.md": "meins" });
    const n = await writeShippedTexts(fs.writer, "LT", "de");
    expect(n).toBe(16);
    expect(Object.keys(fs.files)).toHaveLength(17);
    expect(fs.files["LT/directness_1.md"]).toBe("meins");
    expect(fs.files[`LT/${SYSTEM_FILE}`]).toContain("Dolmetscher");
    expect(parseExampleFile(fs.files["LT/semantics_2.md"])).not.toBeNull();
  });
});
