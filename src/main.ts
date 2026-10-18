import { Notice, Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import "./i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import { localFileStamp } from "./vendor/kit/local-stamp";
import { onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { copyToClipboard } from "./vendor/kit-obsidian/clipboard";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { createLlmConnection, type LlmConnection } from "./vendor/kit-obsidian/llm-connection";
import { managerErrorText, resolveLlmConnectionStrings, transportMissingText } from "./vendor/kit-obsidian/llm-connection-strings";
import { loadRequestSettings, onLevelFor, thinkingFor } from "./vendor/kit/sampling-profiles";
import { DEFAULT_SETTINGS, LEGACY_REQUEST_MIGRATIONS, allPresets, loadSettings, upsertUserPreset, type LingoTunerSettings } from "./core/settings";
import { type Dials } from "./core/dials";
import { buildMessages, type ChatMessage } from "./core/prompt";
import { loadOverrides } from "./core/examples/overrides";
import { readiness as readinessOf, type Readiness, type SourceKind } from "./core/source";
import { toTuneResult, MODE, type TuneResult } from "./core/llm/client";
import { classifyNetworkFailure, classifyShortcutFailure } from "./core/llm/errors";
import { createLingoTunerApi, type LingoTunerApi } from "./core/api";
import { createShortcutsBridge, type ShortcutsBridge } from "./vendor/kit-obsidian/shortcuts-bridge";
import { createShortcutsChatTransport } from "./vendor/kit-obsidian/chat-transport";
import { redactExchange } from "./vendor/kit-obsidian/chat-client";
import { logToLab } from "./vendor/kit-obsidian/lab-client";
import { SelectionTracker, createTunedNote, replaceCapture } from "./obsidian/editor-io";
import { vaultOverrideReader } from "./obsidian/overrides-io";
import { appendLogEntry } from "./obsidian/logbook-io";
import { LingoTunerSettingTab } from "./obsidian/settings-tab";
import { LingoTunerView, VIEW_TYPE_LINGOTUNER, type RunRequest } from "./obsidian/view";

const SELECTION_DEBOUNCE_MS = 150;

/** Name fuer eine neue Notiz ohne Quellnotiz (Textfeld-Lauf) — Spec 4.7 „Datum bei Textfeld".
 *  Doppelpunkte gehen in Dateinamen nicht, deshalb `HH-mm`. */
function noteStamp(d: Date): string {
  return `LingoTuner ${localFileStamp(d)}`;
}

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class LingoTunerPlugin extends Plugin {
  settings: LingoTunerSettings = DEFAULT_SETTINGS;
  api!: LingoTunerApi;
  private tracker!: SelectionTracker;
  private selectionDebounce: number | null = null;
  /** Die ganze LLM-Anbindung: Endpunkt-Quelle, Modellliste, Anfrage-Parameter, Client, Settings-Abschnitte. */
  llm!: LlmConnection;
  private unsubscribeManager: () => void = () => {};
  /** Zuletzt gemeldete Override-Probleme, als ein Schluessel. Ohne das meldet JEDER Lauf
   *  dieselbe kaputte Datei erneut — bei zehn Laeufen zehn Notices fuer denselben Befund. */
  private lastOverrideProblems = "";
  private labMismatchWarned = false;
  /** Bruecke zu Apples on-device-Modell (Kurzbefehl) — im Konsumenten gebaut, der Manager-Vertrag exponiert keine. */
  private shortcutsBridge!: ShortcutsBridge;

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    const raw: unknown = await this.loadData();
    this.settings = loadSettings(raw);
    const { request, dropped } = loadRequestSettings(raw, LEGACY_REQUEST_MIGRATIONS);
    this.settings.request = request;
    if (dropped.length > 0) {
      new Notice(t("request.dropped", String(dropped.length)));
      console.warn("LingoTuner: request settings dropped", dropped);
    }
    // Das globale Modell ist in die Zeilen gewandert (loadSettings): einmal speichern, damit der Altschluessel
    // aus der data.json verschwindet.
    if (typeof raw === "object" && raw !== null && "model" in raw) await this.saveSettings();
    this.tracker = new SelectionTracker(this.app.workspace);
    this.shortcutsBridge = createShortcutsBridge(this, { protocolAction: "lingotuner-shortcut" });
    this.llm = createLlmConnection({
      app: this.app,
      pluginId: this.manifest.id,
      caller: "lingotuner",
      capability: "chat",
      mode: MODE,
      // Das Panel zeigt die Stufenwahl (view-render.ts, `getLevelPickerInChat`) — der Schalter wirkt hier.
      levelPicker: true,
      lang: () => getLang(),
      // Apple Intelligence (Kurzbefehl): one-shot ueber die Bruecke; die Frist mindestens Kurzbefehl + 10 s setzt das Kit.
      // Claude (Anthropic API) ueber den LLM Endpoint Manager: Opt-in, ohne ihn sieht die Verbindung diese Endpunkte nie (Kit 0.62.0).
      transports: { anthropic: true, shortcuts: (shortcut) => createShortcutsChatTransport({ bridge: this.shortcutsBridge, shortcut }) },
      getSettings: () => ({
        endpoints: this.settings.endpoints,
        choice: this.settings.choice,
        request: this.settings.request,
      }),
      // Erst in die Settings schreiben, dann speichern: die Endpunkt-Liste liest ihre Zeilen danach zurueck.
      persist: (patch) => {
        Object.assign(this.settings, patch);
        return this.saveSettings();
      },
    });
    // Nicht awaiten: onload darf nicht auf einer Netz-Probe haengen. Die Verbindung merkt die Aufloesung,
    // damit die Einstellungen die aktive Zeile schon VOR dem ersten Lauf kennen.
    void this.llm.resolve().catch(() => undefined);
    // Der Manager kann jederzeit installiert, aktiviert, deaktiviert oder umkonfiguriert werden —
    // bei jeder solchen Aenderung frisch aufloesen.
    this.unsubscribeManager = onEndpointManagerChanged(this.app, () => { this.llm.invalidate(); void this.llm.resolve().then(() => { this.panel()?.refresh(); }).catch(() => undefined); });

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
      listModels: async () => [...(await this.llm.models({ force: true })).models].sort(),
      // Die Modellwahl gehoert der Verbindung: mit Manager `choice.model`, ohne Manager das Modell der aktiven
      // Zeile; „Server waehlt“ ist `setModel("")`.
      getModel: () => this.llm.modelInUse(),
      setModel: (m) => { void this.llm.setModel(m).then(() => { this.panel()?.refresh(); }).catch(() => undefined); },
      getFamily: () => this.llm.source().family,
      getBackend: () => this.llm.source().backend,
      getThinkingLevel: () => thinkingFor(this.settings.request, MODE),
      getThinkingOnLevel: () => onLevelFor(this.settings.request, MODE),
      getLevelPickerInChat: () => this.settings.request.levelPickerInChat,
      setThinkingLevel: (l) => {
        this.settings.request.thinking[MODE] = l;
        if (l !== "off") this.settings.request.lastOnLevel[MODE] = l;
        void this.saveSettings();
      },
      savePreset: (name, dials) => {
        const { list, replaced } = upsertUserPreset(this.settings.userPresets, name, dials);
        this.settings.userPresets = list;
        void this.saveSettings();
        new Notice(replaced ? t("preset.exists") : t("preset.saved", name));
      },
      run: (req) => this.runFromPanel(req),
      output: (kind, text, sourceText, sourceName) => this.output(kind, text, sourceText, sourceName),
      // Die einzige Stelle, an der die View erfaehrt, wo der Fokus liegt — als Naht, damit
      // die Weiche in `softDraw()` und das Merken der Cursorposition in `draw()` pruefbar
      // sind, ohne `activeDocument` zu faelschen.
      activeElement: () => activeDocument.activeElement,
      confirm: (o) => confirmAction(this.app, { ...o, warning: true }),
    }));

    // Mitschrift der Auswahl: ein Klick ins Panel nimmt dem Editor den Fokus — dann ist es zu spaet.
    this.registerDomEvent(activeDocument, "selectionchange", () => {
      // Die Mitschrift gilt dem EDITOR. Jede Cursorbewegung in Textfeld oder Anmerkung feuert
      // dieses Ereignis ebenfalls; ein `refresh()` darauf zog das Feld unter dem Cursor weg und
      // machte das Textfeld unbeschreibbar (Fehler 1a). Im Panel gibt es nichts mitzuschreiben.
      const aktiv = activeDocument.activeElement;
      if (aktiv !== null && aktiv.closest(".lt-panel") !== null) return;
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

  onunload(): void { this.unsubscribeManager(); /* Views raeumt Obsidian selbst ab */ }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  /** Ist der LLM Endpoint Manager da? Dann entscheidet er (Kit `resolveEndpointSource`: kein lokaler Rueckfall). */

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
      onContentReset: () => { req.onContentReset(); },
    });
  }

  /** EIN Ausfuehrungspfad fuer Panel und API: Endpunkt aufloesen → Overrides → Prompt → Stream → Lab → Logbuch. */
  private async tune(p: { text: string; dials: Dials; note: string; signal?: AbortSignal; quiet?: boolean; onToken?: (t: string) => void; onReasoning?: (t: string) => void; onContentReset?: () => void }): Promise<TuneResult> {
    const resolved = await this.llm.resolve();
    if (resolved.config === null) {
      // Im Manager-Fall nennt die Aufloesung einen `reason`-Code (`no-endpoint` | `not-found` | `disabled` |
      // `secret-missing` | `unreachable`); jeder hat im Kit einen eigenen Text, der die Stelle nennt, an der er behoben wird
      // (fehlender Schluessel und abgeschalteter Endpunkt liegen im Manager-Plugin, nicht in der lokalen Liste).
      // `no-endpoint` ist ohne Manager der lokale Fall und behaelt den eigenen Text.
      const reason = resolved.reason;
      new Notice(reason !== undefined && reason !== "no-endpoint" ? managerErrorText(resolveLlmConnectionStrings({ lang: getLang() }), reason) : t("run.noEndpoint"));
      return { ok: false, error: { kind: "network" }, partial: "" };
    }

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

    const started = Date.now();
    // Ein Tunen = eine Nutzer-Handlung = eine turnId (apiVersion 4); das Lab klammert damit Aufrufe.
    const turnId = crypto.randomUUID();
    const r = await this.llm.complete({ messages }, {
      ...(p.signal ? { signal: p.signal } : {}),
      ...(p.onToken ? { onToken: p.onToken } : {}),
      ...(p.onReasoning ? { onReasoning: p.onReasoning } : {}),
      ...(p.onContentReset ? { onContentReset: p.onContentReset } : {}),
    });
    const src = r.source;
    // Das Modell, wie es Nutzer und Liste kennen (Anzeige, Lab, Logbuch) — der Alias steht in `src.sentModel`.
    const model = src.model;
    const viaShortcut = src.transport === "shortcuts";
    let result: TuneResult;
    if (!r.ok && r.kind === "no-endpoint") {
      // Fehlt ein Transport, den der Endpunkt verlangt (nicht die Kurzbefehl-Bruecke), ist das eine eigene Meldung des Kits (seit 0.63.0).
      // Sonst ein Konfigurationsfehler des Kurzbefehl-Transports (Endpunkt ohne Kurzbefehl-Angabe): sichtbar melden, nicht still auf HTTP fallen.
      result = r.reason === "transport-missing" && r.transport !== undefined && r.transport !== "shortcuts"
        ? { ok: false, error: { kind: "transport-missing", text: transportMissingText(resolveLlmConnectionStrings({ lang: getLang() }), r.transport) }, partial: "" }
        : { ok: false, error: { kind: "shortcut", reason: "error", detail: r.detail }, partial: "" };
    } else {
      result = toTuneResult(r, src.shortcut);
    }
    if (viaShortcut && !result.ok && result.error.kind === "http") {
      result = { ...result, error: classifyShortcutFailure(result.status ?? result.error.status, result.errorText ?? result.error.detail) };
    }

    if (!result.ok && result.error.kind === "network" && !viaShortcut) {
      // „Probe gruen, Chat rot" — der Client hat Stream UND Anfrage ohne Stream versucht (Fallback
      // ueber requestUrl); scheitern beide, ist der Endpunkt entweder tot oder verweigert beides.
      const probe = await this.llm.models({ force: true });
      result = { ...result, error: classifyNetworkFailure(probe.reachable) };
      if (!probe.reachable) this.llm.invalidate();
    }

    // Das Lab bekommt den GESENDETEN Text (Platzhalter), nicht die Originale: das Log soll dem Draht entsprechen.
    // Nachrichten, Antwort und Denkspur laufen durch EINE Schwaerzung, damit derselbe Wert ueberall denselben Platzhalter hat.
    const thought = result.ok ? result.reasoning : (result.reasoning ?? "");
    const sent = redactExchange<ChatMessage>({ messages, answer: result.ok ? result.text : result.partial, reasoning: thought !== "" ? thought : null });
    const sentMessages = sent.messages;
    const sentAnswer = sent.answer;
    const sentThought = sent.reasoning ?? "";
    const apiKey = src.config?.apiKey;
    const lab = logToLab(this.app, {
      plugin: "lingotuner", feature: "tune", model, endpointUrl: src.config?.url ?? "", messages: sentMessages,
      content: sentAnswer,
      ...(sentThought !== "" ? { reasoning: sentThought } : {}),
      ...(result.ok && result.truncated ? { finishReason: "length" } : {}),
      latencyMs: Date.now() - started,
      ...(result.ttftMs !== undefined ? { ttftMs: result.ttftMs } : {}),
      ...(apiKey ? { secrets: [apiKey] } : {}),
      promptTemplate: String(sentMessages.find((m) => m.role === "system")?.content ?? ""),
      turnId,
      ...(result.ok ? {} : { error: result.error.kind }),
    });
    // Ein Lab, das da ist, aber nicht antwortet wie erwartet (andere apiVersion), sah bisher aus
    // wie „kein Lab“ — einmal je Sitzung melden.
    if (!lab.ok && lab.reason === "version-mismatch" && !this.labMismatchWarned) {
      this.labMismatchWarned = true;
      console.warn(`LingoTuner: ${lab.detail} — Aufzeichnung im Lab ist aus`);
    }

    if (result.ok && this.settings.logbookEnabled) {
      try {
        await appendLogEntry(this.app, this.settings.logbookFolder, { at: new Date(), model: result.model || model, dials: p.dials, note: p.note, input: p.text, output: result.text });
      } catch (e) {
        // Wie beim Override-Problem oben (Zeile 237): ein Fremdaufruf ueber die API (quiet)
        // schiebt dem Nutzer keine Meldung ins Fenster, die er nicht angestossen hat.
        const msg = e instanceof Error ? e.message : String(e);
        if (p.quiet === true) console.warn(`LingoTuner: ${msg}`);
        else new Notice(msg);
      }
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
