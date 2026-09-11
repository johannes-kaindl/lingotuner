/**
 * Die VERDRAHTUNG zwischen Stream und Kit-Bereich (`buildStreamArea` + `createStableWriter`).
 *
 * Seit 2026-09-11 baut dieses Plugin den Antwortbereich nicht mehr selbst; was frueher hier
 * Code war, ist jetzt eine Zuweisung von Callbacks. Genau die kann still falsch sein: ein
 * Token, das in eine abgehaengte Area laeuft, ein Tail, der nicht mehr am Ende steht, ein
 * Gedanke, der nicht ankommt — alles ohne Fehlermeldung, sichtbar erst im Stream.
 *
 * Gemessen wird deshalb WAEHREND des Laufs (im `run`-Callback der Deps), nicht danach: nach
 * dem Schluss-Draw steht das Ergebnis ohnehin als fertiger Block da, und der Test waere auch
 * dann gruen, wenn die Stream-Haelfte nichts getan haette.
 */
import { describe, it, expect } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { LingoTunerView, type RunRequest, type ViewDeps } from "../src/obsidian/view";
import { NEUTRAL, BUILTIN_PRESETS, type Dials } from "../src/core/dials";
import "../src/i18n/strings";

type El = { className: string; children: El[]; textContent?: string; open?: boolean };

interface Messung {
  bloecke: number;
  blockText: string;
  tail: string;
  tailZuletzt: boolean;
  gedanke: string;
}

function baue(lauf: (req: RunRequest, root: unknown) => void): { view: LingoTunerView; root: ReturnType<typeof makeFakeEl>; messung: Messung | null } {
  const halter: { root: ReturnType<typeof makeFakeEl> | null; messung: Messung | null } = { root: null, messung: null };
  const dials: Dials = { ...NEUTRAL };
  const deps: ViewDeps = {
    readiness: () => ({ kind: "ready", text: "Hallo", chars: 5, name: "Mail" }),
    canReplace: () => true,
    presets: () => [...BUILTIN_PRESETS],
    getDials: () => dials,
    setDials: () => { /* egal */ },
    listModels: () => Promise.resolve([]),
    getModel: () => "",
    setModel: () => { /* egal */ },
    getSuppress: () => false,
    setSuppress: () => { /* egal */ },
    savePreset: () => { /* egal */ },
    run: (req) => {
      lauf(req, halter.root);
      halter.messung = messe(halter.root);
      return Promise.resolve({ ok: true, text: "Erster Absatz.\n\nLaufender", reasoning: "", model: "m", truncated: false });
    },
    output: () => Promise.resolve(),
    activeElement: () => null,
    confirm: () => Promise.resolve(true),
  };
  const view = new LingoTunerView({ app: {} } as never, deps);
  const root = makeFakeEl();
  halter.root = root;
  (view as unknown as { contentEl: unknown }).contentEl = root;
  void view.onOpen();
  return { view, root, get messung(): Messung | null { return halter.messung; } };
}

function messe(root: unknown): Messung {
  const body = findByClass<El>(root, "okit-stream-body");
  const kinder = body?.children ?? [];
  const letztes = kinder[kinder.length - 1];
  const bloecke = findAllByClass<El>(root, "okit-stream-block");
  return {
    bloecke: bloecke.length,
    blockText: bloecke[0]?.textContent ?? "",
    tail: findByClass<El>(root, "okit-stream-tail")?.textContent ?? "",
    tailZuletzt: (letztes?.className ?? "").split(" ").includes("okit-stream-tail"),
    gedanke: findByClass<El>(root, "okit-stream-reasoning")?.textContent ?? "",
  };
}

describe("Stream in den Kit-Bereich", () => {
  it("rendert fertige Absaetze als Bloecke und haelt den laufenden Absatz am Ende des Bodys", async () => {
    const a = baue((req) => { req.onToken("Erster Absatz.\n\nLaufender"); });
    (a.view as unknown as { note: string }).note = "duzen";
    await (a.view as unknown as { run(b: number | null): Promise<void> }).run(null);

    const m = a.messung;
    expect(m).not.toBeNull();
    expect(m?.bloecke).toBe(1);
    expect(m?.blockText).toContain("Erster Absatz.");
    expect(m?.tail).toBe("Laufender");
    // Der laufende Absatz gehoert IMMER ans Ende — sonst schoebe sich der naechste fertige
    // Block dahinter und der Text staende in falscher Reihenfolge.
    expect(m?.tailZuletzt).toBe(true);
  });

  it("Gedanken landen im Block, und er steht beim neuen Lauf offen", async () => {
    const a = baue((req) => { req.onReasoning("denkt nach"); req.onToken("Text.\n\n"); });
    (a.view as unknown as { note: string }).note = "duzen";
    await (a.view as unknown as { run(b: number | null): Promise<void> }).run(null);

    expect(a.messung?.gedanke).toContain("denkt nach");
    // Nach dem Schluss-Draw steht der Gedanke weiterhin da (Kit `setReasoning` aus dem Modell).
    expect(findByClass<El>(a.root, "okit-stream-reasoning")?.textContent).toContain("denkt nach");
    expect(findByClass<El>(a.root, "okit-stream-reasoning")?.open).toBe(true);
  });
});
