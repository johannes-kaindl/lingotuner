import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { renderPanel, type PanelModel, type PanelHandlers } from "../src/obsidian/view-render";
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
  for (const k of ["onSource","onFreeText","onDial","onPreset","onSavePreset","onNote","onTune","onRefine","onAbort","onSelectRound","onModel","onRefreshModels","onToggleThinking","onToggleReasoning","onReplaceSelection","onReplaceNote","onCopy","onNewNote"]) h[k] = vi.fn();
  return h as unknown as PanelHandlers;
}

type El = { className: string; disabled?: boolean; textContent?: string; attrs?: Record<string, string>; getAttribute?(k: string): string | null; value?: string; children: El[] };

describe("renderPanel", () => {
  it("zeichnet drei Quellen-Chips, vier Regler, fuenf Preset-Chips, Anmerkung, Tunen-Knopf", () => {
    const root = makeFakeEl();
    renderPanel(root, model(), handlers());
    expect(findAllByClass(root, "lt-source-chip")).toHaveLength(3);
    expect(findAllByClass(root, "lt-dial-input")).toHaveLength(4);
    expect(findAllByClass(root, "lt-preset-chip")).toHaveLength(4);
    expect(findByClass(root, "lt-note")).not.toBeNull();
    expect(findByClass(root, "lt-run")).not.toBeNull();
  });

  it("Bereitschafts-Zeile zeigt den Blockgrund, Tunen ist dann aus", () => {
    const root = makeFakeEl();
    renderPanel(root, model(), handlers());
    const line = findByClass<El>(root, "lt-source-line");
    expect(line?.textContent).toContain("Select some text");
    expect(findByClass<El>(root, "lt-run")?.disabled).toBe(true);
  });

  it("bei Noop (alles 0, keine Anmerkung) ist Tunen aus, mit Anmerkung an", () => {
    const ready = { kind: "ready" as const, text: "x", chars: 1, name: "Mail" };
    const a = makeFakeEl();
    renderPanel(a, model({ readiness: ready }), handlers());
    expect(findByClass<El>(a, "lt-run")?.disabled).toBe(true);
    const b = makeFakeEl();
    renderPanel(b, model({ readiness: ready, note: "duzen" }), handlers());
    expect(findByClass<El>(b, "lt-run")?.disabled).toBe(false);
  });

  it("Textfeld-Quelle zeigt die Textarea", () => {
    const root = makeFakeEl();
    renderPanel(root, model({ source: "text" }), handlers());
    expect(findByClass(root, "lt-freetext")).not.toBeNull();
  });

  it("Ausgaenge: Ersetzen nur mit passender, lebender Quelle; Kopieren nur mit Ergebnis", () => {
    const root = makeFakeEl();
    renderPanel(root, model({ phase: "done", preview: "res", canReplaceSelection: true, canReplaceNote: false }), handlers());
    expect(findByClass<El>(root, "lt-out-replace-selection")?.disabled).toBe(false);
    expect(findByClass<El>(root, "lt-out-replace-note")?.disabled).toBe(true);
    expect(findByClass<El>(root, "lt-out-copy")?.disabled).toBe(false);
    const empty = makeFakeEl();
    renderPanel(empty, model(), handlers());
    expect(findByClass<El>(empty, "lt-out-copy")?.disabled).toBe(true);
  });

  it("ab zwei Runden erscheint der Verlauf mit der aktiven Runde markiert", () => {
    const r = { dials: NEUTRAL, note: "", input: "a", output: "b", model: "m", at: 1, basedOn: null, aborted: false, truncated: false };
    const root = makeFakeEl();
    renderPanel(root, model({ session: { rounds: [r, { ...r, basedOn: 0 }], active: 0 }, phase: "done", preview: "b" }), handlers());
    const rows = findAllByClass<El>(root, "lt-history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("is-active");
    expect(rows[1].textContent).toContain("refined from round 1");
  });

  it("waehrend des Streams zeigt der Primaerknopf Abbrechen", () => {
    const root = makeFakeEl();
    const h = handlers();
    renderPanel(root, model({ phase: "streaming", readiness: { kind: "ready", text: "x", chars: 1, name: null }, note: "n" }), h);
    expect(findByClass<El>(root, "lt-run")?.textContent).toBe("Cancel");
  });

  it("Preset-Klick und Regler-Aenderung rufen die Handler", () => {
    const root = makeFakeEl();
    const h = handlers();
    renderPanel(root, model(), h);
    const chip = findAllByClass<El & { click(): void }>(root, "lt-preset-chip")[1];
    chip.click();
    expect(h.onPreset).toHaveBeenCalledWith("clarity");
  });
});
