import { Notice, Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import "./i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import { copyToClipboard } from "./vendor/kit-obsidian/clipboard";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { DEFAULT_SETTINGS, PROBE_TIMEOUT_MS, allPresets, loadSettings, upsertUserPreset, type LingoTunerSettings } from "./core/settings";
import { type Dials } from "./core/dials";
import { buildMessages, systemPrompt } from "./core/prompt";
import { loadOverrides } from "./core/examples/overrides";
import { readiness as readinessOf, type Readiness, type SourceKind } from "./core/source";
import { streamTune, type TuneResult } from "./core/llm/client";
import { classifyNetworkFailure } from "./core/llm/errors";
import { EndpointResolver } from "./core/llm/resolver";
import { createLingoTunerApi, type LingoTunerApi } from "./core/api";
import { probeEndpoint, listModels, xhrTransport } from "./obsidian/http";
import { SelectionTracker, createTunedNote, replaceCapture } from "./obsidian/editor-io";
import { vaultOverrideReader } from "./obsidian/overrides-io";
import { appendLogEntry } from "./obsidian/logbook-io";
import { readLabApi } from "./obsidian/lab";
import { LingoTunerSettingTab } from "./obsidian/settings-tab";
import { LingoTunerView, VIEW_TYPE_LINGOTUNER, type RunRequest } from "./obsidian/view";

const SELECTION_DEBOUNCE_MS = 150;

/** Name fuer eine neue Notiz ohne Quellnotiz (Textfeld-Lauf) — Spec 4.7 „Datum bei Textfeld".
 *  Doppelpunkte gehen in Dateinamen nicht, deshalb `HH-mm`. */
function noteStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `LingoTuner ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class LingoTunerPlugin extends Plugin {
  settings: LingoTunerSettings = DEFAULT_SETTINGS;
  resolver!: EndpointResolver;
  api!: LingoTunerApi;
  private tracker!: SelectionTracker;
  private selectionDebounce: number | null = null;
  private activeEndpoint: EndpointConfig | null = null;
  /** Zuletzt gemeldete Override-Probleme, als ein Schluessel. Ohne das meldet JEDER Lauf
   *  dieselbe kaputte Datei erneut — bei zehn Laeufen zehn Notices fuer denselben Befund. */
  private lastOverrideProblems = "";

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = loadSettings(await this.loadData());
    this.resolver = new EndpointResolver(() => this.settings.endpoints, (ep) => probeEndpoint(ep, PROBE_TIMEOUT_MS).then((s) => s.reachable));
    this.tracker = new SelectionTracker(this.app.workspace);
    // Nicht awaiten: onload darf nicht auf einer Netz-Probe haengen. Setzt activeEndpoint,
    // damit die Endpunkt-Liste in den Einstellungen die aktive Zeile schon VOR dem ersten Lauf kennt.
    void this.resolveEndpoint();

    // Sofort setzen: sobald das Plugin-Objekt in app.plugins.plugins auftaucht, soll `api` da sein.
    this.api = createLingoTunerApi({
      presets: () => allPresets(this.settings),
      run: (text, dials, note, signal) => this.tune({ text, dials, note, signal, quiet: true }),
    });

    this.registerView(VIEW_TYPE_LINGOTUNER, (leaf: WorkspaceLeaf) => new LingoTunerView(leaf, {
      readiness: (kind, freeText) => this.readiness(kind, freeText),
      canReplace: (kind, sourceText) => {
        const cap = kind === "selection" ? this.tracker.get().selection : this.tracker.get().note;
        return cap !== null && this.tracker.isLive(cap) && cap.text === sourceText;
      },
      presets: () => allPresets(this.settings),
      getDials: () => this.settings.lastDials,
      setDials: (d) => { this.settings.lastDials = { ...d }; void this.saveSettings(); },
      listModels: async () => { const ep = (await this.resolveEndpoint()) ?? this.settings.endpoints[0]; return ep ? listModels(ep, PROBE_TIMEOUT_MS) : []; },
      getModel: () => this.settings.model,
      setModel: (m) => { this.settings.model = m; void this.saveSettings(); },
      getSuppress: () => this.settings.suppressThinking,
      setSuppress: (v) => { this.settings.suppressThinking = v; void this.saveSettings(); },
      savePreset: (name, dials) => {
        const { list, replaced } = upsertUserPreset(this.settings.userPresets, name, dials);
        this.settings.userPresets = list;
        void this.saveSettings();
        new Notice(replaced ? t("preset.exists") : t("preset.saved", name));
      },
      run: (req) => this.runFromPanel(req),
      output: (kind, text, sourceText, sourceName) => this.output(kind, text, sourceText, sourceName),
    }));

    // Mitschrift der Auswahl: ein Klick ins Panel nimmt dem Editor den Fokus — dann ist es zu spaet.
    this.registerDomEvent(activeDocument, "selectionchange", () => {
      if (this.selectionDebounce !== null) window.clearTimeout(this.selectionDebounce);
      this.selectionDebounce = window.setTimeout(() => {
        this.selectionDebounce = null;
        this.tracker.capture();
        this.panel()?.refresh();
      }, SELECTION_DEBOUNCE_MS);
    });
    this.register(() => { if (this.selectionDebounce !== null) window.clearTimeout(this.selectionDebounce); });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { this.tracker.capture(); this.panel()?.refresh(); }));

    this.addRibbonIcon("sliders-horizontal", t("ribbon"), () => { void this.activatePanel(); });
    this.addCommand({ id: "open-panel", name: t("cmd.openPanel"), callback: () => { void this.activatePanel(); } });
    this.addCommand({
      id: "tune-selection",
      name: t("cmd.tuneSelection"),
      editorCheckCallback: (checking, editor) => {
        if (editor.getSelection().trim() === "") return false;
        if (!checking) { this.tracker.capture(); void this.activatePanel(); }
        return true;
      },
    });
    this.addSettingTab(new LingoTunerSettingTab(this.app, this));
  }

  onunload(): void { /* Views raeumt Obsidian selbst ab */ }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  activeEndpointUrl(): string | null { return this.activeEndpoint?.url ?? null; }

  /** EINZIGER Weg zum Endpunkt: aufloesen UND merken. `resolve()` direkt zu rufen liess
   *  activeEndpoint stehen, wo es stand — die Einstellungen zeigten dann bis zum ersten Lauf
   *  keine aktive Zeile. Die Resolver-Klasse bleibt unangetastet (byte-gleich zu koda-agent). */
  async resolveEndpoint(): Promise<EndpointConfig | null> {
    const ep = await this.resolver.resolve();
    this.activeEndpoint = ep;
    return ep;
  }

  private panel(): LingoTunerView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LINGOTUNER)[0];
    return leaf?.view instanceof LingoTunerView ? leaf.view : null;
  }

  private readiness(kind: SourceKind, freeText: string): Readiness { return readinessOf(kind, this.tracker.get(), freeText); }

  private async activatePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LINGOTUNER);
    if (existing.length > 0) { await this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE_LINGOTUNER, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private runFromPanel(req: RunRequest): Promise<TuneResult> {
    return this.tune({
      text: req.text, dials: req.dials, note: req.note, signal: req.signal,
      onToken: (tk) => { req.onToken(tk); },
      onReasoning: (tk) => { req.onReasoning(tk); },
    });
  }

  /** EIN Ausfuehrungspfad fuer Panel und API: Endpunkt aufloesen → Overrides → Prompt → Stream → Lab → Logbuch. */
  private async tune(p: { text: string; dials: Dials; note: string; signal?: AbortSignal; quiet?: boolean; onToken?: (t: string) => void; onReasoning?: (t: string) => void }): Promise<TuneResult> {
    const ep = await this.resolveEndpoint();
    if (ep === null) { new Notice(t("run.noEndpoint")); return { ok: false, error: { kind: "network" }, partial: "" }; }

    const { overrides, problems } = await loadOverrides(vaultOverrideReader(this.app), this.settings.overrideFolder);
    // Nur melden, wenn sich die Problemmenge geaendert hat — und ueber die API (quiet) gar nicht
    // per Notice: ein Fremdaufruf soll dem Nutzer keine Meldung ins Fenster schieben.
    const key = problems.join("\n");
    if (key !== this.lastOverrideProblems) {
      for (const f of problems) {
        if (p.quiet === true) console.warn(`LingoTuner: ${t("error.overrideFile", f)}`);
        else new Notice(t("error.overrideFile", f));
      }
    }
    this.lastOverrideProblems = key;
    const opts = { note: p.note, lang: getLang(), overrides };
    const messages = buildMessages(p.text, p.dials, opts);
    const model = ep.model && ep.model !== "" ? ep.model : this.settings.model;

    const started = Date.now();
    let first: number | undefined;
    const ctrl = new AbortController();
    if (p.signal) {
      if (p.signal.aborted) ctrl.abort();
      else p.signal.addEventListener("abort", () => { ctrl.abort(); }, { once: true });
    }
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; ctrl.abort(); }, this.settings.timeoutSec * 1000);
    // „Erstes Token, egal welcher Art": ein Reasoning-Modell schickt Minuten lang nur Gedanken,
    // bevor der erste Inhalts-Token kommt. Loeschte nur onToken den Timer, riss das Zeitlimit
    // einen sichtbar arbeitenden Lauf ab.
    const onToken = (tk: string): void => {
      if (first === undefined) { first = Date.now(); window.clearTimeout(timer); }
      p.onToken?.(tk);
    };
    const onReasoning = (tk: string): void => {
      if (first === undefined) { first = Date.now(); window.clearTimeout(timer); }
      p.onReasoning?.(tk);
    };
    let result = await streamTune(xhrTransport, { messages, endpoint: ep, model, suppressThinking: this.settings.suppressThinking, signal: ctrl.signal, onToken, onReasoning });
    window.clearTimeout(timer);

    if (!result.ok && result.error.kind === "aborted" && timedOut) {
      result = { ok: false, error: { kind: "timeout", seconds: this.settings.timeoutSec }, partial: result.partial };
    } else if (!result.ok && result.error.kind === "network") {
      // „Probe gruen, Chat rot" — ein lokaler Server ohne CORS-Header antwortet requestUrl, nicht XHR.
      const probe = await probeEndpoint(ep, PROBE_TIMEOUT_MS);
      result = { ok: false, error: classifyNetworkFailure(probe.reachable), partial: result.partial };
      if (!probe.reachable) this.resolver.invalidate();
    }

    try {
      readLabApi(this.app)?.log({
        plugin: "lingotuner", feature: "tune", model, endpointUrl: ep.url, messages,
        content: result.ok ? result.text : result.partial,
        ...(result.ok && result.reasoning ? { reasoning: result.reasoning } : {}),
        ...(result.ok && result.truncated ? { finishReason: "length" } : {}),
        latencyMs: Date.now() - started,
        ...(first !== undefined ? { ttftMs: first - started } : {}),
        ...(ep.apiKey ? { secrets: [ep.apiKey] } : {}),
        promptTemplate: systemPrompt(p.dials, { lang: opts.lang, overrides }),
        ...(result.ok ? {} : { error: result.error.kind }),
      });
    } catch { /* Telemetrie darf einen Lauf nie mitreissen. */ }

    if (result.ok && this.settings.logbookEnabled) {
      try {
        await appendLogEntry(this.app, this.settings.logbookFolder, { at: new Date(), model: result.model || model, dials: p.dials, note: p.note, input: p.text, output: result.text });
      } catch (e) { new Notice(e instanceof Error ? e.message : String(e)); }
    }
    return result;
  }

  private async output(kind: "replace-selection" | "replace-note" | "copy" | "new-note", text: string, sourceText: string, sourceName: string | null): Promise<void> {
    try {
      const st = this.tracker.get();
      if (kind === "copy") { await copyToClipboard(text, { copiedMessage: t("out.copied"), failedMessage: t("out.copyFailed") }); return; }
      if (kind === "new-note") {
        const base = sourceName ?? noteStamp(new Date());
        const file = await createTunedNote(this.app, this.settings.newNoteFolder, base, text);
        new Notice(t("out.noteCreated", file.path));
        await this.app.workspace.getLeaf("tab").openFile(file);
        return;
      }
      const cap = kind === "replace-selection" ? st.selection : st.note;
      if (cap === null) { new Notice(t("source.notLive")); return; }
      if (cap.text !== sourceText) { new Notice(t("out.sourceChanged")); return; }
      if (kind === "replace-note") {
        const ok = await confirmAction(this.app, { title: t("out.confirmNoteTitle"), message: t("out.confirmNoteBody", cap.name), confirmLabel: t("out.confirmNoteOk"), warning: true });
        if (!ok) return;
      }
      const outcome = replaceCapture(this.tracker, cap, text);
      new Notice(outcome === "ok" ? t("out.replaced") : outcome === "stale" ? t("source.stale") : t("source.notLive"));
      if (outcome === "ok") { this.tracker.capture(); this.panel()?.refresh(); }
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
    }
  }
}
