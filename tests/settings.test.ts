import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, loadRequestSettings, allPresets, upsertUserPreset, removeUserPreset } from "../src/core/settings";
import { NEUTRAL } from "../src/core/dials";

describe("settings", () => {
  it("Defaults: lokaler Endpunkt, Denken aus (Modus transform), Logbuch aus, neutrale Regler", () => {
    expect(DEFAULT_SETTINGS.endpoints).toEqual([{ url: "http://127.0.0.1:1234" }]);
    expect(DEFAULT_SETTINGS.request).toEqual({ overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false });
    expect(DEFAULT_SETTINGS.logbookEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.lastDials).toEqual(NEUTRAL);
  });

  it("loadRequestSettings migriert suppressThinking einmalig nach request.thinking.transform, Feld ist danach weg", () => {
    const a = loadRequestSettings({ suppressThinking: true });
    expect(a.request.thinking.transform).toBe("off");
    const b = loadRequestSettings({ suppressThinking: false });
    expect(b.request.thinking.transform).toBe("low");
    // Ist request.thinking.transform schon explizit gesetzt, migriert die Legacy nicht mehr drueber.
    const c = loadRequestSettings({ suppressThinking: true, request: { thinking: { transform: "high" } } });
    expect(c.request.thinking.transform).toBe("high");
    expect(loadSettings({ suppressThinking: true }) as unknown as { suppressThinking?: unknown }).not.toHaveProperty("suppressThinking");
  });

  it("loadSettings migriert string[]-Endpunkte, normalisiert Regler und Presets, behaelt Unbekanntes", () => {
    const s = loadSettings({
      endpoints: ["http://a:1"],
      lastDials: { directness: 5, foo: 1 },
      userPresets: [{ name: " Chef ", dials: { social: -9 } }, { name: "", dials: {} }, "kaputt"],
      timeoutSec: 1,
      fremd: true,
    });
    expect(s.endpoints).toEqual([{ url: "http://a:1" }]);
    expect(s.lastDials).toEqual({ ...NEUTRAL, directness: 2 });
    expect(s.userPresets).toEqual([{ name: "Chef", dials: { ...NEUTRAL, social: -2 } }]);
    // timeoutSec entfaellt (Fristen der Verbindung sind statisch): der Altschluessel wird geladen, aber nicht behalten.
    expect(s).not.toHaveProperty("timeoutSec");
    expect((s as unknown as { fremd: boolean }).fremd).toBe(true);
  });

  it("allPresets: vier ausgelieferte, dann Nutzer-Presets mit Label und user-Id", () => {
    const p = allPresets({ userPresets: [{ name: "Mail an Chef", dials: NEUTRAL }] });
    expect(p.map((x) => x.id)).toEqual(["neutral", "clarity", "collegial", "polite", "user-mail-an-chef"]);
    expect(p[4].label).toBe("Mail an Chef");
  });

  it("upsertUserPreset ersetzt gleichnamige (gross-klein-tolerant) und meldet das", () => {
    const a = upsertUserPreset([], "Chef", { ...NEUTRAL, social: 1 });
    expect(a).toEqual({ list: [{ name: "Chef", dials: { ...NEUTRAL, social: 1 } }], replaced: false });
    const b = upsertUserPreset(a.list, "chef", NEUTRAL);
    expect(b.replaced).toBe(true);
    expect(b.list).toEqual([{ name: "chef", dials: NEUTRAL }]);
    expect(removeUserPreset(b.list, "CHEF")).toEqual([]);
  });
});

describe("loadSettings — globales Modell abgeloest (Welle 17)", () => {
  const row = (extra: object = {}) => ({ url: "http://127.0.0.1:1234", ...extra });

  it("erster Lauf: Altwert wandert in die Zeilen ohne Modell, der Altschluessel verschwindet", () => {
    const out = loadSettings({ endpoints: [row(), row({ url: "http://b:1" })], model: "alt-modell" });
    expect(out.endpoints.map((e) => e.model)).toEqual(["alt-modell", "alt-modell"]);
    expect("model" in out).toBe(false);
  });

  it("zweiter Lauf aendert nichts: eine vom Nutzer geleerte Zeile bleibt leer", () => {
    const first = loadSettings({ endpoints: [row()], model: "alt-modell" });
    first.endpoints[0] = { ...first.endpoints[0]!, model: "" };
    const second = loadSettings(JSON.parse(JSON.stringify(first)));
    expect(second.endpoints[0]!.model ?? "").toBe("");
    expect("model" in second).toBe(false);
  });

  it("eine Zeile mit eigenem Modell bleibt unveraendert", () => {
    const out = loadSettings({ endpoints: [row({ model: "eigen" }), row({ url: "http://b:1" })], model: "alt-modell" });
    expect(out.endpoints.map((e) => e.model)).toEqual(["eigen", "alt-modell"]);
  });

  it("ohne Altwert bleiben die Zeilen unberuehrt", () => {
    expect(loadSettings({ endpoints: [row()] }).endpoints).toEqual([row()]);
  });

  it("Default-Einstellungen tragen kein globales Modell mehr", () => {
    expect("model" in DEFAULT_SETTINGS).toBe(false);
  });
});
