import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass, findByTag } from "./helpers/dom";
import { createReasoningBlock, patchPanel, renderPanel, structureKey, type PanelHandlers, type PanelModel } from "../src/obsidian/view-render";
import { BUILTIN_PRESETS, NEUTRAL } from "../src/core/dials";
import { EMPTY_SESSION } from "../src/core/session";
import "../src/i18n/strings";

function model(over: Partial<PanelModel> = {}): PanelModel {
  return {
    source: "selection", readiness: { kind: "no-selection" }, freeText: "",
    dials: { ...NEUTRAL }, presets: [...BUILTIN_PRESETS], presetId: "neutral", note: "",
    models: [], model: "", suppressThinking: true,
    phase: "idle", statusText: "Ready", truncated: false,
    session: EMPTY_SESSION, preview: "", reasoning: "", reasoningOpen: false,
    canReplaceSelection: false, canReplaceNote: false,
    ...over,
  };
}

function handlers(): PanelHandlers {
  const h: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ["onSource","onFreeText","onDial","onPreset","onSavePreset","onNote","onTune","onRefine","onAbort","onReset","onSelectRound","onModel","onRefreshModels","onToggleThinking","onToggleReasoning","onReplaceSelection","onReplaceNote","onCopy","onNewNote"]) h[k] = vi.fn();
  return h as unknown as PanelHandlers;
}

type El = { className: string; disabled?: boolean; textContent?: string; open?: boolean; children: El[] };

const READY = { kind: "ready" as const, text: "x", chars: 1, name: "Mail" };

describe("structureKey — was einen Voll-Draw erzwingt", () => {
  it("Tippen aendert die Struktur NICHT: Anmerkung, Regler, Bereitschaft, Ersetzen-Ziele", () => {
    const basis = structureKey(model());
    expect(structureKey(model({ note: "duzen" }))).toBe(basis);
    expect(structureKey(model({ dials: { ...NEUTRAL, social: 2 } }))).toBe(basis);
    expect(structureKey(model({ readiness: READY }))).toBe(basis);
    expect(structureKey(model({ freeText: "abc" }))).toBe(basis);
    expect(structureKey(model({ presetId: null }))).toBe(basis);
    expect(structureKey(model({ canReplaceSelection: true, canReplaceNote: true }))).toBe(basis);
  });

  it("Struktur aendert sich bei Quelle, Phase, Runden, Modell-Liste, Vorschau und Gedanken", () => {
    const basis = structureKey(model());
    const r = { dials: NEUTRAL, note: "", input: "a", output: "b", model: "m", at: 1, basedOn: null, sourceName: null, aborted: false, truncated: false };
    expect(structureKey(model({ source: "text" }))).not.toBe(basis);
    expect(structureKey(model({ phase: "streaming" }))).not.toBe(basis);
    expect(structureKey(model({ session: { rounds: [r], active: 0 } }))).not.toBe(basis);
    expect(structureKey(model({ models: ["a", "b"] }))).not.toBe(basis);
    expect(structureKey(model({ model: "a" }))).not.toBe(basis);
    expect(structureKey(model({ suppressThinking: false }))).not.toBe(basis);
    expect(structureKey(model({ truncated: true }))).not.toBe(basis);
    expect(structureKey(model({ preview: "x" }))).not.toBe(basis);
    expect(structureKey(model({ reasoning: "x" }))).not.toBe(basis);
  });
});

describe("patchPanel — aktualisiert ohne Neuaufbau", () => {
  it("zieht Bereitschaftszeile, Tunen-Sperre und Stufennamen nach, ohne die Elemente zu ersetzen", () => {
    const root = makeFakeEl();
    renderPanel(root, model(), handlers());
    const line = findByClass<El & { marke?: number }>(root, "lt-source-line");
    const run = findByClass<El & { marke?: number }>(root, "lt-run");
    if (line === null || run === null) throw new Error("Vorbedingung fehlt");
    line.marke = 1; run.marke = 1;
    expect(line.className).toContain("is-blocked");
    expect(run.disabled).toBe(true);

    patchPanel(root, model({ readiness: READY, note: "duzen", dials: { ...NEUTRAL, social: 2 } }));

    // Dieselben Objekte — ein Neuaufbau haette die Marke verloren (und den Fokus).
    expect(findByClass<El & { marke?: number }>(root, "lt-source-line")?.marke).toBe(1);
    expect(findByClass<El & { marke?: number }>(root, "lt-run")?.marke).toBe(1);
    expect(findByClass<El>(root, "lt-source-line")?.className).not.toContain("is-blocked");
    expect(findByClass<El>(root, "lt-source-line")?.textContent).toContain("Mail");
    expect(findByClass<El>(root, "lt-run")?.disabled).toBe(false);
    expect(findAllByClass<El>(root, "lt-dial-level")[2].textContent).toBe("courtesies and small talk");
  });

  it("setzt Preset-Markierung und den (angepasst)-Marker um", () => {
    const root = makeFakeEl();
    renderPanel(root, model(), handlers());
    expect(findByClass<El>(root, "lt-preset-custom")?.textContent).toBe("");
    expect(findAllByClass<El>(root, "lt-preset-chip")[0].className).toContain("is-active");

    patchPanel(root, model({ presetId: null, dials: { ...NEUTRAL, social: 2 } }));
    expect(findByClass<El>(root, "lt-preset-custom")?.textContent).toBe("(adjusted)");
    expect(findAllByClass<El>(root, "lt-preset-chip")[0].className).not.toContain("is-active");

    patchPanel(root, model({ presetId: "clarity" }));
    expect(findByClass<El>(root, "lt-preset-custom")?.textContent).toBe("");
    expect(findAllByClass<El>(root, "lt-preset-chip")[1].className).toContain("is-active");
  });

  it("gibt die Ausgangsknoepfe frei, sobald ein Ergebnis steht", () => {
    const root = makeFakeEl();
    renderPanel(root, model(), handlers());
    expect(findByClass<El>(root, "lt-out-copy")?.disabled).toBe(true);
    patchPanel(root, model({ phase: "done", preview: "res", canReplaceSelection: true }));
    expect(findByClass<El>(root, "lt-out-copy")?.disabled).toBe(false);
    expect(findByClass<El>(root, "lt-out-replace-selection")?.disabled).toBe(false);
    expect(findByClass<El>(root, "lt-out-replace-note")?.disabled).toBe(true);
  });

  it("laesst den Abbrechen-Knopf waehrend des Streams in Ruhe", () => {
    const root = makeFakeEl();
    renderPanel(root, model({ phase: "streaming", readiness: READY, note: "n" }), handlers());
    // `disabled` ist im Mock erst gesetzt, wenn der Renderer es anfasst — waehrend des
    // Streams tut er das absichtlich nicht (der Knopf ist Abbrechen).
    expect(findByClass<El>(root, "lt-run")?.disabled).not.toBe(true);
    // Noop-Zustand waehrend des Streams: der Knopf muss bedienbar bleiben.
    patchPanel(root, model({ phase: "streaming", readiness: { kind: "no-selection" } }));
    expect(findByClass<El>(root, "lt-run")?.disabled).not.toBe(true);
  });
});

