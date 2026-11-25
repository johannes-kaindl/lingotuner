import { Notice, Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import "./i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import { localFileStamp } from "./vendor/kit/local-stamp";
import { onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { createLlmConnection, type LlmConnection } from "./vendor/kit-obsidian/llm-connection";
import { managerErrorText, resolveLlmConnectionStrings, transportMissingText } from "./vendor/kit-obsidian/llm-connection-strings";
import { loadRequestSettings, onLevelFor, thinkingFor } from "./vendor/kit/sampling-profiles";
import { DEFAULT_SETTINGS, LEGACY_REQUEST_MIGRATIONS, allPresets, loadSettings, upsertUserPreset, type LingoTunerSettings } from "./core/settings";
import { type Dials } from "./core/dials";
import { buildMessages, type ChatMessage } from "./core/prompt";
import { loadOverrides } from "./core/examples/overrides";
import { noteName, readiness as readinessOf, readinessKey, splitFrontmatter, type SourceKind } from "./core/source";
import { freshSession, type TuneSession } from "./core/session";
import { targetFor } from "./core/target";
import { createTuneRun, type TuneRunDeps } from "./core/panel-run";
import { sameTarget, type Target } from "./vendor/kit/panel-session";
import { readNoteText } from "./vendor/kit/note-edit";
import { obsidianWritePorts } from "./vendor/kit-obsidian/write-ports";
import { createPromptPanelHost } from "./vendor/kit-obsidian/prompt-panel-host";
import { statusBarEnabled } from "./vendor/kit-obsidian/status-bar-item";
import { toTuneResult, MODE, type TuneResult } from "./core/llm/client";
import { classifyNetworkFailure, classifyShortcutFailure } from "./core/llm/errors";
import { createLingoTunerApi, type LingoTunerApi } from "./core/api";
import { createShortcutsBridge, type ShortcutsBridge } from "./vendor/kit-obsidian/shortcuts-bridge";
import { createShortcutsChatTransport } from "./vendor/kit-obsidian/chat-transport";
import { redactExchange } from "./vendor/kit-obsidian/chat-client";
import { logToLab } from "./vendor/kit-obsidian/lab-client";
import { SelectionTracker, activeMarkdownView } from "./obsidian/editor-io";
import { acceptStrings, tuneWays } from "./obsidian/accept";
import { vaultOverrideReader } from "./obsidian/overrides-io";
import { appendLogEntry } from "./obsidian/logbook-io";
import { LingoTunerSettingTab } from "./obsidian/settings-tab";
import { LingoTunerView, PANEL_ICON, VIEW_TYPE_LINGOTUNER, type LingoPanelHost } from "./obsidian/view";

const SELECTION_DEBOUNCE_MS = 150;

/** Name fuer eine neue Notiz ohne Quellnotiz (Textfeld-Lauf) — Spec 4.7 „Datum bei Textfeld".
 *  Doppelpunkte gehen in Dateinamen nicht, deshalb `HH-mm`. Gebraucht ab dem Weg „Neue Notiz“ (Bestellung B2). */
export function noteStamp(d: Date): string {
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
  private settingTab?: LingoTunerSettingTab;
  /** Zuletzt gemeldete Override-Probleme, als ein Schluessel. Ohne das meldet JEDER Lauf
   *  dieselbe kaputte Datei erneut — bei zehn Laeufen zehn Notices fuer denselben Befund. */
  private lastOverrideProblems = "";
  private labMismatchWarned = false;
  /** Bruecke zu Apples on-device-Modell (Kurzbefehl) — im Konsumenten gebaut, der Manager-Vertrag exponiert keine. */
  private shortcutsBridge!: ShortcutsBridge;
  /** Der Halter des Panels (Kit `createPromptPanelHost`): Lauf, Sitzung und Anmerkung leben hier, nicht in der Ansicht, und ueberstehen ihr Schliessen. */
  host!: LingoPanelHost;
  /** Quelle und eingefuegter Text des Panels: wie der Halter ueber das Schliessen der Ansicht hinaus. */
  private panelState: { source: SourceKind; freeText: string } = { source: "selection", freeText: "" };

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
      lang: () => getLang(),
      // Apple Intelligence (Kurzbefehl): one-shot ueber die Bruecke; die Frist mindestens Kurzbefehl + 10 s setzt das Kit.
      // Claude (Anthropic API) ueber den LLM Endpoint Manager: Opt-in, ohne ihn sieht die Verbindung diese Endpunkte nie (Kit 0.62.0).
      transports: { anthropic: true, shortcuts: (shortcut) => createShortcutsChatTransport({ bridge: this.shortcutsBridge, shortcut }) },
      getSettings: () => ({
        endpoints: this.settings.endpoints,
        choice: this.settings.choice,
        request: this.settings.request,
      }),
      // Die Verbindung meldet eine geaenderte Aufloesung (Endpunkt, Backend, Familie) — auch die aus den Einstellungen: das offene Panel zeichnet seine Modellzeile neu.
      // Ohne den Rueckruf fehlte die Stufenwahl nach einem Wechsel in den Einstellungen, bis irgendein `refresh()` kam (Smoke ML6). Der Rueckruf loest nicht auf (Kit-Vertrag).
      onResolved: () => { this.onLlmResolved(); },
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
    this.unsubscribeManager = onEndpointManagerChanged(this.app, () => { this.llm.invalidate(); void this.llm.resolve().then(() => { this.panel()?.refreshModelBar(); this.panel()?.reloadModels(); }).catch(() => undefined); });

    // Sofort setzen: sobald das Plugin-Objekt in app.plugins.plugins auftaucht, soll `api` da sein.
    this.api = createLingoTunerApi({
      presets: () => allPresets(this.settings),
      run: (text, dials, note, signal) => this.tune({ text, dials, note, signal, quiet: true }),
    });

    const runDeps: TuneRunDeps = {
      dials: () => this.settings.lastDials,
      sourceOf: (target) => this.sourceOf(target),
      tune: (c) => this.tune(c),
    };
    this.host = createPromptPanelHost<TuneSession>({
      plugin: this,
      name: t("plugin.name"),
      open: () => { void this.activatePanel(); },
      statusBar: () => statusBarEnabled(this.settings.showStatusBar),
      lang: getLang(),
      fresh: freshSession,
      run: createTuneRun(runDeps),
      model: () => this.llm.source().model,
    });
    this.register(() => { this.host.destroy(); });
    const runFromSource = createTuneRun(runDeps, { fromSource: true });

    this.registerView(VIEW_TYPE_LINGOTUNER, (leaf: WorkspaceLeaf) => new LingoTunerView(leaf, {
      host: this.host,
      // Die Modellzeile (Kit model-bar) spricht die Verbindung direkt an. Die Wahl gehoert der Verbindung: mit Manager
      // `choice.model`, ohne Manager das Modell der aktiven Zeile; „Automatisch“ ist `setModel("")`.
      llm: this.llm,
      thinking: {
        family: () => this.llm.source().family,
        backend: () => this.llm.source().backend,
        current: () => thinkingFor(this.settings.request, MODE),
        onLevel: () => onLevelFor(this.settings.request, MODE),
        // Die Modellzeile zeigt die Stufen seit Kit 0.73.0 immer als Auswahl; die Einstellung „Stufenwahl im Chat“ gibt es nicht mehr, der gespeicherte Wert bleibt in den Daten.
        levelPicker: () => false,
        setLevel: (l) => {
          this.settings.request.thinking[MODE] = l;
          if (l !== "off") this.settings.request.lastOnLevel[MODE] = l;
          return this.saveSettings();
        },
      },
      readTargetText: (target) => this.readTargetText(target),
      openSettings: () => { this.openSettings(); },
      pluginId: this.manifest.id,
      accept: {
        app: this.app,
        ports: obsidianWritePorts(this.app),
        lastEditor: () => activeMarkdownView(this.app.workspace),
        strings: acceptStrings(),
        readingMode: "refuse",
      },
      ways: (s) => tuneWays(s, () => this.host.session()),
      controls: () => ({
        source: this.panelState.source,
        readiness: readinessOf(this.panelState.source, this.tracker.get(), this.panelState.freeText),
        freeText: this.panelState.freeText,
        dials: this.settings.lastDials,
        presets: allPresets(this.settings),
      }),
      onSource: (k) => { this.panelState.source = k; this.offerTarget(); },
      onFreeText: (v) => { this.panelState.freeText = v; },
      onDial: (dim, level) => { this.settings.lastDials = { ...this.settings.lastDials, [dim]: level }; void this.saveSettings(); },
      onPreset: (id) => {
        const p = allPresets(this.settings).find((x) => x.id === id);
        if (p === undefined) return;
        this.settings.lastDials = { ...p.dials };
        void this.saveSettings();
        // Die Regler stehen in den Einstellungen, nicht in der Sitzung: neu zeichnen ueber eine Sitzung gleichen Inhalts (der Rahmen vergleicht per Referenz).
        this.host.setSession({ ...this.host.session() });
      },
      savePreset: (name) => {
        const { list, replaced } = upsertUserPreset(this.settings.userPresets, name, this.settings.lastDials);
        this.settings.userPresets = list;
        void this.saveSettings();
        new Notice(replaced ? t("preset.exists") : t("preset.saved", name));
        this.host.setSession({ ...this.host.session() });
      },
      runFromSource,
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
        this.captureAndOffer();
      }, SELECTION_DEBOUNCE_MS);
    });
    this.register(() => { if (this.selectionDebounce !== null) window.clearTimeout(this.selectionDebounce); });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { this.captureAndOffer(); }));

    this.addRibbonIcon(PANEL_ICON, t("ribbon"), () => { void this.activatePanel(); });
    this.addCommand({ id: "open-panel", name: t("cmd.openPanel"), callback: () => { void this.activatePanel(); } });
    this.addCommand({
      id: "tune-selection",
      name: t("cmd.tuneSelection"),
      editorCheckCallback: (checking, editor) => {
        if (editor.getSelection().trim() === "") return false;
        if (!checking) { this.panelState.source = "selection"; this.captureAndOffer(); void this.activatePanel(); }
        return true;
      },
    });
    this.settingTab = new LingoTunerSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    this.unsubscribeManager();
    this.settingTab?.dispose();   // der Oeffnen-Haken des Tabs wird erst hier abgenommen, nicht in hide()
    /* Views raeumt Obsidian selbst ab */
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  /** Ist der LLM Endpoint Manager da? Dann entscheidet er (Kit `resolveEndpointSource`: kein lokaler Rueckfall). */

  /** Rueckruf der Verbindung (`onResolved`): das offene Panel zieht Modellzeile und Rest aus dem neuen Zustand nach. Loest nie auf. */
  private onLlmResolved(): void { this.panel()?.refreshModelBar(); }

  /** Editor-Stand mitschreiben und dem Halter das Ziel der gewaehlten Quelle anbieten; die Schreibwege bewerten ihre Sperrgruende neu. */
  private captureAndOffer(): void {
    this.tracker.capture();
    this.offerTarget();
    this.panel()?.refreshAccept();
  }

  /** Bietet das Ziel der gewaehlten Quelle an, aber nur, wenn es ein anderes ist: jedes Angebot meldet `target` (und ohne Runde `session`) und zeichnet neu. */
  private offerTarget(): void {
    const target = targetFor(this.panelState.source, this.tracker.get(), {
      selection: (name) => t("target.selection", name),
      note: (name) => t("target.note", name),
      blocked: (r) => t(readinessKey(r)),
    });
    const offered = this.host.offered();
    if (offered !== null ? sameTarget(offered, target) : sameTarget(this.host.session().target, target)) return;
    this.host.offer(target);
  }

  /** Text und Quellname des Ziels jetzt (Eingabe eines Laufs aus der Quelle). */
  private async sourceOf(target: Target): Promise<{ text: string; name: string | null } | { problem: string }> {
    switch (target.kind) {
      case "new": {
        const text = this.panelState.freeText;
        return text.trim() === "" ? { problem: t("source.emptyText") } : { text, name: null };
      }
      case "block":
        return { text: target.body, name: noteName(target.path) };
      case "file": {
        const full = await this.readTargetText(target);
        if (full === null) return { problem: t("source.noNote") };
        const { body } = splitFrontmatter(full);
        return body.trim() === "" ? { problem: t("source.emptyNote") } : { text: body, name: noteName(target.path) };
      }
      case "other":
        return { problem: target.label };
    }
  }

  private async readTargetText(target: Target): Promise<string | null> {
    if (target.kind === "block") return target.body;
    if (target.kind !== "file") return null;
    try {
      return await readNoteText(obsidianWritePorts(this.app), target.path);
    } catch {
      return null;
    }
  }

  private openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  private panel(): LingoTunerView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LINGOTUNER)[0];
    return leaf?.view instanceof LingoTunerView ? leaf.view : null;
  }

  private async activatePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LINGOTUNER);
    if (existing.length > 0) { await this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE_LINGOTUNER, active: true });
    await this.app.workspace.revealLeaf(leaf);
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
}
