import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App, PluginManifest } from "obsidian";
// NICHT von "obsidian" importiert: die vitest-Alias-Umleitung auf den Mock ist ein
// Bundler-/Runtime-Mechanismus, `tsc` (typecheck:test) sieht bei "obsidian" weiterhin das
// echte npm-Paket ohne `MockFn`/steuerbare `requestUrl`. Direkter Importpfad auf dieselbe
// Moduldatei, die die Alias-Umleitung ohnehin laedt (`tests/__mocks__/obsidian.ts` re-exportiert
// sie unveraendert) — gleiche Modulinstanz, echt typisiert.
import { requestUrl } from "./vendor/kit/obsidian-mock";
import LingoTunerPlugin from "../src/main";
import { loadSettings } from "../src/core/settings";
import "../src/i18n/strings";

// Review-Fund I4 (Fix-Runde 3): der Cache-/Pending-Pfad in resolveEndpoint() — Ersatz fuer das
// in Fix-Runde 1 entfernte EndpointResolver — war nur noch durch den GUI-Smoke gedeckt. Diese
// Datei prueft ihn isoliert: cachedLocal-Treffer (kein zweiter Ping), invalidateEndpointCache()
// (erzwingt einen neuen), und pendingResolve (zwei gleichzeitige Aufrufe teilen EINEN Durchlauf).
//
// probeEndpoint() (src/obsidian/http.ts) ruft requestUrl() — der Obsidian-Mock exportiert ihn
// als steuerbaren Spy (MockFn), kein vi.mock() noetig. withTimeout() (vendor/kit/timeout.ts)
// braucht ein `window` mit setTimeout/clearTimeout — im node-Environment nicht vorhanden,
// deshalb je Test gestubbt (Muster aus tests/http.test.ts).

const okResponse = { status: 200, headers: {}, text: JSON.stringify({ data: [] }), json: { data: [] }, arrayBuffer: new ArrayBuffer(0) };

function makeApp(): App {
  return { plugins: { plugins: {} } } as unknown as App;
}

function makePlugin(endpoints: { url: string }[]): LingoTunerPlugin {
  const plugin = new LingoTunerPlugin(makeApp(), {} as unknown as PluginManifest);
  plugin.settings = loadSettings({ endpoints });
  return plugin;
}

describe("LingoTunerPlugin.resolveEndpoint — lokaler Cache (Ersatz fuer EndpointResolver)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
    requestUrl.mockClear();
    requestUrl.mockImplementation(() => Promise.resolve(okResponse));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cacht den lokalen Endpunkt: der zweite Aufruf pingt NICHT erneut", async () => {
    const plugin = makePlugin([{ url: "http://l" }]);
    const first = await plugin.resolveEndpoint();
    expect(first).toEqual({ url: "http://l" });
    const rufeNachErstemLauf = requestUrl.mock.calls.length;
    expect(rufeNachErstemLauf).toBeGreaterThan(0);

    const second = await plugin.resolveEndpoint();
    expect(second).toEqual({ url: "http://l" });
    expect(requestUrl.mock.calls.length).toBe(rufeNachErstemLauf);
  });

  it("invalidateEndpointCache() erzwingt beim naechsten Aufruf einen neuen Ping", async () => {
    const plugin = makePlugin([{ url: "http://l" }]);
    await plugin.resolveEndpoint();
    const vorInvalidate = requestUrl.mock.calls.length;

    plugin.invalidateEndpointCache();
    const second = await plugin.resolveEndpoint();
    expect(second).toEqual({ url: "http://l" });
    expect(requestUrl.mock.calls.length).toBeGreaterThan(vorInvalidate);
  });

  it("zwei gleichzeitige Aufrufe teilen sich EINEN Durchlauf (pendingResolve)", async () => {
    let freigeben: ((v: typeof okResponse) => void) | undefined;
    const haengt = new Promise<typeof okResponse>((resolve) => { freigeben = resolve; });
    requestUrl.mockImplementation(() => haengt);
    const plugin = makePlugin([{ url: "http://l" }]);

    const p1 = plugin.resolveEndpoint();
    const p2 = plugin.resolveEndpoint();
    // Beide Aufrufe haengen noch — solange keiner aufgeloest ist, darf nur EIN Ping laufen.
    expect(requestUrl.mock.calls.length).toBe(1);

    freigeben?.(okResponse);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ url: "http://l" });
    expect(r2).toEqual({ url: "http://l" });
    expect(requestUrl.mock.calls.length).toBe(1);
  });

  it("null, wenn kein lokaler Endpunkt antwortet", async () => {
    requestUrl.mockImplementation(() => Promise.resolve({ ...okResponse, status: 500, text: "" }));
    const plugin = makePlugin([{ url: "http://l" }]);
    expect(await plugin.resolveEndpoint()).toBeNull();
  });
});
