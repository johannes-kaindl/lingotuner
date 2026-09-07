import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type LingoTunerPlugin from "../main";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "../vendor/kit-obsidian/settings_walker";
import { buildEndpointList, type EndpointListStrings } from "../vendor/kit-obsidian/endpoint-list";
import { renderModelPicker } from "../vendor/kit-obsidian/model-picker";
import { resolveModelChoice } from "../vendor/kit/model-choice";
import { createModelListCache, type ModelListCache } from "../vendor/kit/model-list-cache";
import { ENDPOINT_PRESETS, type EndpointStatusKind } from "../vendor/kit/endpoint_diagnostics";
import type { EndpointRole } from "../vendor/kit/endpoint_config";
import { clientFor } from "./http";
import { writeShippedTexts } from "../core/examples/overrides";
import { vaultOverrideWriter } from "./overrides-io";
import { PROBE_TIMEOUT_MS, removeUserPreset, TIMEOUT_SEC_MIN } from "../core/settings";
import { getLang } from "../vendor/kit/i18n";

type ControlDef = { type: "text" | "toggle" | "number" | "folder"; key: string; placeholder?: string; min?: number };
type ItemDef = { name?: string; desc?: string; control?: ControlDef; render?: (setting: Setting) => void };
type GroupDef = { type?: string; heading?: string; items?: ItemDef[] };

const STATUS_KEY: Record<Exclude<EndpointStatusKind, "unknown">, string> = {
  "ok": "ep.status.ok",
  "refused": "ep.status.refused",
  "unknown-host": "ep.status.unknownHost",
  "timeout": "ep.status.timeout",
  "not-an-llm-api": "ep.status.notAnLlmApi",
  "unauthorized": "ep.status.unauthorized",
};
const WARN_KEY: Record<string, string> = {
  "scheme": "ep.warn.scheme",
  "malformed": "ep.warn.malformed",
  "port": "ep.warn.port",
  "placeholder-ip": "ep.warn.placeholderIp",
};

export class LingoTunerSettingTab extends PluginSettingTab {
  /** Modell-Listen je Endpunkt — Lebensdauer des TABS (Kit-Vertrag), clear() in hide(). */
  private modelLists: ModelListCache = createModelListCache();
  private modelState: { url: string; models: string[]; reachable: boolean } | null = null;
  private cleanupPrevious: () => void = () => {};

