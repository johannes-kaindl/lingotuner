import { describe, it, expect } from "vitest";
import { toTuneResult } from "../src/core/llm/client";
import type { SseTransport } from "../src/vendor/kit-obsidian/chat-client";
import { DONE, delta, makeConnection } from "./helpers/connection";

// Die Verbindung schwaerzt Geheimnisse vor dem Senden, umkehrbar: das Modell sieht Platzhalter, lingotuner
// bekommt die Originale zurueck. Gemessen am Transport (dem, was auf den Draht geht).
const TOKEN = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";

/** Ein Transport, der den Body aufzeichnet und den Platzhalter seiner Eingabe in die Antwort spiegelt. */
function spiegel(seen: { sent: string }): SseTransport {
  return {
    postStream: (_u, body, _h, onChunk) => {
      const messages = (body as { messages: { content: string }[] }).messages;
      seen.sent = messages.map((m) => m.content).join("\n");
      const placeholder = /\[redacted-[a-z0-9-]+-\d+\]/.exec(seen.sent)?.[0] ?? "(kein Platzhalter)";
      onChunk(delta(`Das Modell sah: ${placeholder}`));
      onChunk(DONE);
      return Promise.resolve(200);
    },
  };
}

describe("Schwaerzung vor dem Senden", () => {
  it.each([["Bearer-Token", `Header: ${TOKEN}`, "abcdefghijklmnopqrstuvwxyz0123456789"], ["PEM-Block", `Schluessel:\n${PEM}`, "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"]])("%s geht als Platzhalter an den Transport und kommt im Ergebnis im Original zurueck", async (_n, text, geheim) => {
    const seen = { sent: "" };
    const llm = makeConnection({ transport: spiegel(seen) });
    const r = await llm.complete({ messages: [{ role: "user", content: text }] });
    expect(seen.sent).not.toContain(geheim);
    expect(seen.sent).toMatch(/\[redacted-[a-z0-9-]+-\d+\]/);
    const tuned = toTuneResult(r);
    expect(tuned.ok).toBe(true);
    if (tuned.ok) {
      expect(tuned.text).toContain(geheim);
      expect(tuned.text).not.toMatch(/\[redacted-/);
    }
  });
});