describe("Platzaufteilung", () => {
  it("data-output steuert den Deckel der Bedienelemente: leer 0, mit Vorschau und im Stream 1", () => {
    const leer = makeFakeEl();
    renderPanel(leer, model(), handlers());
    expect(leer.dataset.output).toBe("0");

    const mitVorschau = makeFakeEl();
    renderPanel(mitVorschau, model({ phase: "done", preview: "res" }), handlers());
    expect(mitVorschau.dataset.output).toBe("1");

    // Waehrend des Streams ist die Vorschau noch leer und braucht den Platz trotzdem.
    const imStream = makeFakeEl();
    renderPanel(imStream, model({ phase: "streaming", preview: "" }), handlers());
    expect(imStream.dataset.output).toBe("1");

    // Auch der Patch zieht ihn nach — sonst bliebe der Deckel beim Zuruecksetzen stehen.
    patchPanel(mitVorschau, model());
    expect(mitVorschau.dataset.output).toBe("0");
  });
});

describe("Zuruecksetzen", () => {
  it("fehlt im Ausgangszustand und erscheint, sobald es etwas zurueckzusetzen gibt", () => {
    const leer = makeFakeEl();
    renderPanel(leer, model(), handlers());
    expect(findByClass(leer, "lt-reset")).toBeNull();

    const mitVorschau = makeFakeEl();
    renderPanel(mitVorschau, model({ phase: "done", preview: "res" }), handlers());
    expect(findByClass<El>(mitVorschau, "lt-reset")?.textContent).toBe("Reset");

    const r = { dials: NEUTRAL, note: "", input: "a", output: "b", model: "m", at: 1, basedOn: null, sourceName: null, aborted: false, truncated: false };
    const mitRunde = makeFakeEl();
    renderPanel(mitRunde, model({ session: { rounds: [r], active: 0 }, phase: "done", preview: "b" }), handlers());
    expect(findByClass(mitRunde, "lt-reset")).not.toBeNull();
  });

  it("Klick ruft onReset", () => {
    const root = makeFakeEl();
    const h = handlers();
    renderPanel(root, model({ phase: "done", preview: "res" }), h);
    findByClass<El & { click(): void }>(root, "lt-reset")?.click();
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });
});

describe("Gedanken-Block", () => {
  it("createReasoningBlock legt details/summary/pre an und meldet das Aufklappen", () => {
    const parent = makeFakeEl();
    const onToggle = vi.fn();
    const pre = createReasoningBlock(parent, true, "denk", onToggle);
    const d = findByClass<El>(parent, "lt-reasoning");
    expect(d).not.toBeNull();
    expect(d?.open).toBe(true);
    expect(findByTag<El>(parent, "summary")?.textContent).toBe("Model reasoning");
    expect((pre as unknown as { textContent: string }).textContent).toBe("denk");
  });

  it("renderPanel haengt den Block IN den Scroll-Bereich, vor die Antwort", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, model({ reasoning: "denk", phase: "done", preview: "res" }), handlers());
    const preview = parts.previewEl as unknown as El;
    expect(preview.children[0].className).toContain("lt-reasoning");
    expect(preview.children[1].className).toContain("lt-preview-body");
    expect(parts.reasoningEl).not.toBeNull();
    // Der Antwort-Bereich ist ein eigenes Element: sein empty() darf den Block nicht mitnehmen.
    expect(parts.bodyEl).not.toBe(parts.previewEl);
  });

  it("ohne Gedanken gibt es keinen Block und reasoningEl ist null", () => {
    const root = makeFakeEl();
    const parts = renderPanel(root, model(), handlers());
    expect(findByClass(root, "lt-reasoning")).toBeNull();
    expect(parts.reasoningEl).toBeNull();
  });
});
