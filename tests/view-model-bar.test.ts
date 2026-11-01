/**
 * Die Modellzeile (Kit `model-bar`) im Panel: der Eigenbau (Dropdown, Neu laden, Denk-Host in der Lauf-Zeile) ist weg, die Zeile
 * haengt im Voll-Draw an `lt-model-row` und wird sonst nur per `update()` nachgezogen. Das Fake-DOM sieht keine CSS-Kaskade: was
 * eine verbergende Klasse braucht, belegt der Smoke am echten Fenster.
 */
import { describe, it, expect } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";
import { findAllByClass, findByClass } from "./helpers/dom";
import { mkLlm, mkThinking } from "./helpers/llm";
import { LingoTunerView, type ViewDeps } from "../src/obsidian/view";
import { NEUTRAL, BUILTIN_PRESETS, type Dials } from "../src/core/dials";
import "../src/i18n/strings";

type El = { className: string; children: El[]; textContent?: string; disabled?: boolean; value?: string; click?(): void; getAttribute?(k: string): string | null; _listeners: Record<string, Array<(e?: unknown) => void>> };

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Aufbau {
  view: LingoTunerView;
  root: ReturnType<typeof makeFakeEl>;
  llm: ReturnType<typeof mkLlm>;
  denk: ReturnType<typeof mkThinking>;
  setzeFokus(el: unknown): void;
  gesendet: ViewDeps["run"] extends (r: infer R) => unknown ? R[] : never;
}

function baue(over: Partial<ViewDeps> = {}, llmInit: Parameters<typeof mkLlm>[0] = { models: ["qwen-a", "qwen-b"], model: "qwen-a" }, denkInit: Parameters<typeof mkThinking>[0] = {}): Aufbau {
  const llm = mkLlm(llmInit);
  const denk = mkThinking(denkInit);
  const dials: Dials = { ...NEUTRAL };
  const fokus: { el: unknown } = { el: null };
  const gesendet: Aufbau["gesendet"] = [];
  const deps: ViewDeps = {
    readiness: () => ({ kind: "ready", text: "Hallo", chars: 5, name: "Mail" }),
    canReplace: () => true,
    presets: () => [...BUILTIN_PRESETS],
    getDials: () => dials,
    setDials: () => { /* egal */ },
    domGuard: false,
    llm,
    thinking: denk.thinking,
    savePreset: () => { /* egal */ },
    run: (req) => { gesendet.push(req); return Promise.resolve({ ok: true, text: "x", reasoning: "", model: "m", truncated: false }); },
    output: () => Promise.resolve(),
    activeElement: () => fokus.el as Element | null,
    confirm: () => Promise.resolve(true),
    ...over,
  };
  const view = new LingoTunerView({ app: {} } as never, deps);
  const root = makeFakeEl();
  root.contains = (el: unknown): boolean => {
    const suche = (n: { children?: unknown[] } | null): boolean => {
      if (n === null || n === undefined) return false;
      if (n === el) return true;
      for (const c of (n.children ?? []) as Array<{ children?: unknown[] }>) if (suche(c)) return true;
      return false;
    };
    return suche(root);
  };
  (view as unknown as { contentEl: unknown }).contentEl = root;
  void view.onOpen();
  return { view, root, llm, denk, setzeFokus: (el) => { fokus.el = el; }, gesendet };
}

const optionTexte = (sel: El): string[] => (sel.children ?? []).map((o) => o.textContent ?? "");

