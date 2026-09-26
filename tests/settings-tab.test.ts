import { afterEach, describe, it, expect, vi } from "vitest";
import { Setting } from "obsidian";
import { setLang } from "../src/vendor/kit/i18n";
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
    const defs = (tab.getSettingDefinitions() as unknown as { type?: string; heading: string; items: { control?: { key: string } }[] }[])
      .filter((d) => d.type === "group");
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

describe("Hilfe-Zeile (UI-STANDARD §8)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setLang("en");
  });
  type Hatch = { name?: string; desc?: string; render?: (s: Setting) => void };
  const erste = (): Hatch => new LingoTunerSettingTab({} as App, fakePlugin() as never).getSettingDefinitions()[0] as unknown as Hatch;

  it("ist das ERSTE Element von getSettingDefinitions, vor jeder Gruppe", () => {
    setLang("en");
    expect(erste().name).toBe("Help");
    expect(typeof erste().render).toBe("function");
  });

  it("spricht die Sprache der Settings (EN und DE)", () => {
    setLang("de");
    expect(erste().name).toBe("Hilfe");
    setLang("en");
    expect(erste().desc).toBe("Getting started, how-tos and troubleshooting");
  });

  it("die Knöpfe öffnen Doku-Index und Issues dieses Repos", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const setting = new Setting(undefined as never);
    erste().render?.(setting);
    const knoepfe = (setting as unknown as { components: Array<{ clickCB: (() => void) | null }> }).components;
    expect(knoepfe).toHaveLength(2);
    knoepfe.forEach((k) => k.clickCB?.());
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      "https://github.com/johannes-kaindl/lingotuner/blob/main/docs/README.md",
      "https://github.com/johannes-kaindl/lingotuner/issues",
    ]);
  });
});
