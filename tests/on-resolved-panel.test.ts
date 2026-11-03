import { describe, it, expect, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import { LingoTunerView } from "../src/obsidian/view";

// Task „Denk-Steuerung der Modellzeile fuellt sich erst nach refresh()“ (Welle 29/30): Wechselt in den Einstellungen Endpunkt oder Backend, meldet die Verbindung das ueber
// `onResolved`, und das offene Panel zeichnet seine Modellzeile aus dem neuen Zustand. Die Verdrahtung in `onload` belegt der Smoke-Punkt ML6 am echten Wechsel;
// hier der Rueckruf selbst: er erreicht das Panel, und ohne offenes Panel geschieht nichts.
async function makePlugin(view: unknown): Promise<{ onLlmResolved: () => void }> {
  const Plugin = (await import("../src/main")).default;
  const app = { plugins: { plugins: {} }, workspace: { getLeavesOfType: () => (view === null ? [] : [{ view }]) } } as unknown as App;
  return new Plugin(app, {} as unknown as PluginManifest) as unknown as { onLlmResolved: () => void };
}

describe("LingoTunerPlugin.onLlmResolved", () => {
  it("zeichnet das offene Panel neu (refresh), genau einmal", async () => {
    const view = Object.create(LingoTunerView.prototype) as { refresh: () => void };
    view.refresh = vi.fn();
    const plugin = await makePlugin(view);
    plugin.onLlmResolved();
    expect(view.refresh).toHaveBeenCalledTimes(1);
  });

  it("ohne offenes Panel: nichts, kein Wurf", async () => {
    const plugin = await makePlugin(null);
    expect(() => { plugin.onLlmResolved(); }).not.toThrow();
  });
});
