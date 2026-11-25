// Das Panel. Seit Welle 37 eine duenne Ansicht ueber dem Kit-Rahmen der Auftrags-Fenster (`buildPromptPanel`, obsidian-kit, UI-STANDARD § 8): der Rahmen zeichnet
// die acht Stationen (Ziel und Neu, Modellzeile, Auftrag, Lauf, Ergebnis, Runden, Uebernehmen, Schliessen), der Halter (`createPromptPanelHost`, in `main.ts`
// gebaut) haelt Lauf, Sitzung und die halb getippte Anmerkung ueber das Schliessen hinaus. Hier steht nur, was lingotuner ist: die Regler und die Quelle in
// Station 3 (`controls.ts`), die Anmerkung als freiwilliges Auftragsfeld (`instructionOptional`), die Vorschau des Ergebnisses mit Kopierknopf, die Beschriftung der
// Runden und der Knopf „Neu aus der Quelle stimmen“ (Slot `notices`). Die Schreibwege beschreibt `main.ts` (`ways`); geschrieben wird nur ueber den Rahmen
// (`acceptPanel` mit Schnappschuss).
//
// Vorher (bis 0.15.3) zeichnete die Ansicht alles selbst (view.ts + view-render.ts, Voll-Draw gegen Patch, eigener Laufwaechter). Weggefallen sind mit dem Umzug:
// der Voll-Draw mit Cursor-Rettung (der Rahmen ersetzt Felder unter dem Cursor nicht), die eigene Rundenliste, der eigene Lauf-Slot, der Teiltext als Runde nach
// einem Abbruch (der Halter verwirft das Ergebnis eines abgebrochenen Laufs; der Teiltext bleibt im Antwortbereich sichtbar) und Markdown im laufenden Strom
// (der Rahmen zeigt den Strom als Text, Markdown erst in der Vorschau).
import { Component, ItemView, Modal, Setting, type App, type WorkspaceLeaf } from "obsidian";
import type { Dimension, Level } from "../core/dials";
import type { Round, TuneSession } from "../core/session";
import type { SourceKind } from "../core/source";
import type { HostRunCall, HostRunResult } from "../vendor/kit/panel-host";
import type { Target } from "../vendor/kit/panel-session";
import { neutralizeModelMarkdown } from "../vendor/kit/safe-markdown";
import { getLang, t } from "../vendor/kit/i18n";
import { createCopyButton } from "../vendor/kit-obsidian/copy-button";
import { renderMarkdownGuarded } from "../vendor/kit-obsidian/dom-guard";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import type { AcceptEnv } from "../vendor/kit-obsidian/panel-accept";
import { buildPromptPanel, type PromptPanel, type PromptPanelSlots, type PromptPanelWay } from "../vendor/kit-obsidian/prompt-panel";
import type { PromptPanelHost } from "../vendor/kit-obsidian/prompt-panel-host";
import type { PromptPanelStrings } from "../vendor/kit-obsidian/prompt-panel-strings";
import type { ThinkingControlOptions } from "../vendor/kit-obsidian/thinking-control";
import { renderControls, type ControlsModel } from "./controls";

export const VIEW_TYPE_LINGOTUNER = "lingotuner-panel";
/** Icon des Panels (Ribbon und Tab). Eigener Name: `sliders-horizontal` tragen schon settings-assistant und koda-agent. */
export const PANEL_ICON = "speech";

export type LingoPanelHost = PromptPanelHost<TuneSession>;

