import { describe, it, expect } from "vitest";
import { readLabApi } from "../src/obsidian/lab";

/** Das Lab ist optional und wird bei JEDEM Aufruf frisch aus dem Plugin-Register gelesen —
 *  geprueft wird deshalb genau die Lese-Logik, nicht ein Zustand. */
const withLab = (api: unknown): unknown => ({ plugins: { plugins: { "llm-lab": { api } } } });

describe("readLabApi", () => {
  it("ohne Lab-Plugin: null", () => {
    expect(readLabApi({})).toBeNull();
  });

  it("mit passender apiVersion und vollstaendiger API: die API", () => {
    const app = withLab({ apiVersion: 4, status: () => ({}), log: () => "id" });
    expect(readLabApi(app)).not.toBeNull();
  });

  it("apiVersion 3 (llm-lab liefert seit 4): null — sonst bliebe die Aufzeichnung still aus", () => {
    const app = withLab({ apiVersion: 3, status: () => ({}), log: () => "id" });
    expect(readLabApi(app)).toBeNull();
  });

  it("falsche apiVersion: null — eine aeltere Fassung wird nicht halb benutzt", () => {
    const app = withLab({ apiVersion: 2, status: () => ({}), log: () => "id" });
    expect(readLabApi(app)).toBeNull();
  });
});
