/** Die Ansicht ueber dem Kit-Rahmen (Welle 37): Regler in Station 3, Anmerkung als freiwilliges Auftragsfeld, Lauf ueber den Halter, Vorschau mit neutralisiertem
 *  Markdown und Kopierknopf, Schreibwege je Ziel. Der Rahmen selbst ist im Kit getestet; hier steht, was lingotuner einsetzt. */
import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import "../src/i18n/strings";
import { LingoTunerView, type LingoPanelHost, type ViewDeps } from "../src/obsidian/view";
import { acceptStrings, tuneWays } from "../src/obsidian/accept";
import { createTuneRun } from "../src/core/panel-run";
import { freshSession, type TuneSession } from "../src/core/session";
import { BUILTIN_PRESETS, NEUTRAL, levelKey, type Dials } from "../src/core/dials";
import type { TuneResult } from "../src/core/llm/client";
import { createPanelHost } from "../src/vendor/kit/panel-host";
import type { Target } from "../src/vendor/kit/panel-session";
import { t } from "../src/vendor/kit/i18n";
import { mkLlm, mkThinking } from "./helpers/llm";

type El = { className: string; children: El[]; textContent?: string; disabled?: boolean; value?: string; placeholder?: string; tagName?: string; attributes?: Record<string, string>; dispatchEvent(e: { type: string }): boolean; getAttribute?(n: string): string | null };

function build(o: { target?: Target; answer?: string; dials?: Dials } = {}) {
  let dials: Dials = o.dials ?? { ...NEUTRAL, directness: -1 };
  let source: "selection" | "note" | "text" = "text";
  const answer = o.answer ?? "Hallo **Welt** ![x](https://example.com/x.png)";
  const tune = vi.fn((c: { onToken(x: string): void }): Promise<TuneResult> => { c.onToken(answer); return Promise.resolve({ ok: true, text: answer, reasoning: "", model: "m", truncated: false }); });
  const runDeps = { dials: () => dials, sourceOf: () => Promise.resolve({ text: "Quelle", name: "Mail" }), tune };
  const core = createPanelHost<TuneSession>({ fresh: freshSession, run: createTuneRun(runDeps), model: () => "m", strings: { running: () => "läuft", aborted: "abgebrochen", noEndpoint: "kein Endpunkt" } }, freshSession(o.target ?? { kind: "new" }));
  const host = { ...core, setStatusBarVisible: () => undefined } as unknown as LingoPanelHost;
  const handlers = { onSource: vi.fn(), onDial: vi.fn((d: keyof Dials, l: number) => { dials = { ...dials, [d]: l }; }), onPreset: vi.fn(), onFreeText: vi.fn(), savePreset: vi.fn() };
  const deps: ViewDeps = {
    host,
    llm: mkLlm() as never,
    thinking: mkThinking().thinking,
    readTargetText: () => Promise.resolve(null),
    openSettings: () => undefined,
    pluginId: "lingotuner",
    accept: { app: {} as never, ports: {} as never, lastEditor: () => null, strings: acceptStrings("en"), readingMode: "refuse" },
    ways: (s) => tuneWays(s, () => host.session(), { folder: () => "", stamp: () => "LingoTuner", open: () => undefined }),
    controls: () => ({ source, readiness: source === "text" ? { kind: "ready", text: "Quelle", chars: 6, name: null } : { kind: "no-note" }, freeText: "Quelle", dials, presets: [...BUILTIN_PRESETS] }),
    ...handlers,
    runFromSource: createTuneRun(runDeps, { fromSource: true }),
  };
  const view = new LingoTunerView({ app: {} } as never, deps);
  const root = makeFakeEl();
  (view as unknown as { contentEl: unknown }).contentEl = root;
  void view.onOpen();
  return { view, root, host, tune, handlers, setSource: (k: typeof source) => { source = k; } };
}

// Der Linkschutz-Waechter (`renderMarkdownGuarded`) braucht ein echtes DOM (MutationObserver, Baumlaeufe); im Fake-DOM wirft er, und die Vorschau faellt auf den
// Rohtext als Text zurueck. Dass der Renderer den neutralisierten Text bekommt und der Waechter laeuft, misst der GUI-Smoke im echten Obsidian (Punkt P5).
const click = (el: El | null | undefined): void => { el?.dispatchEvent({ type: "click" }); };
const byText = (root: unknown, cls: string, text: string): El | undefined => findAllByClass<El>(root, cls).find((e) => e.textContent === text);

