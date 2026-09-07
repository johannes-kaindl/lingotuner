import { Component, ItemView, MarkdownRenderer, Modal, Setting, type App, type WorkspaceLeaf } from "obsidian";
import { DIMENSIONS, isNoop, levelKey, presetFor, type Dials, type Dimension, type Level, type Preset } from "../core/dials";
import { EMPTY_SESSION, activeRound, addRound, selectRound, type Session } from "../core/session";
import { type Readiness, type SourceKind } from "../core/source";
import { splitStable } from "../core/stream-blocks";
import { errorMessageKey } from "../core/llm/errors";
import type { TuneResult } from "../core/llm/client";
import { renderPanel, type PanelHandlers, type PanelModel, type PanelParts, type RunPhase } from "./view-render";
import { t } from "../vendor/kit/i18n";

export const VIEW_TYPE_LINGOTUNER = "lingotuner-panel";

export interface RunRequest {
  text: string;
  dials: Dials;
  note: string;
  basedOn: number | null;
  onToken(t: string): void;
  onReasoning(t: string): void;
  signal: AbortSignal;
}

export interface ViewDeps {
  readiness(kind: SourceKind, freeText: string): Readiness;
  canReplace(kind: "selection" | "note", sourceText: string): boolean;
  presets(): Preset[];
  getDials(): Dials;
  setDials(d: Dials): void;
  listModels(): Promise<string[]>;
  getModel(): string;
  setModel(m: string): void;
  getSuppress(): boolean;
  setSuppress(v: boolean): void;
  savePreset(name: string, dials: Dials): void;
  run(req: RunRequest): Promise<TuneResult>;
  output(kind: "replace-selection" | "replace-note" | "copy" | "new-note", text: string, sourceText: string): Promise<void>;
}

