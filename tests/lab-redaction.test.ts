import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App, PluginManifest } from "obsidian";
import { loadSettings } from "../src/core/settings";
import { NEUTRAL } from "../src/core/dials";
import "../src/i18n/strings";
import { fakeConnection } from "./helpers/connection";

// Die Verbindung schwaerzt vor dem Senden, umkehrbar: lingotuner bekommt die Originale zurueck. Das Lab
// soll aber den GESENDETEN Text tragen (das Log entspricht dem Draht) — sonst stuenden Geheimnisse an
// einem Ort, den der Server nie sah.
const logToLab = vi.fn((..._a: unknown[]) => ({ ok: true }));
vi.mock("../src/vendor/kit-obsidian/lab-client", () => ({ logToLab: (...a: unknown[]) => logToLab(...a) }));
vi.mock("../src/core/examples/overrides", () => ({
  loadOverrides: vi.fn(() => Promise.resolve({ overrides: [], problems: [] })),
}));

const BEARER = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";

async function makePlugin(answer: string): Promise<{ tune: (p: { text: string; dials: typeof NEUTRAL; note: string; quiet?: boolean }) => Promise<unknown> }> {
  const Plugin = (await import("../src/main")).default;
  const plugin = new Plugin({ plugins: { plugins: {} }, workspace: { getLeavesOfType: () => [] } } as unknown as App, {} as unknown as PluginManifest);
  plugin.settings = loadSettings({ endpoints: [{ url: "http://l" }] });
  (plugin as unknown as { llm: unknown }).llm = fakeConnection(answer);
  return plugin as unknown as { tune: (p: { text: string; dials: typeof NEUTRAL; note: string; quiet?: boolean }) => Promise<unknown> };
}

describe("Lab-Aufzeichnung — gesendeter Text statt Originale", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
    logToLab.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ein Token in der Eingabe steht im Lab als Platzhalter, nicht im Original", async () => {
    const plugin = await makePlugin("Antwort ohne Geheimnis");
    await plugin.tune({ text: `Bitte kuerzen: Authorization: ${BEARER}`, dials: NEUTRAL, note: "", quiet: true });
    expect(logToLab).toHaveBeenCalledTimes(1);
    const payload = logToLab.mock.calls[0]?.[1] as { messages: { content: string }[]; content: string; promptTemplate: string };
    const all = JSON.stringify(payload.messages);
    expect(all).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(all).toMatch(/\[redacted-[a-z0-9-]+-\d+\]/);
  });

  it("derselbe Wert in der Antwort traegt im Lab denselben Platzhalter wie in der Eingabe", async () => {
    const plugin = await makePlugin(`Hier: ${BEARER}`);
    await plugin.tune({ text: `Bitte kuerzen: Authorization: ${BEARER}`, dials: NEUTRAL, note: "", quiet: true });
    const payload = logToLab.mock.calls[0]?.[1] as { messages: { role: string; content: string }[]; content: string };
    expect(payload.content).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    const placeholder = /\[redacted-[a-z0-9-]+-\d+\]/.exec(payload.content)?.[0];
    expect(placeholder).toBeDefined();
    expect(payload.messages.find((m) => m.role === "user")?.content).toContain(placeholder);
  });
});