  constructor(app: App, private readonly plugin: LingoTunerPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const defs: GroupDef[] = [
      {
        type: "group",
        heading: t("set.groupConnection"),
        items: [
          { name: t("set.endpoints"), desc: t("set.endpointsDesc"), render: (s) => { this.renderEndpoints(s); } },
          { name: t("set.model"), desc: t("set.modelDesc"), render: (s) => { this.renderModel(s); } },
          { name: t("set.suppress"), desc: t("set.suppressDesc"), control: { type: "toggle", key: "suppressThinking" } },
          { name: t("set.timeout"), desc: t("set.timeoutDesc"), control: { type: "number", key: "timeoutSec", min: TIMEOUT_SEC_MIN } },
        ],
      },
      {
        type: "group",
        heading: t("set.groupStyle"),
        items: [
          { name: t("set.overrideFolder"), desc: t("set.overrideFolderDesc"), control: { type: "folder", key: "overrideFolder" } },
          { name: t("set.overrideWrite"), desc: t("set.overrideWriteDesc"), render: (s) => { this.renderOverrideWrite(s); } },
          { name: t("set.presets"), desc: t("set.presetsDesc"), render: (s) => { this.renderPresets(s); } },
        ],
      },
      {
        type: "group",
        heading: t("set.groupOutput"),
        items: [
          { name: t("set.logbook"), desc: t("set.logbookDesc"), control: { type: "toggle", key: "logbookEnabled" } },
          { name: t("set.logbookFolder"), desc: t("set.logbookFolderDesc"), control: { type: "folder", key: "logbookFolder" } },
          { name: t("set.newNoteFolder"), desc: t("set.newNoteFolderDesc"), control: { type: "folder", key: "newNoteFolder" } },
        ],
      },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  private endpointStrings(): EndpointListStrings {
    return {
      addPlaceholder: t("ep.addPlaceholder"),
      apiKeyPlaceholder: t("ep.apiKeyPlaceholder"),
      modelPlaceholder: t("ep.modelPlaceholder"),
      ariaUrl: t("ep.ariaUrl"),
      ariaAdd: t("ep.ariaAdd"),
      ariaApiKey: (url) => t("ep.ariaApiKey", url),
      ariaModel: (url) => t("ep.ariaModel", url),
      emptyModelLabel: (globalModel) => (globalModel ? t("ep.globalModel", globalModel) : t("ep.globalModelUnset")),
      modelHint: (key) => (key === "unreachable" ? t("ep.hint.unreachable") : key === "no-list" ? t("ep.hint.noList") : ""),
      savedSuffix: t("ep.saved"),
      refreshModels: t("ep.refreshModels"),
      moveToFront: t("ep.moveToFront"),
      remove: t("ep.remove"),
      thirdParty: t("ep.thirdParty"),
      probing: t("ep.probing"),
      statusTooltip: (status) => (status.kind === "unknown" ? t("ep.status.unknown", status.raw ?? "") : t(STATUS_KEY[status.kind])),
      role: (role: EndpointRole) => role.kind === "active" ? t("ep.role.active")
        : role.kind === "standby" ? t("ep.role.standby", String(role.position))
        : role.kind === "unreachable" ? t("ep.role.unreachable")
        : t("ep.role.skippedModel"),
      warnings: (warnings) => warnings.map((w) => (WARN_KEY[w.rule] ? t(WARN_KEY[w.rule]) : w.message)).join(" · "),
      presetTooltip: (preset) => t("ep.preset", preset.label),
      presetLabel: (preset) => preset.label,
      checkConnection: t("ep.checkConnection"),
      saveFailed: t("ep.saveFailed"),
    };
  }

  private renderEndpoints(setting: Setting): void {
    buildEndpointList({
      containerEl: settingBodyHost(setting),
      label: t("set.endpoints"),
      desc: t("set.endpointsDesc"),
      placeholder: "http://127.0.0.1:1234",
      strings: this.endpointStrings(),
      cache: this.modelLists,
      get: () => this.plugin.settings.endpoints,
      set: (eps) => { this.plugin.settings.endpoints = eps; },
      active: () => this.plugin.activeEndpointUrl(),
      clientFor: (cfg) => clientFor(cfg, PROBE_TIMEOUT_MS),
      globalModel: () => this.plugin.settings.model,
      save: () => this.plugin.saveSettings(),
      reconnect: async () => { this.plugin.resolver.invalidate(); await this.plugin.resolveEndpoint(); },
      rerender: () => { this.refreshUi(); },
      presets: ENDPOINT_PRESETS,
    });
  }

  private renderModel(setting: Setting): void {
    const host = settingBodyHost(setting);
    const row = new Setting(host).setName(t("set.model")).setDesc(t("set.modelDesc"));
    const ep = this.plugin.settings.endpoints[0];
    const url = ep?.url ?? "";
    const state = this.modelState !== null && this.modelState.url === url ? this.modelState : null;
    const load = async (): Promise<void> => {
      if (ep === undefined) return;
      this.modelLists.invalidate(url);
      const r = await this.modelLists.load(url, clientFor(ep, PROBE_TIMEOUT_MS));
      this.modelState = { url, models: r.models, reachable: r.reachable };
      this.refreshUi();
    };
    if (state === null) {
      row.setDesc(t("set.modelNotLoaded"));
      row.addButton((b) => b.setButtonText(t("set.modelFetch")).onClick(() => {
        b.buttonEl.disabled = true;
        b.setButtonText(t("set.modelFetching"));
        void load();
      }));
      return;
    }
    const choice = resolveModelChoice({ reachable: state.reachable, models: state.models, current: this.plugin.settings.model, allowEmpty: true });
    renderModelPicker({
      setting: row,
      choice,
      ariaLabel: t("set.model"),
      placeholder: "",
      hint: choice.hintKey === "" ? "" : t(`set.modelHint.${choice.hintKey}`),
      hintAs: "desc",
      savedSuffix: t("ep.saved"),
      refreshTooltip: t("ep.refreshModels"),
      onPick: (value) => { this.plugin.settings.model = value; void this.plugin.saveSettings(); },
      onRefresh: () => { void load(); },
    });
  }

  private renderOverrideWrite(setting: Setting): void {
    setting.addButton((b) => b.setButtonText(t("set.overrideWrite")).onClick(() => {
      const folder = this.plugin.settings.overrideFolder.trim() || "LingoTuner";
      b.buttonEl.disabled = true;
      void writeShippedTexts(vaultOverrideWriter(this.app), folder, getLang())
        .then((n) => {
          new Notice(t("set.overrideWritten", String(n), folder));
          if (this.plugin.settings.overrideFolder.trim() === "") {
            this.plugin.settings.overrideFolder = folder;
            void this.plugin.saveSettings().then(() => this.refreshUi());
          }
        })
        .catch((e: unknown) => {
          new Notice(t("set.overrideWriteFailed", e instanceof Error ? e.message : String(e)));
        })
        .finally(() => { b.buttonEl.disabled = false; });
    }));
  }

  private renderPresets(setting: Setting): void {
    const host = settingBodyHost(setting);
    const list = this.plugin.settings.userPresets;
    if (list.length === 0) {
      new Setting(host).setDesc(t("set.presetsNone"));
      return;
    }
    for (const p of list) {
      const row = new Setting(host).setName(p.name)
        .setDesc(`${p.dials.directness} · ${p.dials.context} · ${p.dials.social} · ${p.dials.semantics}`);
      row.addExtraButton((b) => b.setIcon("trash-2").setTooltip(t("preset.delete")).onClick(() => {
        this.plugin.settings.userPresets = removeUserPreset(this.plugin.settings.userPresets, p.name);
        void this.plugin.saveSettings().then(() => this.refreshUi());
      }));
    }
  }

  display(): void { this.renderImperative(); }

  hide(): void { this.modelLists.clear(); }

  private refreshUi(): void { refreshSettingsTab(this, () => this.renderImperative()); }

  private renderImperative(): void {
    this.cleanupPrevious();
    const { containerEl } = this;
    containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(containerEl, this.getSettingDefinitions(), this, this.app);
  }

  getControlValue(key: string): string | number | boolean | undefined {
    const s = this.plugin.settings;
    switch (key) {
      case "suppressThinking": return s.suppressThinking;
      case "timeoutSec": return s.timeoutSec;
      case "overrideFolder": return s.overrideFolder;
      case "logbookEnabled": return s.logbookEnabled;
      case "logbookFolder": return s.logbookFolder;
      case "newNoteFolder": return s.newNoteFolder;
      default: return undefined;
    }
  }

  setControlValue(key: string, value: unknown): void {
    const s = this.plugin.settings;
    switch (key) {
      case "suppressThinking": s.suppressThinking = Boolean(value); break;
      case "timeoutSec": {
        const n = Number.parseInt(String(value), 10);
        s.timeoutSec = Number.isFinite(n) ? Math.max(TIMEOUT_SEC_MIN, n) : s.timeoutSec;
        break;
      }
      case "overrideFolder": s.overrideFolder = String(value).trim(); break;
      case "logbookEnabled": s.logbookEnabled = Boolean(value); break;
      case "logbookFolder": s.logbookFolder = String(value).trim(); break;
      case "newNoteFolder": s.newNoteFolder = String(value).trim(); break;
      default: return;
    }
    void this.plugin.saveSettings();
  }
}
