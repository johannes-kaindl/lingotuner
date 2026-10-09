import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App, PluginManifest } from "obsidian";
import { loadSettings } from "../src/core/settings";
import { NEUTRAL } from "../src/core/dials";
import "../src/i18n/strings";
import { DONE, delta, fakeTransport, makeConnection } from "./helpers/connection";

vi.mock("../src/vendor/kit-obsidian/lab-client", () => ({ logToLab: () => ({ ok: true }) }));
vi.mock("../src/core/examples/overrides", () => ({ loadOverrides: vi.fn(() => Promise.resolve({ overrides: [], problems: [] })) }));

// Server beim Start noch aus: die erste Aufloesung findet keinen Endpunkt. Ein spaeterer Lauf muss ihn finden,
// ohne dass die Liste angefasst wird (die Verbindung merkt „kein Endpunkt“ seit Kit 0.51.3 nicht mehr).
describe("tune — Server startet nach dem Plugin", () => {
  beforeEach(() => { vi.stubGlobal("window", { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) }); });
  afterEach(() => vi.unstubAllGlobals());

  it("der erste Lauf nach dem Serverstart laeuft", async () => {
    const Plugin = (await import("../src/main")).default;
    const plugin = new Plugin({ plugins: { plugins: {} }, workspace: { getLeavesOfType: () => [] } } as unknown as App, {} as unknown as PluginManifest);
    plugin.settings = loadSettings({ endpoints: [{ url: "http://l" }] });
    let up = false;
    const llm = makeConnection({ transport: fakeTransport([delta("tuned"), DONE]), probe: () => Promise.resolve(up) });
    (plugin as unknown as { llm: unknown }).llm = llm;
    await llm.resolve();
    up = true;
    const r = await (plugin as unknown as { tune: (p: unknown) => Promise<{ ok: boolean }> }).tune({ text: "x", dials: { ...NEUTRAL, social: 1 }, note: "", quiet: true });
    expect(r.ok).toBe(true);
  });
});
