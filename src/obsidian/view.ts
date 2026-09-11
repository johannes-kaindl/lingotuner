import { Component, ItemView, MarkdownRenderer, Modal, Setting, type App, type WorkspaceLeaf } from "obsidian";
import { isNoop, presetFor, type Dials, type Dimension, type Level, type Preset } from "../core/dials";
import { EMPTY_SESSION, activeRound, addRound, rootInput, rootSourceName, selectRound, type Session } from "../core/session";
import { type Readiness, type SourceKind } from "../core/source";
import { errorMessageKey } from "../core/llm/errors";
import type { TuneResult } from "../core/llm/client";
import { patchPanel, renderPanel, structureKey, type PanelHandlers, type PanelModel, type PanelParts, type RunPhase } from "./view-render";
import { createStableWriter, type StableMarkdownWriter } from "../vendor/kit-obsidian/stable-writer";
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
  /** Wer hat gerade den Fokus? EINE injizierbare Naht statt eines direkten Griffs nach
   *  `activeDocument` — sie traegt zwei Entscheidungen, die sonst beide untestbar waeren:
   *  die Weiche in `softDraw()` (Voll-Draw nur ohne Fokus im Panel) und das Merken der
   *  Cursorposition in `draw()`. Zwei getrennte Nahte dafuer waeren zwei Wahrheiten
   *  darueber, wo der Fokus liegt. */
  activeElement(): Element | null;
  /** Rueckfrage vor einer zerstoerenden Aktion. `true` = ausfuehren. */
  confirm(opts: { title: string; message: string; confirmLabel: string }): Promise<boolean>;
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
  /** Der inkrementelle Markdown-Schreiber auf dem Stream-Bereich (Kit `createStableWriter`).
   *  Er haelt Rohstrom und Schnitt-Zeiger selbst — je Voll-Draw neu, weil die Area neu ist. */
  private writer: StableMarkdownWriter | null = null;
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
        // Nur fragen, wenn es etwas zu verlieren gibt. Der Knopf sitzt unmittelbar neben
        // „Nachschaerfen", das man in einer Iterationsschleife oft klickt; ein Fehlgriff
        // kostete sonst die ganze Runden-Kette samt eines noch nicht kopierten Ergebnisses,
        // ohne Undo. Ohne Runden gibt es nichts zurueckzunehmen — dann sofort raeumen, sonst
        // waere die Rueckfrage nur Reibung.
        if (this.session.rounds.length === 0) { this.reset(); return; }
        void this.deps.confirm({
          title: t("run.resetTitle"),
          message: t("run.resetBody", String(this.session.rounds.length)),
          confirmLabel: t("run.reset"),
        }).then((ok) => { if (ok) this.reset(); });
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

  /** Raeumt die Sitzung. Erst abbrechen, dann raeumen: ein laufender Stream schriebe sonst
   *  in eine Vorschau, die es nicht mehr gibt. `controller = null` laesst `run()` sein
   *  Ergebnis verwerfen. Die Regler bleiben bewusst stehen — sie sind eine Einstellung,
   *  kein Sitzungszustand. */
  private reset(): void {
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
  }

  /** Liegt der Fokus IM Panel? Dann ist ein Voll-Draw verboten: er baut das Element unter
   *  dem Cursor neu, und Tippen bzw. ein gegriffener Regler bricht ab (Fehler 1). */
  private focusInPanel(): boolean {
    const el = this.deps.activeElement();
    return el !== null && this.contentEl.contains(el);
  }

  /** Cursor-Stand einer fokussierten Textarea im Panel — Vorbereitung fuer `draw()`. */
  private merkeCursor(): { cls: string; start: number; end: number } | null {
    const el = this.deps.activeElement();
    if (el === null || !this.contentEl.contains(el)) return null;
    const ta = el as Partial<HTMLTextAreaElement> & { className?: string };
    if (typeof ta.selectionStart !== "number" || typeof ta.selectionEnd !== "number") return null;
    const cls = (ta.className ?? "").split(" ").filter(Boolean)[0];
    if (cls === undefined) return null;
    return { cls, start: ta.selectionStart, end: ta.selectionEnd };
  }

  /** Cursor nach dem Neuaufbau zurueck ins gleichnamige Feld setzen.
   *
   *  Gesetzt werden `selectionStart`/`selectionEnd` direkt statt `setSelectionRange` — beides
   *  ist im Browser gleichwertig, aber die Zuweisung ist auch ohne echtes DOM beobachtbar und
   *  damit im Unit-Test pruefbar. Dass der FOKUS wirklich landet, kann nur ein echter Browser
   *  sagen; dafuer gibt es den Smoke-Punkt B11. */
  private stelleCursorHer(merk: { cls: string; start: number; end: number } | null): void {
    if (merk === null) return;
    const neu = this.contentEl.querySelectorAll<HTMLTextAreaElement>(`.${merk.cls}`)[0];
    if (neu === undefined) return;
    neu.focus();
    neu.selectionStart = merk.start;
    neu.selectionEnd = merk.end;
  }

  /** Voll-Draw: baut das Panel neu auf. Zieht Eingabefelder unter dem Cursor weg — deshalb
   *  nur ueber `softDraw()` oder aus einer Aktion, die den Fokus ohnehin verliert. */
  private draw(): void {
    // Ein Voll-Draw laesst sich nicht immer vermeiden — der am ENDE eines Laufs zum Beispiel
    // nicht, und genau dort tippt der Nutzer die Anmerkung fuer die naechste Runde, waehrend
    // er auf das Ergebnis wartet (Textarea und Anmerkung sind waehrend eines Streams
    // absichtlich NICHT gesperrt). Fehler 1 in einem schmaleren Fenster: einmal je Lauf statt
    // bei jedem Tastendruck, und in dem Moment, in dem niemand hinsieht. Der Wert ueberlebt
    // ohnehin (`onFreeText`/`onNote` halten ihn) — Fokus und Cursorposition nicht.
    const merk = this.merkeCursor();
    if (this.mdComp !== null) this.removeChild(this.mdComp);
    this.mdComp = this.addChild(new Component());
    const m = this.model();
    const parts = renderPanel(this.contentEl, m, this.handlers());
    this.parts = parts;
    this.struct = structureKey(m);
    // Je Draw eine neue Area — also auch ein neuer Schreiber. Der alte haelt Zeiger auf DOM,
    // das es nicht mehr gibt.
    this.writer = createStableWriter({ area: parts.area, render: (el, md) => this.renderMd(el, md) });
    if (this.preview !== "") {
      // In einen EIGENEN Block rendern statt den Body zu leeren: der laufende Absatz
      // (`area.tailEl`) liegt im Body, und ein `empty()` haengte ihn aus — der naechste
      // Stream schriebe dann in ein Element ausserhalb des Dokuments.
      const block = parts.area.bodyEl.createDiv({ cls: "okit-stream-block" });
      void this.renderMd(block, this.preview);
      parts.area.bodyEl.appendChild(parts.area.tailEl);
    }
    this.stelleCursorHer(merk);
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

  /** Markdown in ein Element rendern. Fehler kosten die Formatierung, nicht den Text.
   *  Zugleich der `render`-Callback des Kit-Schreibers: `MarkdownRenderer` braucht `App` und
   *  eine `Component` als Lebensdauer-Anker, und beides gehoert dem Consumer. */
  private renderMd(el: HTMLElement, md: string): Promise<void> {
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
    // Der Gedankenblock gehoert bei einem NEUEN Lauf offen — ein Gedanke, den man erst
    // aufklappen muss, ist waehrend des Streams unsichtbar (gemeldeter Fehler 3). Die Wahl
    // des Nutzers gilt fuer den laufenden Strom, nicht fuer den naechsten; das Kit nimmt
    // `reasoningOpen` beim BAU entgegen, deshalb steht das hier vor dem Draw.
    this.reasoningOpen = true;
    this.draw();
    // Pflicht laut Kit-Rezept (0.32.0): ohne `reset()` schriebe der zweite Lauf unter den
    // ersten. Er leert Body und Tail und wirft den Gedankenblock weg.
    this.writer?.reset();

    // Dem Strom folgen macht das Kit: `followTail` misst an `scrollEl` — hier das Panel,
    // weil es als Ganzes rollt — und scrollt nur, wenn der Leser ohnehin unten steht.
    const folge = (): void => { this.parts?.area.followTail(); };
    const onToken = (tk: string): void => {
      if (this.controller !== ctrl) return;
      const w = this.writer;
      if (w === null) return;
      // Zwei Kopien desselben Stroms, mit Absicht: der Schreiber haelt seinen Rohstrom fuer
      // den Markdown-Schnitt, `this.preview` bleibt die Wahrheit fuer Ausgaenge und
      // `structureKey`.
      this.preview += tk;
      w.push(tk);
      folge();
    };
    const onReasoning = (tk: string): void => {
      if (this.controller !== ctrl) return;
      const area = this.parts?.area;
      if (area === undefined) return;
      // Der Rohtext liegt schon in `this.reasoning` — ihn aus dem DOM zurueckzulesen und
      // neu zusammenzusetzen ist O(n²) ueber den ganzen Gedankenstrom (gemessen 12 184
      // Zeichen; bei 40 k spuerbar) und kann ausserdem divergieren. Das Kit haengt an.
      this.reasoning += tk;
      area.appendReasoning(tk);
      folge();
    };

    let result: TuneResult;
    try {
      result = await this.deps.run({ text: base, dials, note: this.note, basedOn, onToken, onReasoning, signal: ctrl.signal });
    } catch (e) {
      if (this.controller !== ctrl) return;
      this.controller = null;
      this.phase = "error";
      this.statusText = e instanceof Error ? e.message : String(e);
      // Erst die laufenden Renderings zu Ende, dann neu zeichnen: der Schluss-Draw ersetzt
      // die Area, und ein noch laufendes `render` schriebe danach in totes DOM.
      await this.writer?.settled();
      this.draw();
      return;
    }
    if (this.controller !== ctrl) return;
    this.controller = null;
    await this.writer?.settled();

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