describe("Panel ueber dem Kit-Rahmen", () => {
  it("Station 3 traegt Quelle, Voreinstellungen und vier Regler; die Anmerkung ist das freiwillige Auftragsfeld", () => {
    const { root } = build();
    // Die Quelle ist der Segment-Schalter des Kits: eine Radiogruppe mit drei Stellungen, die gewaehlte traegt aria-checked.
    const sources = findByClass<El>(root, "lt-sources");
    expect(sources?.getAttribute?.("role")).toBe("radiogroup");
    expect(findAllByClass(sources, "okit-segmented-btn")).toHaveLength(3);
    expect(byText(root, "okit-segmented-btn", t("source.text"))?.getAttribute?.("aria-checked")).toBe("true");
    expect(byText(root, "okit-segmented-btn", t("source.selection"))?.getAttribute?.("aria-checked")).toBe("false");
    expect(findAllByClass(root, "lt-dial")).toHaveLength(4);
    expect(findAllByClass(root, "lt-preset-chip").length).toBe(BUILTIN_PRESETS.length);
    const input = findByClass<El>(root, "okit-prompt-panel-input");
    expect(input?.getAttribute?.("placeholder")).toBe(t("note.placeholder"));
    expect(findByClass<El>(root, "okit-prompt-panel-send")?.textContent).toBe(t("run.tune"));
  });

  // Der Rahmen nennt eine Quelle aus der Notiz eine Aenderung (`taskKind` = refine) schon vor der ersten Runde; „Refine this result“ stand dort, ohne dass es ein
  // Ergebnis gab (Pruefbilder Nachlauf Welle 37). Der Knopf heisst darum immer „Tune“: vor der ersten Runde tunt er die Quelle, danach die aktive Runde.
  it.each([
    ["Markierung", { kind: "selection", path: "a.md", from: 0, to: 6, label: "Markierung in a", text: "Quelle" }],
    ["Notiz", { kind: "file", path: "a.md", label: "a" }],
  ] as const)("Quelle %s ohne Runde: der Sendeknopf heisst Tune, nicht Refine this result", (_name, target) => {
    const { root } = build({ target: target as Target });
    expect(findByClass<El>(root, "okit-prompt-panel-send")?.textContent).toBe(t("run.tune"));
  });

  it("Senden mit leerer Anmerkung startet den Lauf (instructionOptional); das Ergebnis steht mit Kopierknopf in der Vorschau", async () => {
    const { root, view, tune } = build();
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    expect(tune).toHaveBeenCalledTimes(1);
    const result = findByClass<El>(root, "lt-result");
    expect(result).not.toBeNull();
    expect(findByClass(root, "lt-out-copy")).not.toBeNull();
  });

  it("wirft der Renderer (hier: der Waechter ohne echtes DOM), steht der Rohtext als Text da (setText, kein Markdown), nicht leer", async () => {
    const { root, view } = build();
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    expect(findByClass<El>(root, "lt-result")?.textContent).toBe("Hallo **Welt** ![x](https://example.com/x.png)");
  });

  it("Regler Mitte und Anmerkung leer: Statuszeile nennt den Grund, kein Modellaufruf", async () => {
    const { root, view, tune } = build({ dials: { ...NEUTRAL } });
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    expect(tune).not.toHaveBeenCalled();
    expect(JSON.stringify(findByClass(root, "okit-prompt-panel-status"))).toContain(t("run.noop"));
  });

  it("Reglerzug: Stufenname an Ort und Stelle, Einstellung ueber onDial, kein Neuaufbau der Zeile", () => {
    const { root, handlers } = build();
    const dial = findAllByClass<El>(root, "lt-dial-input")[1];
    const before = findAllByClass<El>(root, "lt-dial")[1];
    if (dial === undefined) throw new Error("Regler fehlt");
    dial.value = "2";
    dial.dispatchEvent({ type: "input" });
    expect(handlers.onDial).toHaveBeenCalledWith("context", 2);
    expect(findAllByClass<El>(root, "lt-dial")[1]).toBe(before);
    expect(findAllByClass<El>(root, "lt-dial-level")[1]?.textContent).toBe(t(levelKey("context", 2)));
  });

  it("mit offener Runde: refreshControls zeichnet Station 3 nach einem Quellenwechsel neu (Textfeld kommt und geht)", async () => {
    const { root, view, setSource } = build({ target: { kind: "file", path: "Mail.md", label: "Notiz Mail" } });
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    setSource("note");
    view.refreshControls();
    expect(findByClass(root, "lt-freetext")).toBeNull();
    setSource("text");
    view.refreshControls();
    expect(findByClass(root, "lt-freetext")).not.toBeNull();
  });

  it("Quell-Chip meldet die Wahl an das Plugin", () => {
    const { root, handlers } = build();
    click(byText(root, "okit-segmented-btn", t("source.note")));
    expect(handlers.onSource).toHaveBeenCalledWith("note");
  });

  it("Ziel Notiz: „Notiz ersetzen“ und „Neue Notiz“ sind nach einer Runde frei", async () => {
    const { root, view } = build({ target: { kind: "file", path: "Mail.md", label: "Notiz Mail" } });
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    expect(byText(root, "okit-prompt-panel-accept", t("out.replaceNote"))?.disabled).toBe(false);
    expect(byText(root, "okit-prompt-panel-accept", t("out.newNote"))?.disabled).toBe(false);
  });

  it("Ziel Markierung: „Markierung ersetzen“ ist nach einer Runde frei", async () => {
    const { root, view } = build({ target: { kind: "selection", path: "Mail.md", from: { line: 1, ch: 0 }, to: { line: 1, ch: 6 }, label: "Markierung in Mail", text: "Quelle" } });
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    const b = byText(root, "okit-prompt-panel-accept", t("out.replaceSelection"));
    expect(b?.disabled).toBe(false);
  });

  it("nach einer Runde: Knopf „Neu aus der Quelle“, er laeuft aus der Quelle (neue Kette)", async () => {
    const { root, view, host } = build();
    expect(findByClass(root, "lt-retune")).toBeNull();
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    click(findByClass<El>(root, "lt-retune"));
    await view.settled();
    expect(host.session().rounds.rounds.map((r) => r.basedOn)).toEqual([null, null]);
  });

  it("Gegenprobe: Senden mit Runde schaerft die aktive Runde nach (basedOn 0)", async () => {
    const { root, view, host } = build();
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    click(findByClass<El>(root, "okit-prompt-panel-send"));
    await view.settled();
    expect(host.session().rounds.rounds.map((r) => r.basedOn)).toEqual([null, 0]);
  });
});