describe("Modellzeile im Panel (Kit model-bar)", () => {
  it("genau eine Zeile in der Modellzeile, mit den Modellen des Endpunkts und \"Automatisch\"; der Eigenbau ist weg", async () => {
    const a = baue({}, { models: ["qwen-a", "qwen-b"], model: "qwen-b", defaultModel: "qwen-a" });
    await tick();
    expect(findAllByClass(a.root, "okit-model-bar")).toHaveLength(1);
    const row = findByClass<El>(a.root, "lt-model-row");
    expect(findAllByClass(row, "okit-model-bar")).toHaveLength(1);
    const sel = findByClass<El>(a.root, "okit-model-bar-select");
    if (sel === null) throw new Error("kein Dropdown");
    expect(optionTexte(sel)).toEqual(expect.arrayContaining(["Automatic (qwen-a)", "qwen-a", "qwen-b"]));
    expect(sel.value).toBe("qwen-b");
    expect(findByClass(a.root, "lt-model")).toBeNull();
    expect(findByClass(a.root, "lt-model-refresh")).toBeNull();
    expect(findByClass(a.root, "lt-think")).toBeNull();
  });

  it("Wahl im Dropdown ruft llm.setModel — und zeichnet das Panel NICHT neu (kein Voll-Draw, Fokus der Textarea bleibt)", async () => {
    const a = baue();
    await tick();
    const lauf = findByClass<El & { marke?: number }>(a.root, "lt-run");
    if (lauf === null) throw new Error("Vorbedingung fehlt");
    lauf.marke = 1;
    const sel = findByClass<El>(a.root, "okit-model-bar-select");
    if (sel === null) throw new Error("kein Dropdown");
    sel.value = "qwen-b";
    (sel._listeners["change"] ?? []).forEach((cb) => cb());
    await tick();
    expect(a.llm.setModel).toHaveBeenCalledWith("qwen-b");
    expect(findByClass<El & { marke?: number }>(a.root, "lt-run")?.marke).toBe(1);   // dasselbe Objekt: kein Neuaufbau
  });

  it("ein Modellwechsel ausserhalb der Zeile (Einstellungen) wirkt nach refresh() nur auf die Zeile, ohne Voll-Draw", async () => {
    const a = baue();
    await tick();
    const lauf = findByClass<El & { marke?: number }>(a.root, "lt-run");
    if (lauf === null) throw new Error("Vorbedingung fehlt");
    lauf.marke = 1;
    a.llm.st.model = "qwen-b";
    a.view.refresh();
    expect(findByClass<El>(a.root, "okit-model-bar-select")?.value).toBe("qwen-b");
    expect(findByClass<El & { marke?: number }>(a.root, "lt-run")?.marke).toBe(1);
  });

  it("ein gewaehltes, nicht mehr geladenes Modell bleibt gewaehlt und steht als gespeichert da", async () => {
    const a = baue({}, { models: ["qwen-a"], model: "alt-weg" });
    await tick();
    const sel = findByClass<El>(a.root, "okit-model-bar-select");
    if (sel === null) throw new Error("kein Dropdown");
    expect(sel.value).toBe("alt-weg");
    expect(optionTexte(sel).some((x) => x.includes("alt-weg") && x.includes("saved"))).toBe(true);
    expect(a.llm.setModel).not.toHaveBeenCalled();
  });

  it("die Liste ist nicht mehr alphabetisch umsortiert, sondern so, wie der Endpunkt sie liefert", async () => {
    const a = baue({}, { models: ["zeta", "alpha", "mu"], model: "" });
    await tick();
    const sel = findByClass<El>(a.root, "okit-model-bar-select");
    if (sel === null) throw new Error("kein Dropdown");
    const modelle = optionTexte(sel).filter((x) => ["zeta", "alpha", "mu"].includes(x));
    expect(modelle).toEqual(["zeta", "alpha", "mu"]);
  });

  it("die Zeile ist waehrend eines Laufs gesperrt (Dropdown und Neu laden) und danach wieder frei", async () => {
    let waehrend: { dd: boolean; neu: boolean } | null = null;
    let root: ReturnType<typeof makeFakeEl> | null = null;
    const a = baue({
      getDials: () => ({ ...NEUTRAL, social: 2 }),   // nicht „Noop“: sonst ist Tunen aus
      run: () => {
        waehrend = { dd: findByClass<El>(root, "okit-model-bar-select")?.disabled === true, neu: findByClass<El>(root, "okit-model-bar-refresh")?.disabled === true };
        return Promise.resolve({ ok: true, text: "x", reasoning: "", model: "m", truncated: false });
      },
    });
    root = a.root;
    await tick();
    expect(findByClass<El>(a.root, "okit-model-bar-select")?.disabled).toBe(false);
    findByClass<El>(a.root, "lt-run")?.click?.();
    await tick(); await tick();
    expect(waehrend).toEqual({ dd: true, neu: true });
    expect(findByClass<El>(a.root, "okit-model-bar-select")?.disabled).toBe(false);
    expect(findByClass<El>(a.root, "okit-model-bar-refresh")?.disabled).toBe(false);
  });

  it("jeder Voll-Draw meldet die alte Zeile ab: ein spaetes models()-Ergebnis zeichnet in die alte nichts mehr", async () => {
    const offen: Array<(r: { models: string[]; reachable: boolean }) => void> = [];
    const a = baue();
    await tick();
    const alt = findByClass<El>(a.root, "okit-model-bar-select");
    if (alt === null) throw new Error("kein Dropdown");
    const vorher = optionTexte(alt);
    a.llm.models.mockImplementation(() => new Promise((r) => { offen.push(r); }));
    findByClass<El>(a.root, "okit-model-bar-refresh")?.click?.();   // Anfrage laeuft, Antwort steht aus
    // Voll-Draw (Quellenwechsel): die Zeile wird neu gebaut, die alte muss abgemeldet sein
    const chip = findAllByClass<El>(a.root, "lt-source-chip")[1];
    chip.click?.();
    for (const f of offen) f({ models: ["spaet-1", "spaet-2"], reachable: true });   // ALLE offenen Anfragen, auch die der alten Zeile
    await tick();
    expect(optionTexte(alt)).toEqual(vorher);
    expect(findAllByClass(a.root, "okit-model-bar")).toHaveLength(1);
  });

  it("onClose meldet die Zeile ab", async () => {
    const a = baue();
    await tick();
    const sel = findByClass<El>(a.root, "okit-model-bar-select");
    if (sel === null) throw new Error("kein Dropdown");
    const vorher = optionTexte(sel);
    let fertig: (r: { models: string[]; reachable: boolean }) => void = () => {};
    a.llm.models.mockImplementation(() => new Promise((r) => { fertig = r; }));
    findByClass<El>(a.root, "okit-model-bar-refresh")?.click?.();
    await a.view.onClose();
    fertig({ models: ["spaet"], reachable: true });
    await tick();
    expect(optionTexte(sel)).toEqual(vorher);
  });

  it("reloadModels() (Endpunkt hat gewechselt) laedt die Liste der Zeile neu", async () => {
    const a = baue();
    await tick();
    a.llm.models.mockClear();
    a.view.reloadModels();
    await tick();
    expect(a.llm.models).toHaveBeenCalledTimes(1);
  });

  it("ein Wurf aus setModel ist nicht still: die Statuszeile des Panels nennt ihn", async () => {
    const a = baue();
    a.llm.setModel.mockImplementation(() => Promise.reject(new Error("boom")));
    await tick();
    const sel = findByClass<El>(a.root, "okit-model-bar-select");
    if (sel === null) throw new Error("kein Dropdown");
    sel.value = "qwen-b";
    (sel._listeners["change"] ?? []).forEach((cb) => cb());
    await tick(); await tick();
    expect(findByClass<El>(a.root, "lt-status-label")?.textContent).toContain("boom");
  });
});

