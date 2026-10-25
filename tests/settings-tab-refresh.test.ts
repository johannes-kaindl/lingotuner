import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { PluginSettingTab } from "obsidian";
import type { App } from "obsidian";
import { LingoTunerSettingTab } from "../src/obsidian/settings-tab";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import "../src/i18n/strings";

// Kit-Vertrag `installTabRefreshOnOpen` (gemessen an Obsidian 1.14.5): das Oeffnen ruft `renderTab()`, nicht `display()`. Der Haken baut den Tab
// nur dann bei JEDEM Oeffnen neu auf, solange er installiert bleibt; ein Abbau in `hide()` liess ihn nach dem ersten Schliessen verschwinden.
const NATIVE = vi.fn();
type Proto = { renderTab?: () => void };

beforeEach(() => { (PluginSettingTab.prototype as Proto).renderTab = NATIVE; NATIVE.mockClear(); });
afterEach(() => { delete (PluginSettingTab.prototype as Proto).renderTab; vi.restoreAllMocks(); });

function makeTab() {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: vi.fn(() => Promise.resolve()),
    llm: { resolve: vi.fn(() => Promise.resolve({ config: null })), models: vi.fn(() => Promise.resolve({ models: [], reachable: false })), hideSettings: vi.fn(), renderSettings: vi.fn() },
    app: {},
    manifest: { id: "lingotuner" },
  };
  const tab = new LingoTunerSettingTab({} as App, plugin as never);
  const rebuild = vi.spyOn(tab as unknown as { renderImperative(): void }, "renderImperative").mockImplementation(() => {});
  return { tab, rebuild };
}

describe("Einstellungen-Tab: der Oeffnen-Haken", () => {
  it("jedes Oeffnen baut den Tab neu auf, auch nach hide()", () => {
    const { tab, rebuild } = makeTab();
    const open = (): void => { (tab as unknown as Proto).renderTab?.(); };
    open();
    tab.hide();
    open();
    tab.hide();
    open();
    expect(rebuild).toHaveBeenCalledTimes(3);
    expect(NATIVE).not.toHaveBeenCalled();
  });

  it("hide() laesst den Haken stehen: renderTab bleibt die Funktion des Hakens, nicht die native", () => {
    const { tab } = makeTab();
    const hook = (tab as unknown as Proto).renderTab;
    expect(hook).not.toBe(NATIVE);
    tab.hide();
    expect((tab as unknown as Proto).renderTab).toBe(hook);
  });

  it("dispose() (aus onunload) nimmt den Haken ab: renderTab ist wieder die native Funktion", () => {
    const { tab } = makeTab();
    tab.dispose();
    expect((tab as unknown as Proto).renderTab).toBe(NATIVE);
  });
});
