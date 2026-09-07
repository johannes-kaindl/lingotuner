import { describe, it, expect } from "vitest";
import {
  EMPTY_CAPTURE, readiness, readinessKey, isRangeStale, splitSelectionAffix, splitFrontmatter, noteName, type Capture,
} from "../src/core/source";

const cap = (kind: "selection" | "note", text: string): Capture =>
  ({ kind, path: "Ordner/Mail.md", name: "Mail", text, from: { line: 0, ch: 0 }, to: { line: 0, ch: text.length } });

describe("readiness", () => {
  it("selection: bereit mit Zeichenzahl und Name", () => {
    const r = readiness("selection", { ...EMPTY_CAPTURE, selection: cap("selection", "Hallo") }, "");
    expect(r).toEqual({ kind: "ready", text: "Hallo", chars: 5, name: "Mail" });
  });
  it("selection ohne Markierung, mit Blockgrund oder ohne Editor", () => {
    expect(readiness("selection", EMPTY_CAPTURE, "").kind).toBe("no-selection");
    expect(readiness("selection", { ...EMPTY_CAPTURE, blocked: "reading-mode" }, "").kind).toBe("reading-mode");
    expect(readiness("note", { ...EMPTY_CAPTURE, blocked: "no-note" }, "").kind).toBe("no-note");
    expect(readiness("note", EMPTY_CAPTURE, "").kind).toBe("no-note");
  });
  it("text: Whitespace ist leer, sonst bereit ohne Namen", () => {
    expect(readiness("text", EMPTY_CAPTURE, "  \n").kind).toBe("empty-text");
    expect(readiness("text", EMPTY_CAPTURE, "abc")).toEqual({ kind: "ready", text: "abc", chars: 3, name: null });
  });
  it("readinessKey liefert den i18n-Schluessel", () => {
    expect(readinessKey({ kind: "no-selection" })).toBe("source.noSelection");
    expect(readinessKey({ kind: "reading-mode" })).toBe("source.readingMode");
    expect(readinessKey({ kind: "no-note" })).toBe("source.noNote");
    expect(readinessKey({ kind: "empty-text" })).toBe("source.emptyText");
    expect(readinessKey({ kind: "ready", text: "x", chars: 1, name: null })).toBe("");
  });
});

describe("Helfer", () => {
  it("isRangeStale vergleicht exakt", () => {
    expect(isRangeStale("a", "a")).toBe(false);
    expect(isRangeStale("a ", "a")).toBe(true);
  });
  it("splitSelectionAffix: lead nur Zeilenumbruch-Anteil, Einzug bleibt im Kern, Invariante lead+core+trail", () => {
    const t = "\n\n    Text hier\n";
    const s = splitSelectionAffix(t);
    expect(s).toEqual({ lead: "\n\n", core: "    Text hier", trail: "\n" });
    expect(s.lead + s.core + s.trail).toBe(t);
  });
  it("splitFrontmatter trennt den YAML-Kopf inklusive Trennzeile", () => {
    const c = "---\ntitle: x\n---\n\nBody";
    expect(splitFrontmatter(c)).toEqual({ head: "---\ntitle: x\n---\n", body: "\nBody" });
    expect(splitFrontmatter("kein fm")).toEqual({ head: "", body: "kein fm" });
    expect(splitFrontmatter("---\r\na: 1\r\n---\r\nB")).toEqual({ head: "---\r\na: 1\r\n---\r\n", body: "B" });
    expect(splitFrontmatter("---\ntitle: x\n---")).toEqual({ head: "---\ntitle: x\n---", body: "" });
    expect(splitFrontmatter("---\ntitle: x\n---\n")).toEqual({ head: "---\ntitle: x\n---\n", body: "" });
  });
  it("noteName ist der Dateiname ohne .md", () => {
    expect(noteName("A/B/Mail an X.md")).toBe("Mail an X");
    expect(noteName("Notiz.md")).toBe("Notiz");
  });
});