describe("Denk-Steuerung in der Modellzeile", () => {
  // Seit Kit 0.73.0 ist die Denk-Steuerung IN der Modellzeile immer ein Dropdown mit den Stufen des Modells (kein Knopf mehr). Das Fake-DOM kennt keine
  // Tag-Selektoren: das <select> ist das Kind der Steuerung, das eine Komponente traegt (`__component`).
  type Dd = El & { __component?: { getValue(): string; options: Record<string, string>; onChangeCB: ((v: string) => unknown) | null } };
  const stufenWahl = (root: El): Dd => {
    const ctl = findByClass<El>(root, "okit-thinking-control");
    const dd = (ctl?.children ?? []).find((c) => (c as Dd).__component !== undefined) as Dd | undefined;
    if (dd === undefined) throw new Error("kein Denk-Dropdown in der Steuerung");
    return dd;
  };

  it("steht IN der Zeile als Dropdown; ein Neuaufbau des Panels laesst genau eine Steuerung zurueck", async () => {
    const a = baue({}, undefined, { family: "qwen3.8" });
    await tick();
    const bar = findByClass<El>(a.root, "okit-model-bar");
    expect(findAllByClass(bar, "okit-thinking-control")).toHaveLength(1);
    expect(findAllByClass(a.root, "okit-thinking-control")).toHaveLength(1);
    expect(findAllByClass(a.root, "okit-thinking-toggle")).toHaveLength(0);
    findAllByClass<El>(a.root, "lt-source-chip")[1].click?.();
    await tick();
    expect(findAllByClass(a.root, "okit-thinking-control")).toHaveLength(1);
  });

  it("zeigt die gespeicherte Stufe und nennt sie im Namen (Wert und aria-label des Dropdowns)", async () => {
    const aus = baue({}, undefined, { family: "qwen3.8", level: "off" });
    await tick();
    expect(stufenWahl(aus.root).__component?.getValue()).toBe("off");
    expect(stufenWahl(aus.root).getAttribute?.("aria-label")).toContain("Thinking level: off");
    const an = baue({}, undefined, { family: "qwen3.8", level: "low" });
    await tick();
    expect(stufenWahl(an.root).__component?.getValue()).toBe("low");
    expect(stufenWahl(an.root).getAttribute?.("aria-label")).toContain("Thinking level: low");
  });

  it("gpt-oss kann Denken nicht ganz abschalten — das Dropdown zeigt die niedrigste Stufe, gespeichert wird nichts", async () => {
    const a = baue({}, undefined, { family: "gpt-oss", level: "off" });
    await tick();
    const dd = stufenWahl(a.root);
    expect(dd.__component?.getValue()).toBe("low");
    expect(Object.keys(dd.__component?.options ?? {})).not.toContain("off");
    expect(a.denk.st.level).toBe("off");
  });

  it("eine Wahl im Dropdown schaltet ueber deps.thinking.setLevel, ohne das Panel neu zu zeichnen", async () => {
    const a = baue({}, undefined, { family: "qwen3.8", level: "off" });
    await tick();
    const lauf = findByClass<El & { marke?: number }>(a.root, "lt-run");
    if (lauf === null) throw new Error("Vorbedingung fehlt");
    lauf.marke = 1;
    await stufenWahl(a.root).__component?.onChangeCB?.("medium");
    await tick(); await tick();
    expect(a.denk.st.level).toBe("medium");
    expect(findByClass<El & { marke?: number }>(a.root, "lt-run")?.marke).toBe(1);
  });
});
