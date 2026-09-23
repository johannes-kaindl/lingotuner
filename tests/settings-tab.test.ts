import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { LingoTunerSettingTab } from "../src/obsidian/settings-tab";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import "../src/i18n/strings";

function fakePlugin() {
  return {
    settings: { ...DEFAULT_SETTINGS, userPresets: [{ name: "Chef", dials: { directness: 1, context: 0, social: 2, semantics: 0 } }] },
    saveSettings: vi.fn(() => Promise.resolve()),
    resolver: { invalidate: vi.fn(), resolve: vi.fn(() => Promise.resolve(null)) },
    activeEndpointUrl: () => null,
    app: {},
    manifest: { id: "lingotuner" },
  };
}

describe("LingoTunerSettingTab", () => {
  it("liefert drei Gruppen mit allen Schluesseln", () => {
    const tab = new LingoTunerSettingTab({} as App, fakePlugin() as never);
    const defs = tab.getSettingDefinitions() as unknown as { heading: string; items: { control?: { key: string } }[] }[];
    expect(defs).toHaveLength(3);
    const keys = defs.flatMap((g) => g.items.map((i) => i.control?.key).filter((k): k is string => k !== undefined));
    expect(keys).toEqual(["timeoutSec", "overrideFolder", "logbookEnabled", "logbookFolder", "newNoteFolder"]);
  });

  it("setControlValue klemmt das Zeitlimit und speichert", () => {
    const p = fakePlugin();
    const tab = new LingoTunerSettingTab({} as App, p as never);
    tab.setControlValue("timeoutSec", "2");
    expect(p.settings.timeoutSec).toBe(5);
    tab.setControlValue("timeoutSec", "abc");
    expect(p.settings.timeoutSec).toBe(5);
    expect(p.saveSettings).toHaveBeenCalledTimes(2);
  });

  it("getControlValue liest die Settings", () => {
    const p = fakePlugin();
    const tab = new LingoTunerSettingTab({} as App, p as never);
    expect(tab.getControlValue("logbookFolder")).toBe("LingoTuner");
    expect(tab.getControlValue("nix")).toBeUndefined();
  });
});
