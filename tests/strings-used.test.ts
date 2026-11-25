import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Jeder Schluessel in `src/i18n/strings.ts` hat einen Leser im Code (ausserhalb von i18n und vendor). Tote Texte verleiten zu falscher Doku: nach dem Umstieg auf den
 *  Kit-Rahmen standen 47 Schluessel ohne Leser im Katalog, die README zitierte einen davon (Welle 38). Dynamisch gebaute Schluessel (`dial.${d}`, `level.${dim}.${level}`)
 *  zaehlen ueber ihr Muster aus dem Quelltext. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "vendor" || e.name === "i18n" ? [] : sources(p);
    return e.name.endsWith(".ts") ? [readFileSync(p, "utf8")] : [];
  });
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function unusedKeys(catalog: string, code: string): string[] {
  const keys = [...new Set([...catalog.matchAll(/^\s+"([a-zA-Z0-9_.-]+)":/gm)].map((m) => m[1] ?? ""))];
  const patterns = [...code.matchAll(/`((?:[a-zA-Z0-9_.-]|\$\{[^}]*\})*)`/g)]
    .map((m) => m[1] ?? "")
    .filter((p) => p.includes("${") && !p.startsWith("${"))
    .map((p) => new RegExp("^" + p.split(/\$\{[^}]*\}/).map(escape).join("[a-zA-Z0-9_-]+") + "$"));
  return keys.filter((k) => !code.includes(`"${k}"`) && !patterns.some((r) => r.test(k)));
}

describe("strings.ts", () => {
  const catalog = readFileSync("src/i18n/strings.ts", "utf8");
  const code = sources("src").join("\n");

  it("jeder Schluessel hat einen Leser im Code", () => {
    expect(unusedKeys(catalog, code)).toEqual([]);
  });

  it("Gegenprobe: ein Schluessel ohne Leser wird gemeldet, ein dynamischer Schluessel nicht", () => {
    const probe = `{\n    "tot.schluessel": "x",\n    "dial.directness": "y",\n}`;
    expect(unusedKeys(probe, "t(`dial.${d}`)")).toEqual(["tot.schluessel"]);
  });
});
