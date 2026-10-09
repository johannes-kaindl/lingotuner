import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App, PluginManifest } from "obsidian";
import { loadSettings } from "../src/core/settings";
import { NEUTRAL } from "../src/core/dials";
import "../src/i18n/strings";
import { fakeConnection } from "./helpers/connection";

vi.mock("../src/vendor/kit-obsidian/lab-client", () => ({ logToLab: () => ({ ok: true }) }));
vi.mock("../src/core/examples/overrides", () => ({ loadOverrides: vi.fn(() => Promise.resolve({ overrides: [], problems: [] })) }));

// Die Verbindung merkt eine lokale Aufloesung auch ohne Endpunkt (Server beim Start noch aus). Ein Lauf muss dann
// einmal frisch fragen, statt „kein Endpunkt“ bis zur naechsten Listenaenderung zu melden.
describe("tune — gemerkte Aufloesung ohne Endpunkt", () => {
  beforeEach(() => { vi.stubGlobal("window", { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) }); });
  afterEach(() => vi.unstubAllGlobals());

  it("fragt mit force nach und laeuft, sobald der Server da ist", async () => {
    const Plugin = (await import("../src/main")).default;
    const plugin = new Plugin({ plugins: { plugins: {} }, workspace: { getLeavesOfType: () => [] } } as unknown as App, {} as unknown as PluginManifest);
    plugin.settings = loadSettings({ endpoints: [{ url: "http://l" }] });
    const ok = fakeConnection("tuned") as { resolve: (o?: { force?: boolean }) => Promise<unknown> };
    const resolve = vi.fn((o?: { force?: boolean }) => (o?.force ? ok.resolve() : Promise.resolve({ kind: "local", config: null, model: "" })));
    (plugin as unknown as { llm: unknown }).llm = { ...ok, resolve };
    const r = await (plugin as unknown as { tune: (p: unknown) => Promise<{ ok: boolean }> }).tune({ text: "x", dials: { ...NEUTRAL, social: 1 }, note: "", quiet: true });
    expect(r.ok).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ force: true });
  });
});
