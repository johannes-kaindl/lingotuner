// vendored from obsidian-kit@0.53.0, src/obsidian/dom-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { MarkdownRenderer, type App, type Component } from "obsidian";
import { realClock, type ClockPort } from "./clock";
import { neutralizeRemoteResourcesInTree, type RemovedResource, type RemoteResourcesOptions } from "../kit/remote-resources";

/**
 * Zweite Schicht gegen Fernquellen in gerenderten Antworten: ein `MutationObserver` am Container, der
 * `neutralizeRemoteResourcesInTree` (code-kit `web/remote-resources`) **synchron im Callback** laufen lässt.
 *
 * ## Ein Netz, keine Grenze
 *
 * **Die Grenze für Modell-Ausgabe in einer lebenden Ansicht ist die Regex-Schicht davor** (`neutralizeModelMarkdown`,
 * der Default von `createStableWriter`): sie läuft vor dem Parser. Der Observer fängt auf, was sie nicht kennt oder
 * wo sie fehlt (`raw: true`); er ist dicht für Bild-Quellen und Dokument-Tags und undicht bei allem, was erst bei der
 * Stil-Berechnung oder der Erzeugung des Elements lädt. Wer `raw` mit `neutralizeRemoteResources` rendert, hat in
 * einer lebenden Ansicht **keine Grenze** gegen Fernquellen. Eine Grenze ist nur der inerte Weg (Durchgang auf einem
 * Baum ohne Browsing-Kontext vor dem Anhängen, slide-deck 0.15.0).
 *
 * Gemessen im echten Renderer (Obsidian 1.14.4, Zweitinstanz, sichtbares Fenster, 402 Angriffsfälle aus code-kit
 * `tests/fixtures/remote-sources.json`, Welle 16, Cockpit-Task „Fernquellen-Entschärfung DOM-basiert statt Regex“,
 * Abschnitt „Messung 2026-10-10“): mit `raw: true` ohne Wächter laden 139 Fälle, mit Wächter (code-kit 0.19.1) 65, mit
 * der Regex-Schicht allein (Standard des Writers) 0 und mit Regex-Schicht plus Wächter 0; 30 `keep`-Fälle bleiben
 * unverändert. Die 65 Reste nach Elementart: `style`-Attribut in HTML 42 von 42, SVG-Präsentationsattribute (`fill`,
 * `mask`, `clip-path`, `marker-*`, `stroke`) 13 von 24, `background`-Attribut an `table`/`td`/`th` 4 von 4, `style`
 * in SVG/MathML 3 von 3, SVG `feImage` 2 von 2, `video poster` 1 von 2. Kein `img`, `source`/`picture`, `srcset`,
 * `iframe`, `link`, `object` oder `embed` mehr.
 *
 * ## Warum ein Observer und kein Durchgang nach `render()`
 *
 * Ein Durchgang direkt nach `await MarkdownRenderer.render` kam bei 50 von 96 ladenden Fällen zu spät (ungehängt 45):
 * Bilder, `srcset`, `<picture>`, `video poster`, SVG `image`/`feImage` und Mermaid sind beim Auflösen des Versprechens
 * unterwegs. Ein inertes Dokument kam nicht in Frage: Mermaid rendert dort nicht, `video poster` lädt trotzdem, und
 * das Versprechen von `render()` hängt bei Bildern.
 *
 * ## Wirkung hängt an der Engine
 *
 * Für `<img>` entscheidet das Entfernen von `src` vor dem Ersetzen (code-kit 0.19.1 macht es im Durchgang). In
 * Obsidian 1.14.4 (Chromium 142) bringt das im Observer-Callback nach `innerHTML` 0 von 12 Anfragen, mit Ersetzen
 * ohne Entfernen 12 von 12, ohne Wächter 12 von 12. In Chrome 154 headless (code-kit-Messung) kamen im Observer 15 von
 * 15 durch, mit und ohne Abräumen; die Abweichung ist ungeklärt. Mit dem nächsten Electron-Sprung kann sich das ändern.
 *
 * ## `render()` wird nie blind abgewartet
 *
 * Entfernt der Observer ein `src`, bekommt das Bild nie ein `load`-Ereignis, und `MarkdownRenderer.render`
 * löst bei Bildern nicht auf, solange sie nicht geladen haben (gemessen: 33 von 70 Fällen laufen in die Frist).
 * Das DOM steht trotzdem. Deshalb läuft jedes Rendern hier gegen eine Frist (`DOM_GUARD_DEADLINE_MS`); danach
 * gilt es als fertig.
 *
 * ## Restgrenzen
 *
 * - Die Reste oben. Vermutung (nicht geprüft, Backlog-Task im Cockpit): ein erzwungenes Layout im Writer
 *   (`followTail` liest die Höhe) startet die CSS-Abrufe, bevor der Callback läuft.
 * - Mermaid zeichnet in einem Zwischenelement am Dokument, das ein Observer am Container nicht sieht; die Bildform
 *   `A@{ img: "https://…" }` lädt Mermaid 11 per `new Image()` außerhalb jedes Baums. **Mermaid ist deshalb nur
 *   gedeckt, wenn die erste Schicht `neutralizeModelMarkdown` ist** (sie lässt keine Fences stehen). Wer im
 *   `raw`-Pfad selbst `neutralizeRemoteResources` nimmt, lässt Mermaid-Fences durch (`A@{ img: … }` und
 *   `classDef … background:url(https://…)` kommen unverändert heraus, Probe gegen code-kit 0.18.0) und hat dort
 *   bis zur code-kit-Task „neutralizeRemoteResources — Mermaid fences with remote sources“ keine Deckung. Der
 *   Default des `createStableWriter` (`neutralizeModelMarkdown`) ist nicht betroffen.
 * - Obsidians eigener Sanitizer entfernt 43 von 137 Fällen der ersten Fassung der Liste vorab (u. a. jedes `<style>`);
 *   SMIL-`href` und `cursor` laden in Chromium im Kurzlauf nicht, der Durchgang entfernt sie trotzdem.
 * - `renderMarkdownGuarded` trennt den Observer nach der Frist; was danach asynchron entsteht, sieht er nicht.
 *   Der Observer des `createStableWriter` lebt dagegen so lange wie der Schreiber.
 * - Ein klickbarer Link bleibt (Restrisiko wie in der Regex-Fassung). Der Durchgang läuft hier auf dem angehängten
 *   Baum; serialisiert und neu geparst wird nirgends (Vertrag von `remote-resources`).
 *
 * Gebraucht wird ein DOM mit `MutationObserver`. Ohne einen wirft `attachDomGuard`, statt still ungeschützt zu
 * bleiben: ein Test mit dem Fake-DOM (`makeFakeEl`) übergibt `domGuard: false`.
 */
