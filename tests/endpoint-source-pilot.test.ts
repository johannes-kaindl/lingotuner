import { describe, it, expect, vi } from "vitest";
import { loadSettings } from "../src/core/settings";
import { resolveEndpointSource } from "../src/vendor/kit/endpoint-source";

describe("Pilot lingotuner", () => {
  it("Settings tragen choice (Default leer) und behalten die lokale Liste", () => {
    const s = loadSettings({ endpoints: [{ url: "http://l" }], choice: { endpointId: "a", model: "m" } });
    expect(s.choice).toEqual({ endpointId: "a", model: "m" });
    expect(loadSettings({}).choice).toEqual({});
    expect(s.endpoints).toEqual([{ url: "http://l" }]);
  });
  it("ohne Manager läuft die lokale Liste mit dem lokalen Modell", async () => {
    const r = await resolveEndpointSource({ manager: null, local: [{ url: "http://l" }], localModel: "lm", capability: "chat", caller: "lingotuner" }, () => Promise.resolve(true));
    expect(r).toEqual({
      kind: "local", config: { url: "http://l" }, model: "lm", sentModel: "lm",
      family: null, familySource: "none", backend: "unknown", backendSource: "none",
    });
  });
});
