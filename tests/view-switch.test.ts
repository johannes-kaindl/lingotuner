/**
 * Die WEICHE, nicht ihre Bausteine.
 *
 * `view-soft.test.ts` prueft `structureKey` und `patchPanel` einzeln. Die Entscheidung
 * dazwischen — „voll zeichnen oder patchen?" in `softDraw()` — war bis 2026-09-08 von keinem
 * Test und keinem Smoke-Punkt beruehrt: wer `!gesperrt` versehentlich wegkuerzt, bekommt
 * Fehler 1 zurueck, und alle uebrigen Tests bleiben gruen (Review I-4).
 *
 * Messbar wird sie ueber die Naht `ViewDeps.activeElement()` — im Test ein Feld, in `main.ts`
 * `activeDocument.activeElement`.
 */
import { describe, it, expect } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findByClass, findAllByClass } from "./helpers/dom";
import { LingoTunerView, type ViewDeps } from "../src/obsidian/view";
import { NEUTRAL, BUILTIN_PRESETS, type Dials } from "../src/core/dials";
import "../src/i18n/strings";

type El = { className: string; children: El[]; value?: string; textContent?: string };

interface Aufbau {
  view: LingoTunerView;
  root: ReturnType<typeof makeFakeEl>;
  /** Wird von `activeElement()` geliefert — der einzige Weg, Fokus zu behaupten. */
  setzeFokus(el: unknown): void;
  dials: { wert: Dials };
  confirmAntwort: { wert: boolean };
  confirmRufe: Array<{ title: string; message: string; confirmLabel: string }>;
}

function baue(over: Partial<ViewDeps> = {}): Aufbau {
  const dials = { wert: { ...NEUTRAL } };
  const fokus: { el: unknown } = { el: null };
  const confirmAntwort = { wert: true };
  const confirmRufe: Array<{ title: string; message: string; confirmLabel: string }> = [];
  const deps: ViewDeps = {
    readiness: () => ({ kind: "ready", text: "Hallo", chars: 5, name: "Mail" }),
    canReplace: () => true,
    presets: () => [...BUILTIN_PRESETS],
    getDials: () => dials.wert,
    setDials: (d) => { dials.wert = { ...d }; },
    listModels: () => Promise.resolve([]),
    getModel: () => "",
    setModel: () => { /* egal */ },
    getSuppress: () => true,
    setSuppress: () => { /* egal */ },
    savePreset: () => { /* egal */ },
    run: () => Promise.resolve({ ok: true, text: "x", reasoning: "", model: "m", truncated: false }),
    output: () => Promise.resolve(),
    activeElement: () => fokus.el as Element | null,
    confirm: (o) => { confirmRufe.push(o); return Promise.resolve(confirmAntwort.wert); },
    ...over,
  };
  const leaf = { app: {} } as never;
  const view = new LingoTunerView(leaf, deps);
  const root = makeFakeEl();
  // `contains` kennt der Fake nicht — hier reicht die Frage „liegt es in diesem Baum?".
  root.contains = (el: unknown): boolean => {
    const suche = (n: { children?: unknown[] } | null): boolean => {
      if (n === null || n === undefined) return false;
      if (n === el) return true;
      for (const c of (n.children ?? []) as Array<{ children?: unknown[] }>) if (suche(c)) return true;
      return false;
    };
    return suche(root);
  };
  (view as unknown as { contentEl: unknown }).contentEl = root;
  void view.onOpen();
  return { view, root, setzeFokus: (el) => { fokus.el = el; }, dials, confirmAntwort, confirmRufe };
}

