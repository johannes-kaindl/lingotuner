import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, loadSettings, type LingoTunerSettings } from "./core/settings";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";

export default class LingoTunerPlugin extends Plugin {
  settings: LingoTunerSettings = DEFAULT_SETTINGS;
  resolver: { invalidate(): void; resolve(): Promise<EndpointConfig | null> } = { invalidate: () => {}, resolve: () => Promise.resolve(null) };

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
  }

  activeEndpointUrl(): string | null { return null; }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
