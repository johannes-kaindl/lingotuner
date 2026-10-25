import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type LingoTunerPlugin from "../main";
import { t } from "../vendor/kit/i18n";
import { githubHelpUrls, helpSettingDefinition } from "../vendor/kit-obsidian/help-setting";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "../vendor/kit-obsidian/settings_walker";
import { installTabRefreshOnOpen } from "../vendor/kit-obsidian/settings_walker";
import { writeShippedTexts } from "../core/examples/overrides";
import { vaultOverrideWriter } from "./overrides-io";
import { removeUserPreset } from "../core/settings";
import { getLang } from "../vendor/kit/i18n";

type ControlDef = { type: "text" | "toggle" | "number" | "folder"; key: string; placeholder?: string; min?: number };
type ItemDef = { name?: string; desc?: string; control?: ControlDef; render?: (setting: Setting) => void };
type GroupDef = { type?: string; heading?: string; items?: ItemDef[] };

export class LingoTunerSettingTab extends PluginSettingTab {
  private cleanupPrevious: () => void = () => {};
  private removeRefreshHook: () => void = () => {};

  constructor(app: App, private readonly plugin: LingoTunerPlugin) {
    super(app, plugin);
    // „Letzte Anfrage" und Abweichungen sollen beim Oeffnen des Tabs aktuell sein (Rezept 6).
    this.removeRefreshHook = installTabRefreshOnOpen(this, () => this.renderImperative());
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const defs: GroupDef[] = [
      {
        type: "group",
        heading: t("set.groupConnection"),
        items: [
          // Eigener Host, weil die Verbindung ihren Container bei jedem Neuzeichnen leert (Quelle, Liste, Anfrage in einem Zug).
          { render: (s) => { this.renderConnection(s); } },
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
    // UI-STANDARD §8: die Hilfe-Zeile steht vor jeder Gruppe.
    const help = helpSettingDefinition({
      ...githubHelpUrls("lingotuner"),
      texts: {
        name: t("set.help.name"),
        desc: t("set.help.desc"),
        openDocs: t("set.help.openDocs"),
        reportIssue: t("set.help.reportIssue"),
      },
    });
    return [help, ...(defs as unknown as SettingDefinitionItem[])];
  }

  private renderConnection(setting: Setting): void {
    const host = settingBodyHost(setting);
    // Zwei Geschwister: die Verbindung leert ihren Container bei jedem Neuzeichnen, der Hinweis darf das nicht verlieren.
    const connectionEl = host.createDiv({ cls: "lt-connection" });
    const hintEl = host.createDiv({ cls: "lt-connection-hint" });
    this.plugin.llm.renderSettings(connectionEl, { lang: getLang() });
    // Der Kurzbefehl-Hinweis haengt an der aufgeloesten Quelle (asynchron, die Verbindung merkt sie sich).
    void this.plugin.llm.resolve().then((src) => {
      if (src.transport === "shortcuts" && hintEl.isConnected) new Setting(hintEl).setDesc(t("src.appleHint"));
    }).catch(() => undefined);
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

  // Der Oeffnen-Haken bleibt nach hide() installiert: das Oeffnen ruft renderTab(), und ohne Haken baute der Tab nur beim ersten Mal neu auf.
  hide(): void { this.plugin.llm.hideSettings(); }

  /** Nimmt den Oeffnen-Haken ab. Gehoert in `onunload` des Plugins, nicht in `hide()` (Kit-Vertrag `installTabRefreshOnOpen`). */
  dispose(): void { this.removeRefreshHook(); }

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
      case "overrideFolder": s.overrideFolder = String(value).trim(); break;
      case "logbookEnabled": s.logbookEnabled = Boolean(value); break;
      case "logbookFolder": s.logbookFolder = String(value).trim(); break;
      case "newNoteFolder": s.newNoteFolder = String(value).trim(); break;
      default: return;
    }
    void this.plugin.saveSettings();
  }
}
