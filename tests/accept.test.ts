/** Die drei Schreibwege ueber den Kit-Baustein `acceptPanel` (obsidian-kit 0.111.0): was lingotuner einsetzt (Spec, Texte, Ordner, Name), geschrieben in eine
 *  Fake-Ablage. Fingerabdruck, Wiederfinden und Lesemodus prueft das Kit selbst; hier steht, dass lingotuners Teile den Rand-Leerraum, die Runden-Kette und den Namen tragen. */
import { describe, it, expect, vi } from "vitest";
import { TFile } from "./__mocks__/obsidian";
import "../src/i18n/strings";
import { acceptStrings, tuneWays, type NewNoteDeps } from "../src/obsidian/accept";
import { acceptPanel, type AcceptEnv } from "../src/vendor/kit-obsidian/panel-accept";
import { ACCEPT_STRINGS_DE } from "../src/vendor/kit-obsidian/panel-accept-strings";
import { freshSession, type Round, type TuneSession } from "../src/core/session";
import { NEUTRAL } from "../src/core/dials";
import { pushRound } from "../src/vendor/kit/rounds";
import type { Target } from "../src/vendor/kit/panel-session";
import { setLang, t } from "../src/vendor/kit/i18n";

function round(input: string, output: string, sourceName: string | null = "Mail"): Round {
  return { dials: NEUTRAL, note: "", input, output, model: "m", at: 0, basedOn: null, sourceName, truncated: false };
}

function sessionWith(target: Target, r: Round): TuneSession {
  const s = freshSession(target);
  return { ...s, rounds: pushRound(s.rounds, r) };
}

function env(files: Record<string, string>) {
  const store: Record<string, string> = { ...files };
  const folders = new Set<string>();
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p in store ? new TFile(p, "md") : null),
      create: vi.fn((path: string, data: string) => { store[path] = data; return Promise.resolve({ path }); }),
      adapter: {
        exists: (p: string) => Promise.resolve(folders.has(p) || p in store),
        mkdir: (p: string) => { folders.add(p); return Promise.resolve(); },
      },
    },
  };
  const e: AcceptEnv = {
    app: app as never,
    ports: {
      editorFor: () => null,
      vault: {
        read: (p: string) => Promise.resolve(store[p] ?? null) as Promise<string>,
        process: (p: string, fn: (x: string) => string) => { store[p] = fn(store[p] ?? ""); return Promise.resolve(); },
      },
    } as never,
    lastEditor: () => null,
    strings: acceptStrings("en"),
    readingMode: "refuse",
  };
  return { env: e, store, folders };
}

const deps = (over: Partial<NewNoteDeps> = {}): NewNoteDeps => ({ folder: () => "Out", stamp: () => "LingoTuner 2026-11-25 09-30", open: vi.fn(), ...over });
const way = (s: TuneSession, id: string, d = deps()) => {
  const w = tuneWays(s, () => s, d).find((x) => x.id === id);
  if (!w) throw new Error(`kein Weg ${id}`);
  return w;
};

describe("Markierung ersetzen (Ziel selection)", () => {
  const NOTE = "A\n\n  alt\nB";
  // Markiert von Zeile 1 bis Zeile 3 Anfang: „\n  alt\n“ (fuehrender Zeilenumbruch und nachlaufender Leerraum bleiben stehen)
  const SEL: Target = { kind: "selection", path: "n.md", from: { line: 1, ch: 0 }, to: { line: 3, ch: 0 }, label: "Markierung in n", text: "\n  alt\n", noteLines: 4 };

  it("schreibt lead + Ergebnis + trail in die Spanne, der Rest der Notiz bleibt", async () => {
    const { env: e, store } = env({ "n.md": NOTE });
    const s = sessionWith(SEL, round("\n  alt\n", "neu"));
    const w = way(s, "replace-selection");
    const r = await acceptPanel(e, w.spec, w.target?.(s) ?? s.target, w.kind(s), w.where);
    expect(r).toMatchObject({ ok: true });
    expect(store["n.md"]).toBe("A\n\nneu\nB");
  });

  it("Gegenprobe: begann die Kette aus anderem Text, wird nichts geschrieben", async () => {
    const { env: e, store } = env({ "n.md": NOTE });
    const s = sessionWith(SEL, round("anderer Text", "neu"));
    const w = way(s, "replace-selection");
    const r = await acceptPanel(e, w.spec, s.target, w.kind(s), w.where);
    expect(r.ok).toBe(false);
    expect(store["n.md"]).toBe(NOTE);
  });

  it("der Weg erscheint nur auf dem Ziel selection", () => {
    const s = sessionWith({ kind: "file", path: "n.md", label: "Notiz n" }, round("x", "y"));
    expect(tuneWays(s, () => s, deps()).map((w) => w.id)).toEqual(["replace-note", "new-note"]);
    expect(tuneWays(sessionWith(SEL, round("x", "y")), () => s, deps()).map((w) => w.id)).toEqual(["replace-selection", "new-note"]);
  });
});

describe("Neue Notiz (where note, eigenes Ziel new)", () => {
  it("aus einer Markierung: Ordner der Einstellung, Name aus der Quellnotiz, Inhalt genau das Ergebnis, Markierung unberuehrt, geoeffnet", async () => {
    const { env: e, store } = env({ "Mail.md": "Hallo" });
    const SEL: Target = { kind: "selection", path: "Mail.md", from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 }, label: "Markierung in Mail", text: "Hallo" };
    const s = sessionWith(SEL, round("Hallo", "Guten Tag"));
    const d = deps();
    const w = way(s, "new-note", d);
    expect(w.target?.(s)).toEqual({ kind: "new" });
    const r = await acceptPanel(e, w.spec, w.target?.(s) ?? s.target, w.kind(s), w.where);
    expect(r.ok).toBe(true);
    expect(store["Out/Mail (tuned).md"]).toBe("Guten Tag");
    expect(store["Mail.md"]).toBe("Hallo");
    expect(d.open).toHaveBeenCalledWith("Out/Mail (tuned).md");
  });

  it("zweimal derselbe Name: „ 2“; Ordner \"/\" heisst Wurzel; ohne Quellnotiz der Zeitstempel", async () => {
    const { env: e, store } = env({});
    const s = sessionWith({ kind: "new" }, round("Text", "Ergebnis", null));
    const w = way(s, "new-note", deps({ folder: () => "/" }));
    await acceptPanel(e, w.spec, { kind: "new" }, w.kind(s), w.where);
    await acceptPanel(e, w.spec, { kind: "new" }, w.kind(s), w.where);
    expect(Object.keys(store).sort()).toEqual(["LingoTuner 2026-11-25 09-30 (tuned) 2.md", "LingoTuner 2026-11-25 09-30 (tuned).md"]);
  });
});

describe("Texte des Uebernehmens", () => {
  it("Kit-Texte der Sprache, eigen nur unchanged, cannotReplace, appliedTo", () => {
    setLang("de");
    try {
      const s = acceptStrings("de");
      expect(s.selectionChanged).toBe(ACCEPT_STRINGS_DE.selectionChanged);
      expect(s.noteChanged).toBe(ACCEPT_STRINGS_DE.noteChanged);
      expect(s.appliedTo("Notiz Mail")).toBe(t("accept.applied", "Notiz Mail"));
      expect(s.unchanged).toBe(t("accept.unchanged"));
      expect(s.cannotReplace).toBe(t("accept.cannotReplace"));
    } finally {
      setLang("en");
    }
  });
});
