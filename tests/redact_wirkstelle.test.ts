import { describe, it, expect } from "vitest";
import { redactExchange } from "../src/vendor/kit-obsidian/chat-client";
import { createPiiRedactor } from "../src/vendor/kit/redact";

/** Sicherheitsfix code-kit 0.79.1 (Geheimnis hinter Wortzeichen) und 0.82.0 (IBAN hinter `_`). Wirkstelle ist `redactExchange`, das `main.ts` vor der
 *  Lab-Aufzeichnung fährt: ein an ein Wort geklebtes Geheimnis stand mit dem alten Stand (code-kit 0.75.0) im Klartext im Lab-Log. */
describe("redact an der Wirkstelle (code-kit 0.87.0)", () => {
  const KEY = "sk-proj-abcdefghijklmnop1234";

  it("schwärzt key_sk-proj-… in Nachrichten, Antwort und Denkspur", () => {
    const r = redactExchange({
      messages: [{ role: "user", content: `Kürzen: key_${KEY}` }],
      answer: `Gekürzt: key_${KEY}`,
      reasoning: `Der Schlüssel key_${KEY} steht im Text`,
    });
    const all = JSON.stringify(r);
    expect(all).not.toContain(KEY);
    expect(r.count).toBeGreaterThanOrEqual(1);
  });

  it("liest eine IBAN hinter `_` als IBAN (iban_DE89…)", () => {
    const out = createPiiRedactor().text("Konto iban_DE89370400440532013000 bitte");
    expect(out).toContain("[IBAN_1]");
    expect(out).not.toContain("DE89");
  });
});