export const DOM_GUARD_DEADLINE_MS = 1500;

export interface DomGuardOptions extends RemoteResourcesOptions {
  /** Wird mit dem Entfernten gerufen, wenn ein Durchgang etwas herausgenommen hat (Diagnose, Zähler). */
  onRemoved?: (removed: RemovedResource[]) => void;
  /** Konstruktor des Observers; Default der `MutationObserver` des Fensters von `el`. Für Tests ohne DOM. */
  observer?: typeof MutationObserver;
}

export interface DomGuard {
  /** Ein Durchgang jetzt (zusätzlich zu denen im Observer), z. B. nach dem Rendern. */
  run(): void;
  /** Trennt den Observer. Danach tut `run()` nichts mehr. */
  disconnect(): void;
}

/** Hängt den Observer an `el` — **vor** dem Rendern aufrufen. Sofort wird ein erster Durchgang gefahren,
 *  damit schon vorhandener Inhalt nicht auf die erste Änderung wartet. */
export function attachDomGuard(el: HTMLElement, opts: DomGuardOptions = {}): DomGuard {
  const MO = opts.observer ?? el.ownerDocument?.defaultView?.MutationObserver ?? (typeof window === "undefined" ? undefined : window.MutationObserver);
  if (!MO) throw new Error("domGuard braucht ein DOM mit MutationObserver — in Tests mit dem Fake-DOM `domGuard: false` übergeben.");
  let active = true;
  const pass = (): void => {
    if (!active) return;
    const { removed } = neutralizeRemoteResourcesInTree(el, opts.localSchemes ? { localSchemes: opts.localSchemes } : {});
    if (removed.length > 0) opts.onRemoved?.(removed);
  };
  const observer = new MO(pass);
  observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
  pass();
  return {
    run: pass,
    disconnect(): void { active = false; observer.disconnect(); },
  };
}

/** `p` gegen eine Frist: gibt nach `ms` auf, ohne zu werfen. Ein Fehler von `p` wird weitergereicht. */
export function settleWithin(p: Promise<unknown>, ms: number, clock: ClockPort = realClock): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = clock.setTimeout(resolve, ms);
    p.then(() => { clock.clearTimeout(timer); resolve(); }, (e: unknown) => { clock.clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}

export interface RenderGuardedOptions extends DomGuardOptions {
  /** Frist für `render()`; Default `DOM_GUARD_DEADLINE_MS`. */
  deadlineMs?: number;
  clock?: ClockPort;
}

/**
 * `MarkdownRenderer.render` mit Observer: für Konsumenten, die Modell-Markdown selbst rendern und die
 * zweite Schicht brauchen (Hauptansicht, Verlauf, Notiz-Vorschau). Die Regex-Neutralisierung davor bleibt
 * Sache des Aufrufers (`neutralizeModelMarkdown`). Ein Fehler des Renderers wird weitergereicht; Observer
 * und Frist-Timer sind dann schon aufgeräumt.
 */
export async function renderMarkdownGuarded(
  app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component, opts: RenderGuardedOptions = {},
): Promise<void> {
  const guard = attachDomGuard(el, opts);
  try {
    await settleWithin(MarkdownRenderer.render(app, markdown, el, sourcePath, component), opts.deadlineMs ?? DOM_GUARD_DEADLINE_MS, opts.clock);
    guard.run();
  } finally {
    guard.disconnect();
  }
}
