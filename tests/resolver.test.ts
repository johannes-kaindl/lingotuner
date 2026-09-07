import { describe, it, expect, vi } from "vitest";
import { EndpointResolver } from "../src/core/llm/resolver";

describe("EndpointResolver", () => {
  it("nimmt den ersten erreichbaren, cacht, invalidate loest neu auf", async () => {
    const ping = vi.fn((ep: { url: string }) => Promise.resolve(ep.url === "b"));
    const r = new EndpointResolver(() => [{ url: "a" }, { url: "b" }], ping);
    expect(await r.resolve()).toEqual({ url: "b" });
    expect(await r.resolve()).toEqual({ url: "b" });
    expect(ping).toHaveBeenCalledTimes(2);
    r.invalidate();
    await r.resolve();
    expect(ping).toHaveBeenCalledTimes(4);
  });
  it("null, wenn keiner antwortet", async () => {
    const r = new EndpointResolver(() => [{ url: "a" }], () => Promise.resolve(false));
    expect(await r.resolve()).toBeNull();
  });
});