describe("softDraw — die Weiche zwischen Voll-Draw und Patch", () => {
  it("(a) struktureller Wechsel OHNE Fokus im Panel: das Panel wird neu gebaut", () => {
    const a = baue();
    const vorher = findByClass<El & { marke?: number }>(a.root, "lt-source-line");
    if (vorher === null) throw new Error("Vorbedingung fehlt");
    vorher.marke = 1;

    // Quelle wechseln ist strukturell (Textarea kommt/geht).
    a.view.refresh();                                   // ohne Aenderung: nur Patch
    expect(findByClass<El & { marke?: number }>(a.root, "lt-source-line")?.marke).toBe(1);

    (a.view as unknown as { source: string }).source = "text";
    a.view.refresh();
    expect(findByClass<El & { marke?: number }>(a.root, "lt-source-line")?.marke).toBeUndefined();
    expect(findByClass(a.root, "lt-freetext")).not.toBeNull();
  });

  it("(b) derselbe Wechsel MIT Fokus im Panel: kein Neuaufbau, aber ein Patch", () => {
    const a = baue();
    const zeile = findByClass<El & { marke?: number }>(a.root, "lt-source-line");
    const knopf = findByClass<El & { disabled?: boolean }>(a.root, "lt-run");
    if (zeile === null || knopf === null) throw new Error("Vorbedingung fehlt");
    zeile.marke = 1;
    a.setzeFokus(findAllByClass(a.root, "lt-note")[0]);

    (a.view as unknown as { source: string }).source = "text";
    a.view.refresh();

    // Neuaufbau haette die Marke verloren — und es gibt keine Textarea der Textfeld-Quelle.
    expect(findByClass<El & { marke?: number }>(a.root, "lt-source-line")?.marke).toBe(1);
    expect(findByClass(a.root, "lt-freetext")).toBeNull();
    // Gepatcht wurde trotzdem: die Anmerkung gibt Tunen frei.
    (a.view as unknown as { note: string }).note = "duzen";
    a.view.refresh();
    expect(findByClass<El & { disabled?: boolean }>(a.root, "lt-run")?.disabled).toBe(false);
  });

  it("(c) der vertagte Wechsel bleibt stehen und wird nachgeholt, sobald der Fokus weg ist", () => {
    const a = baue();
    a.setzeFokus(findAllByClass(a.root, "lt-note")[0]);
    (a.view as unknown as { source: string }).source = "text";
    a.view.refresh();
    expect(findByClass(a.root, "lt-freetext")).toBeNull();   // vertagt

    a.setzeFokus(null);
    a.view.refresh();                                        // nachgeholt, ohne neue Aenderung
    expect(findByClass(a.root, "lt-freetext")).not.toBeNull();
  });

  it("waehrend eines Streams wird NIE voll gezeichnet, auch ohne Fokus", () => {
    const a = baue();
    a.setzeFokus(null);
    (a.view as unknown as { phase: string }).phase = "streaming";
    (a.view as unknown as { source: string }).source = "text";
    a.view.refresh();
    expect(findByClass(a.root, "lt-freetext")).toBeNull();
  });
});

describe("draw — Cursor ueberlebt den Neuaufbau (Fehler 1 am Ende eines Laufs)", () => {
  it("setzt Auswahl in das gleichnamige Feld zurueck", () => {
    const a = baue();
    const note = findAllByClass<El>(a.root, "lt-note")[0];
    Object.assign(note, { selectionStart: 3, selectionEnd: 5 });
    a.setzeFokus(note);

    (a.view as unknown as { draw(): void }).draw();

    const danach = findAllByClass<El>(a.root, "lt-note")[0];
    expect(danach).not.toBe(note);                                   // wirklich neu gebaut
    expect((danach as unknown as { selectionStart?: number }).selectionStart).toBe(3);
    expect((danach as unknown as { selectionEnd?: number }).selectionEnd).toBe(5);
  });

  it("ohne Fokus im Panel wird nichts wiederhergestellt", () => {
    const a = baue();
    a.setzeFokus(null);
    (a.view as unknown as { draw(): void }).draw();
    const note = findAllByClass<El>(a.root, "lt-note")[0];
    expect((note as unknown as { selectionStart?: number }).selectionStart).toBeUndefined();
  });

  it("ein fokussiertes Element OHNE Cursor (Knopf) wird nicht angefasst", () => {
    const a = baue();
    a.setzeFokus(findByClass<El>(a.root, "lt-run"));
    expect(() => (a.view as unknown as { draw(): void }).draw()).not.toThrow();
    const note = findAllByClass<El>(a.root, "lt-note")[0];
    expect((note as unknown as { selectionStart?: number }).selectionStart).toBeUndefined();
  });
});

describe("Zuruecksetzen fragt nach, wenn es etwas zu verlieren gibt", () => {
  const runde = { dials: NEUTRAL, note: "", input: "a", output: "b", model: "m", at: 1, basedOn: null, sourceName: null, aborted: false, truncated: false };

  it("ohne Runden: sofort, ohne Rueckfrage", () => {
    const a = baue();
    (a.view as unknown as { preview: string }).preview = "res";
    (a.view as unknown as { handlers(): { onReset(): void } }).handlers().onReset();
    expect(a.confirmRufe).toHaveLength(0);
    expect((a.view as unknown as { preview: string }).preview).toBe("");
  });

  it("mit Runden: Rueckfrage, und bei Nein bleibt alles stehen", async () => {
    const a = baue();
    (a.view as unknown as { session: unknown }).session = { rounds: [runde, runde], active: 1 };
    a.confirmAntwort.wert = false;
    (a.view as unknown as { handlers(): { onReset(): void } }).handlers().onReset();
    await Promise.resolve();
    expect(a.confirmRufe).toHaveLength(1);
    expect(a.confirmRufe[0].message).toContain("2");
    expect((a.view as unknown as { session: { rounds: unknown[] } }).session.rounds).toHaveLength(2);
  });

  it("mit Runden und Ja: geraeumt", async () => {
    const a = baue();
    (a.view as unknown as { session: unknown }).session = { rounds: [runde], active: 0 };
    (a.view as unknown as { preview: string }).preview = "res";
    a.confirmAntwort.wert = true;
    (a.view as unknown as { handlers(): { onReset(): void } }).handlers().onReset();
    await Promise.resolve();
    await Promise.resolve();
    expect((a.view as unknown as { session: { rounds: unknown[] } }).session.rounds).toHaveLength(0);
    expect((a.view as unknown as { preview: string }).preview).toBe("");
  });
});
