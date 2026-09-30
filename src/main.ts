import { Notice, Plugin, getLanguage, type WorkspaceLeaf } from "obsidian";
import "./i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import { resolveEndpointSource, type ApiErrorCode, type SourceKind as EndpointSourceKind, type EndpointSourceResult } from "./vendor/kit/endpoint-source";
import { findEndpointManager, onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { copyToClipboard } from "./vendor/kit-obsidian/clipboard";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { createRequestSession, type RequestSession } from "./vendor/kit-obsidian/request-session";
import type { RequestSectionState } from "./vendor/kit-obsidian/request-section";
import { checkResponse, thinkingFor, onLevelFor, type RequestSettings } from "./vendor/kit/sampling-profiles";
import { deviationNotice } from "./core/request-text";
import { DEFAULT_SETTINGS, PROBE_TIMEOUT_MS, allPresets, loadRequestSettings, loadSettings, upsertUserPreset, type LingoTunerSettings } from "./core/settings";
import { type Dials } from "./core/dials";
import { buildMessages, systemPrompt } from "./core/prompt";
import { loadOverrides } from "./core/examples/overrides";
import { readiness as readinessOf, type Readiness, type SourceKind } from "./core/source";
import { streamTune, buildTuneParams, responseFactsFromResult, MODE, type TuneResult } from "./core/llm/client";
import { classifyNetworkFailure, classifyShortcutFailure } from "./core/llm/errors";
import { createLingoTunerApi, type LingoTunerApi } from "./core/api";
import { probeEndpoint, listModels, makeChatClient, chatSetupFor, cachedProbe, CHAT_IDLE_TIMEOUT_MS } from "./obsidian/http";
import { createShortcutsBridge, type ShortcutsBridge } from "./vendor/kit-obsidian/shortcuts-bridge";
import type { ChatClient } from "./vendor/kit-obsidian/chat-client";
import { logToLab } from "./vendor/kit-obsidian/lab-client";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { SelectionTracker, createTunedNote, replaceCapture } from "./obsidian/editor-io";
import { vaultOverrideReader } from "./obsidian/overrides-io";
import { appendLogEntry } from "./obsidian/logbook-io";
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
  api!: LingoTunerApi;
  private tracker!: SelectionTracker;
  private selectionDebounce: number | null = null;
  private activeEndpoint: EndpointConfig | null = null;
  /** Modell fuer den naechsten Aufruf — kommt aus resolveEndpointSource (choice.model →
   *  Manager-Default → lokales Modell). NIE settings.model direkt fuer den Aufruf nehmen. */
  private activeModel = "";
  private endpointSource: EndpointSourceKind = "local";
  /** Volles Ergebnis der letzten Aufloesung — traegt Familie/Backend/sentModel fuer den
   *  Abschnitt „Anfrage" und den Denk-Knopf im Panel (Spec § 3.1). Oeffentlich: der Settings-
   *  Tab liest sie fuer `buildRequestSection`. */
  private activeSource: EndpointSourceResult | null = null;
  requestSession: RequestSession = createRequestSession({
    message: (d) => deviationNotice(d),
    onChange: () => { this.panel()?.refresh(); },
  });
  /** Grund, warum `resolveEndpoint()` keinen Endpunkt fand (nur im Manager-Fall gesetzt) —
   *  Review-Fund I3: `tune()` warf das bisher weg und zeigte bei JEDEM Fehlschlag denselben
   *  Text, auch wenn z. B. ein API-Schluessel im Manager fehlt (`secret-missing`). */
  private lastEndpointReason: ApiErrorCode | undefined;
  private unsubscribeManager: () => void = () => {};
  /** Gemerktes Ergebnis fuer den LOKALEN Pfad — resolveEndpointSource pingt bei jedem Aufruf
   *  frisch, das war vorher ueber EndpointResolver gecacht. Der Manager-Fall wird nie gecacht:
   *  „im Manager-Fall cached der Manager" (Task-Brief). */
  private cachedLocal: EndpointConfig | null = null;
  /** Laufender Durchlauf, geteilt — sonst pingt jede gleichzeitige Frage die Liste selbst
   *  (Muster aus dem entfernten core/llm/resolver.ts). */
  private pendingResolve: Promise<EndpointConfig | null> | null = null;
  /** Zuletzt gemeldete Override-Probleme, als ein Schluessel. Ohne das meldet JEDER Lauf
   *  dieselbe kaputte Datei erneut — bei zehn Laeufen zehn Notices fuer denselben Befund. */
  private lastOverrideProblems = "";
  private labMismatchWarned = false;
  /** Ein Chat-Client je Endpunkt und Zeitlimit: die Weigerung, ohne Stream weiterzumachen, haengt an der Instanz. */
  private chatClient: { key: string; client: ChatClient } | null = null;
  /** Bruecke zu Apples on-device-Modell (Kurzbefehl) — im Konsumenten gebaut, der Manager-Vertrag exponiert keine. */
  private shortcutsBridge!: ShortcutsBridge;

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    const raw: unknown = await this.loadData();
    this.settings = loadSettings(raw);
    const { request, dropped } = loadRequestSettings(raw);
    this.settings.request = request;
    if (dropped.length > 0) {
      new Notice(t("request.dropped", String(dropped.length)));
      console.warn("LingoTuner: request settings dropped", dropped);
    }
    this.tracker = new SelectionTracker(this.app.workspace);
    this.shortcutsBridge = createShortcutsBridge(this, { protocolAction: "lingotuner-shortcut" });
    // Nicht awaiten: onload darf nicht auf einer Netz-Probe haengen. Setzt activeEndpoint,
    // damit die Endpunkt-Liste in den Einstellungen die aktive Zeile schon VOR dem ersten Lauf kennt.
    void this.resolveEndpoint();
    // Der Manager kann jederzeit installiert, aktiviert, deaktiviert oder umkonfiguriert
    // werden — bei jeder solchen Aenderung frisch aufloesen, kein this.resolver-Cache mehr.
    this.unsubscribeManager = onEndpointManagerChanged(this.app, () => { this.cachedLocal = null; void this.resolveEndpoint(); });

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
      // Review-Fund I2: im Manager-Fall ist `settings.model` nur der `localModel`-Fallback,
      // den `resolveEndpointSource` im Manager-Zweig NIE konsultiert — ein Panel-Modellfeld,
      // das weiterhin dorthin schreibt, aendert dann kommentarlos nichts. Lesen/Schreiben
      // routen deshalb ueber `endpointSource`, genau wie der Settings-Tab-Baustein (`choice`).
      getModel: () => (this.endpointSource === "manager" ? (this.settings.choice.model ?? "") : this.settings.model),
      setModel: (m) => {
        if (this.endpointSource === "manager") this.settings.choice = { ...this.settings.choice, model: m || undefined };
        else this.settings.model = m;
        void this.saveSettings();
        // activeModel neu ziehen: ohne Invalidierung wuerde ein gecachter lokaler Pfad
        // (cachedLocal) das neue settings.model ignorieren, s. resolveEndpoint().
        this.invalidateEndpointCache();
        void this.resolveEndpoint();
      },
      getFamily: () => this.activeSource?.family ?? null,
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

  activeEndpointUrl(): string | null { return this.activeEndpoint?.url ?? null; }

  /** Fuer `buildRequestSection` im Settings-Tab (Spec § 5.1). */
  requestSectionState(): RequestSectionState {
    const s = this.activeSource;
    return {
      family: s?.family ?? null, familySource: s?.familySource ?? "none",
      backend: s?.backend ?? "unknown", backendSource: s?.backendSource ?? "none",
      model: s?.model ?? "", sentModel: s?.sentModel ?? "",
      ...(s?.defaultModel !== undefined ? { defaultModel: s.defaultModel } : {}),
    };
  }

  async saveRequestSettings(next: RequestSettings): Promise<void> {
    this.settings.request = next;
    await this.saveSettings();
  }

  /** Verwirft den gemerkten lokalen Endpunkt; der naechste resolveEndpoint() pingt die
   *  lokale Liste erneut. Ersatz fuer das entfernte EndpointResolver.invalidate(). */
  invalidateEndpointCache(): void { this.cachedLocal = null; }

  /** EINZIGER Weg zum Endpunkt: aufloesen UND merken. Quelle ist `resolveEndpointSource` —
   *  Manager, wenn vorhanden (Plugin API, bei JEDEM Aufruf frisch gelesen ueber
   *  findEndpointManager, nie gecacht), sonst die lokale Liste. Der lokale Pfad wird HIER
   *  gecacht (wie zuvor im entfernten EndpointResolver), der Manager-Pfad nicht — der Manager
   *  cached sich selbst. */
  async resolveEndpoint(): Promise<EndpointConfig | null> {
    const manager = findEndpointManager(this.app);
    if (!manager && this.cachedLocal !== null) {
      this.activeEndpoint = this.cachedLocal;
      return this.cachedLocal;
    }
    if (this.pendingResolve !== null) return this.pendingResolve;
    this.pendingResolve = resolveEndpointSource({
      manager,
      local: this.settings.endpoints,
      localModel: this.settings.model,
      capability: "chat",
      choice: this.settings.choice,
      caller: "lingotuner",
      backendOf: (cfg) => cachedProbe(cfg.url, cfg.model || this.settings.model),
    }, (ep) => probeEndpoint(ep, PROBE_TIMEOUT_MS).then((s) => s.reachable))
      .then((r) => {
        this.activeEndpoint = r.config;
        this.activeModel = r.model;
        this.endpointSource = r.kind;
        this.lastEndpointReason = r.reason;
        this.activeSource = r;
        if (r.kind === "local") this.cachedLocal = r.config;
        return r.config;
      })
      .finally(() => { this.pendingResolve = null; });
    return this.pendingResolve;
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

  /** Kurzbefehl-Endpunkt (Apple Intelligence)? Der Settings-Tab zeigt dazu den Hinweis auf die Grenzen. */
  isShortcutsEndpoint(): boolean { return this.activeSource?.transport === "shortcuts"; }

  private chatClientFor(ep: EndpointConfig): ChatClient {
    const src = this.activeSource;
    const sc = src?.transport === "shortcuts" && src.shortcut ? `|shortcuts|${src.shortcut.name}|${src.shortcut.timeoutMs}` : "";
    const key = `${normalizeEndpoint(ep.url)}|${this.settings.timeoutSec}${sc}`;
    if (this.chatClient?.key !== key) this.chatClient = { key, client: makeChatClient(this.settings.timeoutSec, src, this.shortcutsBridge) };
    return this.chatClient.client;
  }

  /** EIN Ausfuehrungspfad fuer Panel und API: Endpunkt aufloesen → Overrides → Prompt → Stream → Lab → Logbuch. */
  private async tune(p: { text: string; dials: Dials; note: string; signal?: AbortSignal; quiet?: boolean; onToken?: (t: string) => void; onReasoning?: (t: string) => void }): Promise<TuneResult> {
    const ep = await this.resolveEndpoint();
    if (ep === null) {
      // Review-Fund I3: `resolveEndpointSource` liefert im Manager-Fall einen `reason`-Code
      // mit (`no-endpoint` | `not-found` | `disabled` | `secret-missing` | `unreachable`).
      // `secret-missing` ist der Fall, der aktiv in die Irre fuehrt: die generische Meldung
      // schickt an die lokale Liste, obwohl der fehlende Schluessel im Manager-Plugin liegt.
      new Notice(this.lastEndpointReason === "secret-missing" ? t("run.noEndpointSecretMissing") : t("run.noEndpoint"));
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
    // Review-Fund C1: `ep.model` traegt im MANAGER-Fall haeufig bereits den Default des
    // gewaehlten Endpunkts (der echte Manager setzt ihn in `ResolvedEndpoint.config.model`,
    // s. llm-endpoint-manager/src/core/reachability.ts) — eine vom Nutzer im Settings-/Panel-
    // Baustein getroffene Modellwahl (`choice.model`, bereits in `activeModel` verrechnet)
    // wuerde sonst hier verworfen. `ep.model` gewinnt deshalb NUR noch im lokalen Fall (dort
    // ist es die Pro-Endpunkt-Ueberschreibung der lokalen Liste, s. `set.model`/`ep.ariaModel`).
    const model = this.endpointSource === "local" && ep.model ? ep.model : this.activeModel;
    const family = this.activeSource?.family ?? null;
    const backend = this.activeSource?.backend ?? "unknown";
    const sentModel = this.activeSource?.sentModel ?? model;
    const level = thinkingFor(this.settings.request, MODE);
    const paramOverrides = this.settings.request.overrides[MODE]?.[family ?? "unknown"] ?? {};
    const { params } = buildTuneParams({ family, backend, thinking: level, overrides: paramOverrides });
    this.requestSession.recordRequest(params);

    const started = Date.now();
    // Ein Tunen = eine Nutzer-Handlung = eine turnId (apiVersion 4); das Lab klammert damit Aufrufe.
    const turnId = crypto.randomUUID();
    const viaShortcut = this.activeSource?.transport === "shortcuts";
    let result: TuneResult;
    try {
      const timeouts = { firstChunkSec: chatSetupFor(this.settings.timeoutSec, this.activeSource, this.shortcutsBridge).firstChunkMs / 1000, idleSec: CHAT_IDLE_TIMEOUT_MS / 1000 };
      result = await streamTune(this.chatClientFor(ep), {
        messages, endpoint: ep, model, sentModel, params, timeouts, signal: p.signal, onToken: p.onToken, onReasoning: p.onReasoning,
      });
    } catch (e) {
      // Konfigurationsfehler des Transports (Kurzbefehl-Endpunkt ohne Kurzbefehl-Angabe): sichtbar melden, nicht still auf HTTP fallen.
      result = { ok: false, error: { kind: "shortcut", reason: "error", detail: e instanceof Error ? e.message : String(e) }, partial: "" };
    }
    if (viaShortcut && !result.ok && result.error.kind === "http") {
      result = { ...result, error: classifyShortcutFailure(result.status ?? result.error.status, result.errorText ?? result.error.detail) };
    }

    if (!result.ok && result.error.kind === "network" && !viaShortcut) {
      // „Probe gruen, Chat rot" — der Client hat Stream UND Anfrage ohne Stream versucht (Fallback
      // ueber requestUrl); scheitern beide, ist der Endpunkt entweder tot oder verweigert beides.
      const probe = await probeEndpoint(ep, PROBE_TIMEOUT_MS);
      result = { ...result, error: classifyNetworkFailure(probe.reachable) };
      if (!probe.reachable) this.invalidateEndpointCache();
    }

    const facts = responseFactsFromResult(result);
    if (facts) this.requestSession.report(checkResponse({ family, thinking: level }, facts));

    const lab = logToLab(this.app, {
      plugin: "lingotuner", feature: "tune", model, endpointUrl: ep.url, messages,
      content: result.ok ? result.text : result.partial,
      ...(result.ok && result.reasoning ? { reasoning: result.reasoning } : {}),
      ...(result.ok && result.truncated ? { finishReason: "length" } : {}),
      latencyMs: Date.now() - started,
      ...(result.ttftMs !== undefined ? { ttftMs: result.ttftMs } : {}),
      ...(ep.apiKey ? { secrets: [ep.apiKey] } : {}),
      promptTemplate: systemPrompt(p.dials, { lang: opts.lang, overrides }),
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
