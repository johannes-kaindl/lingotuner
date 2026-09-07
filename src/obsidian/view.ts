import { Component, ItemView, MarkdownRenderer, Modal, Setting, type App, type WorkspaceLeaf } from "obsidian";
import { isNoop, presetFor, type Dials, type Dimension, type Level, type Preset } from "../core/dials";
import { EMPTY_SESSION, activeRound, addRound, rootInput, rootSourceName, selectRound, type Session } from "../core/session";
import { type Readiness, type SourceKind } from "../core/source";
import { splitStable } from "../core/stream-blocks";
import { errorMessageKey } from "../core/llm/errors";
import type { TuneResult } from "../core/llm/client";
import { createReasoningBlock, patchPanel, renderPanel, structureKey, type PanelHandlers, type PanelModel, type PanelParts, type RunPhase } from "./view-render";
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
  output(kind: "replace-selection" | "replace-note" | "copy" | "new-note", text: string, sourceText: string, sourceName: string | null): Promise<void>;
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
  /** Strukturschluessel des zuletzt VOLL gezeichneten Stands (`structureKey`). */
  private struct = "";

  constructor(leaf: WorkspaceLeaf, private readonly deps: ViewDeps) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_LINGOTUNER; }
  getDisplayText(): string { return t("plugin.name"); }
  getIcon(): string { return "sliders-horizontal"; }

  onOpen(): Promise<void> {
    this.draw();
    // Die Modell-Liste kommt asynchron und darf einen laufenden Stream NICHT neu zeichnen —
    // ein Voll-Draw mitten im Stream reisst die Vorschau ab. Merken, zeichnen beim naechsten Draw.
    void this.deps.listModels().then((m) => { this.models = m; this.softDraw(); });
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.controller?.abort();
    this.controller = null;
    this.contentEl.empty();
    return Promise.resolve();
  }

  /** Vom Plugin gerufen, wenn sich Markierung/Notiz geaendert haben. Zeichnet NIE voll,
   *  solange der Fokus im Panel liegt — das war Fehler 1: jede Cursorbewegung in der
   *  Textarea feuert `selectionchange`, und ein Voll-Draw baute das Feld unter dem Cursor neu. */
  refresh(): void { this.softDraw(); }

  private model(): PanelModel {
    const dials = this.deps.getDials();
    const presets = this.deps.presets();
    const sourceText = rootInput(this.session);
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
      onFreeText: (v) => { this.freeText = v; this.softDraw(); },
      onDial: (dim: Dimension, level: Level) => { this.deps.setDials({ ...this.deps.getDials(), [dim]: level }); this.softDraw(); },
      onPreset: (id) => {
        const p = this.deps.presets().find((x) => x.id === id);
        if (p) { this.deps.setDials({ ...p.dials }); this.draw(); }
      },
      onSavePreset: () => { new PresetNameModal(this.app, (name) => { this.deps.savePreset(name, this.deps.getDials()); this.draw(); }).open(); },
      onNote: (v) => { this.note = v; this.softDraw(); },
      onTune: () => { void this.run(null); },
      onRefine: () => { void this.run(this.session.active); },
      onAbort: () => { this.controller?.abort(); },
      onReset: () => {
        // Erst abbrechen, dann raeumen: ein laufender Stream schriebe sonst in eine Vorschau,
        // die es nicht mehr gibt. `controller = null` laesst `run()` sein Ergebnis verwerfen.
        this.controller?.abort();
        this.controller = null;
        this.session = EMPTY_SESSION;
        this.preview = "";
        this.reasoning = "";
        this.reasoningOpen = false;
        this.note = "";
        this.freeText = "";
        this.truncated = false;
        this.phase = "idle";
        this.statusText = t("status.idle");
        this.draw();
      },
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
      onRefreshModels: () => { void this.deps.listModels().then((m) => { this.models = m; if (this.phase === "streaming") return; this.draw(); }); },
      onToggleThinking: () => { this.deps.setSuppress(!this.deps.getSuppress()); this.draw(); },
      onToggleReasoning: (open) => { this.reasoningOpen = open; },
      onReplaceSelection: () => {
        const s = rootInput(this.session);
        if (s !== null) void this.deps.output("replace-selection", this.preview, s, rootSourceName(this.session));
      },
      onReplaceNote: () => {
        const s = rootInput(this.session);
        if (s !== null) void this.deps.output("replace-note", this.preview, s, rootSourceName(this.session));
      },
      onCopy: () => { void this.deps.output("copy", this.preview, rootInput(this.session) ?? "", rootSourceName(this.session)); },
      onNewNote: () => { void this.deps.output("new-note", this.preview, rootInput(this.session) ?? "", rootSourceName(this.session)); },
    };
  }

  /** Liegt der Fokus IM Panel? Dann ist ein Voll-Draw verboten: er baut das Element unter
   *  dem Cursor neu, und Tippen bzw. ein gegriffener Regler bricht ab (Fehler 1). */
  private focusInPanel(): boolean {
    const el = activeDocument.activeElement;
    return el !== null && this.contentEl.contains(el);
  }

  /** Voll-Draw: baut das Panel neu auf. Zieht Eingabefelder unter dem Cursor weg — deshalb
   *  nur ueber `softDraw()` oder aus einer Aktion, die den Fokus ohnehin verliert. */
  private draw(): void {
    if (this.mdComp !== null) this.removeChild(this.mdComp);
    this.mdComp = this.addChild(new Component());
    const m = this.model();
    this.parts = renderPanel(this.contentEl, m, this.handlers());
    this.struct = structureKey(m);
    this.streamStableLen = 0;
    if (this.preview !== "") void this.renderInto(this.parts.bodyEl, this.preview, true);
  }

  /** Der Weg fuer alles Beilaeufige (Tippen, Reglerzug, Auswahlwechsel im Editor, spaet
   *  eintreffende Modell-Liste): in place patchen. Voll gezeichnet wird nur bei einem
   *  STRUKTURwechsel — und auch dann nicht, solange ein Stream laeuft oder der Fokus im
   *  Panel liegt. */
  private softDraw(): void {
    const m = this.model();
    const strukturell = structureKey(m) !== this.struct;
    const gesperrt = m.phase === "streaming" || this.focusInPanel();
    if (strukturell && !gesperrt) { this.draw(); return; }
    patchPanel(this.contentEl, m);
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
    // Der Quellname gehoert zur WURZEL der Kette: beim Lauf aus der Quelle der aktuelle
    // Bereitschafts-Name, beim Nachschaerfen der Name, unter dem die Kette begonnen hat.
    // VOR addRound lesen — danach zeigt `active` auf die neue Runde.
    const sourceName = basedOn === null
      ? (readiness.kind === "ready" ? readiness.name : null)
      : rootSourceName(this.session);
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
    // Nur den Antwort-Bereich leeren, nicht den Scroll-Bereich: der Gedanken-Block sitzt
    // daneben und darf nicht mit weggeraeumt werden.
    initial.bodyEl.empty();
    initial.tailEl = initial.bodyEl.createDiv({ cls: "lt-preview-tail" });

    // uebernommen aus koda-agent/src/obsidian/view.ts (streamToken), 2026-09-07
    const onToken = (tk: string): void => {
      if (this.controller !== ctrl) return;
      const parts = this.parts;
      if (parts === null) return;
      this.preview += tk;
      const { stable, tail: rest } = splitStable(this.preview);
      if (stable.length > this.streamStableLen) {
        const fresh = stable.slice(this.streamStableLen);
        this.streamStableLen = stable.length;
        const block = parts.bodyEl.createDiv({ cls: "lt-stream-block" });
        void this.renderInto(block, fresh, false);
        // Der laufende Absatz gehoert immer ans Ende.
        parts.bodyEl.appendChild(parts.tailEl);
      }
      parts.tailEl.setText(rest);
      parts.previewEl.scrollTo({ top: parts.previewEl.scrollHeight });
    };
    // uebernommen aus koda-agent/src/obsidian/view.ts (streamReasoning), 2026-09-07 —
    // der Block entsteht beim ERSTEN Gedanken-Token und waechst per setText, statt erst
    // beim Schluss-Draw aufzutauchen (Fehler 3).
    const onReasoning = (tk: string): void => {
      if (this.controller !== ctrl) return;
      this.reasoning += tk;
      const parts = this.parts;
      if (parts === null) return;
      if (parts.reasoningEl === null) {
        this.reasoningOpen = true;
        parts.reasoningEl = createReasoningBlock(parts.previewEl, true, "", (open) => { this.reasoningOpen = open; });
        // Der Block gehoert VOR die Antwort — `createEl` haengt hinten an.
        parts.previewEl.insertBefore(parts.reasoningEl.parentElement ?? parts.reasoningEl, parts.bodyEl);
      }
      parts.reasoningEl.setText(parts.reasoningEl.getText() + tk);
      parts.previewEl.scrollTo({ top: parts.previewEl.scrollHeight });
    };

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
      this.session = addRound(this.session, { dials: { ...dials }, note: this.note, input: base, output: result.text, model: result.model, at: Date.now(), basedOn, sourceName, aborted: false, truncated: result.truncated });
    } else if (result.error.kind === "aborted") {
      this.preview = result.partial;
      this.phase = "aborted";
      this.statusText = t("status.aborted");
      if (result.partial.trim() !== "") {
        this.session = addRound(this.session, { dials: { ...dials }, note: this.note, input: base, output: result.partial, model: "", at: Date.now(), basedOn, sourceName, aborted: true, truncated: false });
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