class PresetNameModal extends Modal {
  constructor(app: App, private readonly onSubmit: (name: string) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(t("preset.saveTitle"));
    let name = "";
    new Setting(this.contentEl).addText((tx) => { tx.setPlaceholder(t("preset.namePlaceholder")); tx.onChange((v) => { name = v; }); });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(t("preset.save")).setCta().onClick(() => {
      if (name.trim() === "") return;
      this.onSubmit(name.trim());
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export class LingoTunerView extends ItemView {
  private source: SourceKind = "selection";
  private freeText = "";
  private note = "";
  private models: string[] = [];
  private phase: RunPhase = "idle";
  private statusText = t("status.idle");
  private truncated = false;
  private session: Session = EMPTY_SESSION;
  private preview = "";
  private reasoning = "";
  private reasoningOpen = false;
  private parts: PanelParts | null = null;
  private controller: AbortController | null = null;
  private mdComp: Component | null = null;
  private streamStableLen = 0;

  constructor(leaf: WorkspaceLeaf, private readonly deps: ViewDeps) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_LINGOTUNER; }
  getDisplayText(): string { return t("plugin.name"); }
  getIcon(): string { return "sliders-horizontal"; }

  onOpen(): Promise<void> {
    this.draw();
    void this.deps.listModels().then((m) => { this.models = m; this.draw(); });
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.controller?.abort();
    this.controller = null;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /** Vom Plugin gerufen, wenn sich Markierung/Notiz geaendert haben. Nie waehrend eines Streams. */
  refresh(): void {
    if (this.phase === "streaming" || this.phase === "probing") return;
    this.draw();
  }

  /** Eingabe der WURZEL-Runde der aktiven Kette (ueber `basedOn` bis `basedOn === null`),
   *  oder `null` ohne Runden. Das ist der Text, gegen den ein Ersetzen die aktuell lebende
   *  Markierung/Notiz prueft — nicht die Quelle zum Klickzeitpunkt (die kann inzwischen eine
   *  andere sein). */
  private sourceTextOfActive(): string | null {
    let idx = this.session.active;
    if (idx < 0) return null;
    let round = this.session.rounds[idx];
    while (round !== undefined && round.basedOn !== null) {
      idx = round.basedOn;
      round = this.session.rounds[idx];
    }
    return round?.input ?? null;
  }

  private model(): PanelModel {
    const dials = this.deps.getDials();
    const presets = this.deps.presets();
    const sourceText = this.sourceTextOfActive();
    return {
      source: this.source,
      readiness: this.deps.readiness(this.source, this.freeText),
      freeText: this.freeText,
      dials, presets, presetId: presetFor(dials, presets),
      note: this.note,
      models: this.models, model: this.deps.getModel(), suppressThinking: this.deps.getSuppress(),
      phase: this.phase, statusText: this.statusText, truncated: this.truncated,
      session: this.session, preview: this.preview, reasoning: this.reasoning, reasoningOpen: this.reasoningOpen,
      canReplaceSelection: this.source === "selection" && sourceText !== null && this.deps.canReplace("selection", sourceText),
      canReplaceNote: this.source === "note" && sourceText !== null && this.deps.canReplace("note", sourceText),
    };
  }

  private handlers(): PanelHandlers {
    return {
      onSource: (k) => { this.source = k; this.draw(); },
      onFreeText: (v) => { this.freeText = v; this.drawSoft(); },
      onDial: (dim: Dimension, level: Level) => { this.deps.setDials({ ...this.deps.getDials(), [dim]: level }); this.drawSoft(); },
      onPreset: (id) => {
        const p = this.deps.presets().find((x) => x.id === id);
        if (p) { this.deps.setDials({ ...p.dials }); this.draw(); }
      },
      onSavePreset: () => { new PresetNameModal(this.app, (name) => { this.deps.savePreset(name, this.deps.getDials()); this.draw(); }).open(); },
      onNote: (v) => { this.note = v; this.drawSoft(); },
      onTune: () => { void this.run(null); },
      onRefine: () => { void this.run(this.session.active); },
      onAbort: () => { this.controller?.abort(); },
      onSelectRound: (i) => {
        this.session = selectRound(this.session, i);
        const r = activeRound(this.session);
        if (r) {
          this.preview = r.output;
          this.truncated = r.truncated;
          this.phase = r.aborted ? "aborted" : "done";
          this.statusText = t(r.aborted ? "status.aborted" : "status.done");
        }
        this.draw();
      },
      onModel: (m) => { this.deps.setModel(m); this.draw(); },
      onRefreshModels: () => { void this.deps.listModels().then((m) => { this.models = m; this.draw(); }); },
      onToggleThinking: () => { this.deps.setSuppress(!this.deps.getSuppress()); this.draw(); },
      onToggleReasoning: (open) => { this.reasoningOpen = open; },
      onReplaceSelection: () => {
        const s = this.sourceTextOfActive();
        if (s !== null) void this.deps.output("replace-selection", this.preview, s);
      },
      onReplaceNote: () => {
        const s = this.sourceTextOfActive();
        if (s !== null) void this.deps.output("replace-note", this.preview, s);
      },
      onCopy: () => { void this.deps.output("copy", this.preview, this.sourceTextOfActive() ?? ""); },
      onNewNote: () => { void this.deps.output("new-note", this.preview, this.sourceTextOfActive() ?? ""); },
    };
  }

  /** Voll-Draw: zieht Eingabefelder unter dem Cursor weg — nur, wenn sich Struktur aendert. */
  private draw(): void {
    if (this.mdComp !== null) this.removeChild(this.mdComp);
    this.mdComp = this.addChild(new Component());
    this.parts = renderPanel(this.contentEl, this.model(), this.handlers());
    this.streamStableLen = 0;
    if (this.preview !== "") void this.renderInto(this.parts.previewEl, this.preview, true);
  }

  /** Teil-Draw fuer Tipp-Ereignisse: nur Stufennamen, Preset-Markierung und Knopf-Zustand.
   *  Einfachste korrekte Form in 0.1: Voll-Draw NUR, wenn sich der Knopf-Zustand aendert.
   *  Waehrend eines laufenden Streams NIE Voll-Draw — das raesse die Vorschau ab (Fix 1b). */
  private drawSoft(): void {
    const m = this.model();
    const updateLevels = (): void => {
      this.contentEl.querySelectorAll<HTMLElement>(".lt-dial").forEach((row, i) => {
        const dim = DIMENSIONS[i];
        row.querySelector(".lt-dial-level")?.setText(t(levelKey(dim, m.dials[dim])));
      });
    };
    if (m.phase === "streaming" || m.phase === "probing") { updateLevels(); return; }
    const noop = isNoop(m.dials, m.note);
    const run = this.contentEl.querySelector<HTMLButtonElement>(".lt-run");
    const refine = this.contentEl.querySelector<HTMLButtonElement>(".lt-refine");
    const runShouldDisable = m.readiness.kind !== "ready" || noop;
    const refineShouldDisable = noop;
    const presetChanged = this.contentEl.dataset.preset !== (m.presetId ?? "");
    if (run !== null && run.disabled !== runShouldDisable) { this.draw(); return; }
    if (refine !== null && refine.disabled !== refineShouldDisable) { this.draw(); return; }
    if (presetChanged) { this.draw(); return; }
    updateLevels();
  }

  private renderInto(el: HTMLElement, md: string, clear: boolean): Promise<void> {
    if (clear) el.empty();
    const comp = this.mdComp;
    if (comp === null) return Promise.resolve();
    return MarkdownRenderer.render(this.app, md, el, "", comp).catch(() => { el.setText(md); });
  }

  private async run(basedOn: number | null): Promise<void> {
    const dials = this.deps.getDials();
    const readiness = this.deps.readiness(this.source, this.freeText);
    const base = basedOn === null ? (readiness.kind === "ready" ? readiness.text : null) : (activeRound(this.session)?.output ?? null);
    if (base === null || isNoop(dials, this.note)) { this.statusText = t("run.noop"); this.phase = "error"; this.draw(); return; }

    this.controller?.abort();
    const ctrl = new AbortController();
    this.controller = ctrl;
    this.phase = "streaming";
    this.statusText = t("status.streaming");
    this.truncated = false;
    this.preview = "";
    this.reasoning = "";
    this.draw();
    const initial = this.parts;
    if (initial === null) return;
    initial.previewEl.empty();
    const tail = initial.previewEl.createDiv({ cls: "lt-preview-tail" });
    initial.tailEl = tail;

    const onToken = (tk: string): void => {
      if (this.controller !== ctrl) return;
      const parts = this.parts;
      if (parts === null) return;
      this.preview += tk;
      const { stable, tail: rest } = splitStable(this.preview);
      if (stable.length > this.streamStableLen) {
        const fresh = stable.slice(this.streamStableLen);
        this.streamStableLen = stable.length;
        const block = parts.previewEl.createDiv({ cls: "lt-stream-block" });
        void this.renderInto(block, fresh, false);
        parts.previewEl.appendChild(parts.tailEl);
      }
      parts.tailEl.setText(rest);
    };
    const onReasoning = (tk: string): void => { if (this.controller === ctrl) this.reasoning += tk; };

    let result: TuneResult;
    try {
      result = await this.deps.run({ text: base, dials, note: this.note, basedOn, onToken, onReasoning, signal: ctrl.signal });
    } catch (e) {
      if (this.controller !== ctrl) return;
      this.controller = null;
      this.phase = "error";
      this.statusText = e instanceof Error ? e.message : String(e);
      this.draw();
      return;
    }
    if (this.controller !== ctrl) return;
    this.controller = null;

    if (result.ok) {
      this.preview = result.text;
      this.truncated = result.truncated;
      this.phase = "done";
      this.statusText = t("status.done");
      this.session = addRound(this.session, { dials: { ...dials }, note: this.note, input: base, output: result.text, model: result.model, at: Date.now(), basedOn, aborted: false, truncated: result.truncated });
    } else if (result.error.kind === "aborted") {
      this.preview = result.partial;
      this.phase = "aborted";
      this.statusText = t("status.aborted");
      if (result.partial.trim() !== "") {
        this.session = addRound(this.session, { dials: { ...dials }, note: this.note, input: base, output: result.partial, model: "", at: Date.now(), basedOn, aborted: true, truncated: false });
      }
    } else {
      const { key, args } = errorMessageKey(result.error);
      this.phase = "error";
      this.statusText = t(key, ...args);
      this.preview = result.partial;
    }
    this.draw();
  }
}
