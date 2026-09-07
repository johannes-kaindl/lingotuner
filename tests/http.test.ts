import { describe, it, expect, vi, afterEach } from "vitest";
import { xhrTransport } from "../src/obsidian/http";
import { installFakeXHR } from "./fake_xhr";

const init = { method: "POST" as const, headers: { "X-A": "1" }, body: "{}" };

describe("xhrTransport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("akkumuliert content, trennt <think>, liefert finishReason", async () => {
    const xhr = installFakeXHR();
    const got: string[] = [];
    const p = xhrTransport.stream("u", init, (t) => got.push(t), () => {});
    xhr.feed([
      'data: {"model":"m1","choices":[{"delta":{"content":"<think>weil</think>Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await p;
    expect(r).toEqual({ content: "Hallo", reasoning: "weil", model: "m1", finishReason: "length" });
    expect(got.join("")).toBe("Hallo");
    expect(xhr.headers["X-A"]).toBe("1");
  });

  it("HTTP-Fehler traegt Status und Body", async () => {
    const xhr = installFakeXHR();
    const p = xhrTransport.stream("u", init, () => {}, () => {});
    xhr.feed(['{"detail":"nope"}'], 401);
    await expect(p).rejects.toMatchObject({ status: 401, body: '{"detail":"nope"}' });
  });

  it("bereits abgebrochenes Signal: kein send, sofort AbortError", async () => {
    const xhr = installFakeXHR();
    const ctrl = new AbortController();
    ctrl.abort();
    const p = xhrTransport.stream("u", init, () => {}, () => {}, ctrl.signal);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr.body).toBe("");
  });

  it("Abbruch ueber das Signal wird zum AbortError", async () => {
    const xhr = installFakeXHR();
    const ctrl = new AbortController();
    const p = xhrTransport.stream("u", init, () => {}, () => {}, ctrl.signal);
    xhr.progress(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n']);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
