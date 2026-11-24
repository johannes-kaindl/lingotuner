/**
 * Lauf-Wächter der Ansicht (Kit `createRunSlot`, ersetzt das eigene `controller !== ctrl`): ein zweiter Lauf bricht den ersten ab,
 * ein veralteter Lauf schreibt weder Token noch Ergebnis, und das Schliessen der Ansicht bricht einen laufenden ab.
 */
import { describe, it, expect } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { LingoTunerView, type RunRequest, type ViewDeps } from "../src/obsidian/view";
import { NEUTRAL, BUILTIN_PRESETS } from "../src/core/dials";
import type { TuneResult } from "../src/core/llm/client";
import "../src/i18n/strings";
import { mkLlm, mkThinking } from "./helpers/llm";

interface Offen { req: RunRequest; fertig: (r: TuneResult) => void }

function baue(): { view: LingoTunerView; laeufe: Offen[]; lauf: () => Promise<void>; stand: () => { preview: string } } {
  const laeufe: Offen[] = [];
  const deps: ViewDeps = {
    readiness: () => ({ kind: "ready", text: "Hallo", chars: 5, name: "Mail" }),
    canReplace: () => true,
    presets: () => [...BUILTIN_PRESETS],
    getDials: () => ({ ...NEUTRAL }),
    setDials: () => { /* egal */ },
    domGuard: false,
    llm: mkLlm(),
    thinking: mkThinking().thinking,
    savePreset: () => { /* egal */ },
    run: (req) => new Promise<TuneResult>((resolve) => { laeufe.push({ req, fertig: resolve }); }),
    output: () => Promise.resolve(),
    activeElement: () => null,
    confirm: () => Promise.resolve(true),
  };
  const view = new LingoTunerView({ app: {} } as never, deps);
  (view as unknown as { contentEl: unknown }).contentEl = makeFakeEl();
  (view as unknown as { note: string }).note = "duzen";
  void view.onOpen();
  const v = view as unknown as { run(b: number | null): Promise<void>; preview: string };
  return { view, laeufe, lauf: () => v.run(null), stand: () => ({ preview: v.preview }) };
}
const ok = (text: string): TuneResult => ({ ok: true, text, reasoning: "", model: "m", truncated: false });

describe("Lauf-Waechter der Ansicht", () => {
  it("ein zweiter Lauf bricht den ersten ab, dessen spaetes Ergebnis und Token gelten nicht", async () => {
    const a = baue();
    const erster = a.lauf();
    const zweiter = a.lauf();
    expect(a.laeufe).toHaveLength(2);
    expect(a.laeufe[0].req.signal.aborted).toBe(true);
    expect(a.laeufe[1].req.signal.aborted).toBe(false);
    a.laeufe[0].req.onToken("alt-token");
    expect(a.stand().preview).toBe("");
    a.laeufe[1].fertig(ok("neu"));
    await zweiter;
    a.laeufe[0].fertig(ok("alt"));
    await erster;
    expect(a.stand().preview).toBe("neu");
  });

  it("Schliessen der Ansicht bricht den laufenden Lauf ab und verwirft sein Ergebnis", async () => {
    const a = baue();
    const lauf = a.lauf();
    await a.view.onClose();
    expect(a.laeufe[0].req.signal.aborted).toBe(true);
    a.laeufe[0].fertig(ok("zu spaet"));
    await lauf;
    expect(a.stand().preview).toBe("");
  });

  it("Gegenprobe: ein ungestoerter Lauf schreibt sein Ergebnis und wird nicht abgebrochen", async () => {
    const a = baue();
    const lauf = a.lauf();
    a.laeufe[0].req.onToken("x");
    expect(a.stand().preview).toBe("x");
    a.laeufe[0].fertig(ok("fertig"));
    await lauf;
    expect(a.laeufe[0].req.signal.aborted).toBe(false);
    expect(a.stand().preview).toBe("fertig");
  });
});
