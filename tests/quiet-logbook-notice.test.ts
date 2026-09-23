import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App, PluginManifest } from "obsidian";
import { Notice } from "./vendor/kit/obsidian-mock";
import { loadSettings } from "../src/core/settings";
import { NEUTRAL } from "../src/core/dials";
import "../src/i18n/strings";

// Nachlese 0.1.1-Review (geparkt mit Ruling): `quiet` deckte die Logbuch-Fehler-Notice bei
// API-Laeufen (main.ts, Logbuch-`catch`) nicht ab — anders als der Override-Fehler direkt
// darueber (Zeile 237), der bei `quiet: true` schon immer nur `console.warn` schrieb. Diese
// Datei prueft den nachgezogenen Fix isoliert, ohne den vollen Netzwerk-Pfad zu mocken: das
// Logbuch-`catch` ist erreichbar, sobald `streamTune` ok liefert und `appendLogEntry` wirft.
// `tune()` ist privat (nur ueber Panel/API erreichbar) — direkt angesprochen wie in
// tests/resolve-endpoint-cache.test.ts ueblich (dort `resolveEndpoint`, hier `tune`), statt
// den vollen Panel-View- oder Api-Aufbau (`onload()`) fuer einen einzelnen catch-Zweig zu
// mocken.
vi.mock("../src/core/llm/client", () => ({
  MODE: "transform",
  streamTune: vi.fn(() => Promise.resolve({ ok: true, text: "tuned", reasoning: "", model: "m", truncated: false })),
  buildTuneParams: vi.fn(() => ({ params: {}, explain: [] })),
  responseFactsFromResult: vi.fn(() => null),
}));
vi.mock("../src/obsidian/logbook-io", () => ({
  appendLogEntry: vi.fn(() => Promise.reject(new Error("Logbuch-Fehler"))),
}));
vi.mock("../src/core/examples/overrides", () => ({
  loadOverrides: vi.fn(() => Promise.resolve({ overrides: [], problems: [] })),
}));

function makeApp(): App {
  return { plugins: { plugins: {} }, workspace: { getLeavesOfType: () => [] } } as unknown as App;
}

type TuneParams = { text: string; dials: typeof NEUTRAL; note: string; quiet?: boolean };

async function makePlugin(): Promise<{ tune: (p: TuneParams) => Promise<unknown> }> {
  const Plugin = (await import("../src/main")).default;
  const plugin = new Plugin(makeApp(), {} as unknown as PluginManifest);
  plugin.settings = loadSettings({ endpoints: [{ url: "http://l" }], logbookEnabled: true });
  vi.spyOn(plugin, "resolveEndpoint").mockResolvedValue({ url: "http://l" });
  return plugin as unknown as { tune: (p: TuneParams) => Promise<unknown> };
}

describe("LingoTunerPlugin.tune — quiet unterdrueckt die Logbuch-Fehler-Notice", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
    Notice.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("API-Lauf (quiet: true): console.warn statt Notice", async () => {
    const plugin = await makePlugin();
    await plugin.tune({ text: "Text", dials: { ...NEUTRAL, social: 1 }, note: "", quiet: true });

    expect(Notice.instances.length).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Logbuch-Fehler"));
  });

  it("Panel-Lauf (quiet nicht gesetzt): Notice, kein console.warn", async () => {
    const plugin = await makePlugin();
    await plugin.tune({ text: "Text", dials: { ...NEUTRAL, social: 1 }, note: "" });

    expect(Notice.instances.length).toBe(1);
    expect(Notice.instances[0]?.message).toContain("Logbuch-Fehler");
    expect(console.warn).not.toHaveBeenCalled();
  });
});
