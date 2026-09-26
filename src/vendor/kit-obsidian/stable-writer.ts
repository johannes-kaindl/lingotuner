// vendored from obsidian-kit@0.43.0, src/obsidian/stable-writer.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// ONE mechanical deviation from verbatim: kit-internal imports (../pure/ and ../vendor/code-kit/{pure,web}/) → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ.
import { splitStable } from "../kit/stream-blocks";
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
}

export function createStableWriter(opts: StableWriterOptions): StableMarkdownWriter {
  const { area } = opts;
  const blockCls = opts.blockCls ?? "okit-stream-block";
  let raw = "";
  /** Wie viele Zeichen des Stroms bereits als Markdown gerendert sind. */
  let stableLen = 0;
  let pending: Array<Promise<void>> = [];

  return {
    area,

    push(text: string): void {
      raw += text;
      const { stable, tail } = splitStable(raw);
      if (stable.length > stableLen) {
        // Nur der NEU stabil gewordene Teil wird gerendert — bereits Gezeichnetes bleibt
        // unangetastet. Das ist der Unterschied zum Voll-Rerender.
        const fresh = stable.slice(stableLen);
        stableLen = stable.length;
        const blockEl = area.bodyEl.createDiv({ cls: blockCls });
        const p = opts.render(blockEl, fresh).catch(() => { blockEl.setText(fresh); });
        pending.push(p);
        // Der laufende Absatz gehört immer ans Ende: `createDiv` hängt den frischen Block
        // hinter den Tail, also wandert der Tail danach wieder dahinter.
        area.bodyEl.appendChild(area.tailEl);
      }
      area.setTail(tail);
      area.followTail();
    },

    raw(): string { return raw; },

    async settled(): Promise<void> {
      // Ein Rendering kann während des Wartens weitere anstoßen; deshalb bis zur Ruhe.
      while (pending.length > 0) {
        const laufend = pending;
        pending = [];
        await Promise.all(laufend);
      }
    },

    reset(): void {
      raw = "";
      stableLen = 0;
      pending = [];
      area.reset();
    },
  };
}