export interface ViewDeps {
  host: LingoPanelHost;
  llm: LlmConnection;
  /** Zustand und Schalter der Denk-Steuerung in der Modellzeile (ohne Texte: die kommen aus dem Rahmen). */
  thinking: Pick<ThinkingControlOptions, "family" | "backend" | "current" | "onLevel" | "setLevel" | "levelPicker">;
  readTargetText(t: Target): Promise<string | null>;
  openSettings(): void;
  pluginId: string;
  accept: Omit<AcceptEnv, "settings" | "choose">;
  ways(s: TuneSession): PromptPanelWay<TuneSession>[];
  controls(): ControlsModel;
  onSource(k: SourceKind): void;
  onFreeText(v: string): void;
  onDial(dim: Dimension, level: Level): void;
  onPreset(id: string): void;
  savePreset(name: string): void;
  /** Lauf aus der Quelle, auch wenn Runden offen sind (eine neue Kette neben der alten). */
  runFromSource: (call: HostRunCall<TuneSession>) => Promise<HostRunResult<TuneSession>>;
}

class PresetNameModal extends Modal {
  constructor(app: App, private readonly onSubmit: (name: string) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(t("preset.saveTitle"));
    let name = "";
    const submit = (): void => {
      if (name.trim() === "") return;
      this.onSubmit(name.trim());
      this.close();
    };
    new Setting(this.contentEl).addText((tx) => {
      tx.setPlaceholder(t("preset.namePlaceholder"));
      tx.onChange((v) => { name = v; });
      tx.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(t("preset.save")).setCta().onClick(submit));
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Was der Rahmen in lingotuners Worten sagt; der Rest kommt aus dem Kit. */
export function panelStrings(): Partial<PromptPanelStrings> {
  return {
    targetNew: t("target.text"),
    targetEdit: (label) => label,
    modelLabel: t("panel.task"),
    promptLabel: t("note.label"),
    instructionOptional: t("note.placeholder"),
    create: t("run.tune"),
    refine: t("run.refine"),
    reasoning: t("preview.thinking"),
    emptyText: "",
    examples: [],
    unsupported: (label) => label,
  };
}

export function roundLabel(round: Round, index: number): string {
  const note = round.note.trim() === "" ? t("history.noteless") : round.note.trim();
  return `${t("history.round", String(index + 1))} · ${note}`;
}

export function roundMeta(round: Round): string {
  const based = round.basedOn === null ? t("history.fromSource") : t("history.refined", String(round.basedOn + 1));
  return round.model === "" ? based : `${based} · ${round.model}`;
}

export class LingoTunerView extends ItemView {
  private panel: PromptPanel | null = null;
  /** Der Slot von Station 3, zuletzt vom Rahmen uebergeben: `refreshControls()` zeichnet ihn neu. */
  private controlsEl: HTMLElement | null = null;
  private md: Component | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly deps: ViewDeps) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_LINGOTUNER; }
  getDisplayText(): string { return t("plugin.name"); }
  getIcon(): string { return PANEL_ICON; }

  onOpen(): Promise<void> {
    this.panel?.destroy();
    // Der Haken fuer die Mitschrift der Auswahl in `main.ts`: Cursorbewegungen in Feldern des Panels sind keine Auswahl im Editor.
    this.contentEl.addClass("lt-panel");
    this.panel = buildPromptPanel<Round, TuneSession>(
      this.contentEl,
      this.deps.host,
      {
        app: this.app,
        lang: getLang(),
        llm: this.deps.llm,
        thinking: this.deps.thinking,
        readTargetText: (tg) => this.deps.readTargetText(tg),
        openSettings: () => { this.deps.openSettings(); },
        pluginId: this.deps.pluginId,
        accept: this.deps.accept,
        strings: panelStrings(),
      },
      this.slots(),
    );
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    // Obsidian wartet in onClose nicht auf einen Dialog: die Rueckfrage laeuft nach destroy() weiter und erreicht den Halter (Verwerfen verwirft, jeder andere Ausgang behaelt).
    const panel = this.panel;
    this.panel = null;
    this.controlsEl = null;
    if (panel) {
      void panel.requestClose();
      panel.destroy();
    }
    this.disposeMd();
    return Promise.resolve();
  }

  /** Die zuletzt aktive Notiz hat gewechselt: Schreibwege und Sperrgruende neu bewerten. */
  refreshAccept(): void { this.panel?.refreshAccept(); }
  /** Quelle oder Mitschrift haben sich geaendert: Station 3 (Quellen-Chips, Textfeld, Bereitschaftszeile) neu zeichnen. Der Rahmen tut das bei `session`, aber nicht bei
   *  `target`, und mit offenen Runden meldet der Halter einen Quellenwechsel nur als `target` (Ziel gemerkt, nicht uebernommen): ohne diesen Aufruf fehlte das Textfeld nach
   *  dem Wechsel auf „Textfeld“ (Smoke ML1–ML7, P1, P2, Welle 37). Im Lauf ist Station 3 gesperrt und wird nicht angefasst. Bestellung ans Kit: Station 3 bei `target` neu zeichnen. */
  refreshControls(): void {
    const el = this.controlsEl;
    if (el === null || this.panel === null || this.deps.host.busy()) return;
    el.empty();
    this.drawControls(el);
  }

  private drawControls(host: HTMLElement): void {
    const d = this.deps;
    this.controlsEl = host;
    renderControls(host, d.controls(), {
      onSource: (k) => { d.onSource(k); },
      onFreeText: (v) => { d.onFreeText(v); },
      onDial: (dim, level) => { d.onDial(dim, level); },
      onPreset: (id) => { d.onPreset(id); },
      onSavePreset: () => { new PresetNameModal(this.app, (name) => { d.savePreset(name); }).open(); },
    });
  }
  /** Modell, Endpunkt oder Denkstufe haben sich ausserhalb geaendert: die Modellzeile zieht nach. */
  refreshModelBar(): void { this.panel?.refreshModelBar(); }
  /** Laedt die Modell-Liste der Zeile neu (Endpunkt oder Manager haben gewechselt). */
  reloadModels(): void { this.panel?.reloadModels(); }
  /** Testnaht: wartet auf Lauf, Schreiben und eine laufende Vorschau. */
  settled(): Promise<void> { return this.panel?.settled() ?? this.deps.host.settled(); }

  private disposeMd(): void {
    if (this.md !== null) this.removeChild(this.md);
    this.md = null;
  }

  private slots(): PromptPanelSlots<Round, TuneSession> {
    const d = this.deps;
    return {
      renderControls: (host) => { this.drawControls(host); },
      instructionOptional: true,
      notices: (host, ctx) => {
        if (ctx.session().rounds.rounds.length === 0) return;
        const b = host.createEl("button", { cls: "lt-retune", text: t("run.retune"), attr: { type: "button" } });
        b.disabled = ctx.busy();
        b.addEventListener("click", () => { ctx.run(d.host.live().draft.trim(), d.runFromSource); });
      },
      renderPreview: async (host, round, _text, ctx) => {
        this.disposeMd();
        if (round === null) return;
        const bar = host.createDiv({ cls: "lt-result-bar" });
        createCopyButton(bar, { label: t("out.copy"), text: round.output, cls: "lt-out-copy", copiedMessage: t("out.copied") });
        if (round.truncated) host.createDiv({ cls: "lt-warning", text: t("status.truncated") });
        const body = host.createDiv({ cls: "lt-result markdown-rendered" });
        const comp = new Component();
        this.md = this.addChild(comp);
        // Modell-Ausgabe: neutralisiert (Links und Bilder aus dem Modell werden Text) und unter dem Linkschutz-Waechter des Kits gerendert
        // (`renderMarkdownGuarded`: kappt aktive Link-Ziele wie javascript: und obsidian://, die der Renderer stehen liesse). Geschrieben wird der unveraenderte Text.
        try {
          await renderMarkdownGuarded(this.app, neutralizeModelMarkdown(round.output), body, "", comp);
        } catch {
          if (ctx.current()) body.setText(round.output);
        }
      },
      renderChanges: () => undefined,
      roundLabel,
      roundMeta,
      roundText: (round) => round.output,
      quality: () => ({ measured: true, text: "" }),
      acceptWays: (s) => d.ways(s),
      dispose: () => { this.disposeMd(); },
    };
  }
}
