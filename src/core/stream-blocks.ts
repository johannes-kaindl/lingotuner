// uebernommen aus koda-agent/src/core/chat/stream-blocks.ts, 2026-09-07
/* Schnitt eines laufenden Streams in „fertig" und „laeuft noch".
 *
 * Anlass: bis 0.8.0 war Kodas Antwort waehrend des Streams Rohtext und wurde erst beim
 * Abschluss als Markdown gerendert — Sternchen und Listenstriche standen minutenlang sichtbar
 * da. Der naheliegende Weg (alle 200 ms den ganzen bisherigen Text neu durch MarkdownRenderer)
 * ist der falsche: er zeichnet bereits Gezeichnetes neu, flackert, laesst die Scrollposition
 * springen und waechst quadratisch mit der Antwortlaenge.
 *
 * Stattdessen: was VOR der letzten Absatzgrenze steht, ist fertig und wird genau einmal
 * gerendert; der Rest bleibt Rohtext, bis der Absatz schliesst. Der Preis ist bewusst — im
 * laufenden Absatz ist der Text ohnehin unvollstaendig.
 *
 * Die eine Regel, die es nicht-trivial macht: eine Leerzeile INNERHALB eines offenen
 * Codeblocks ist keine Grenze. Ohne sie wuerde die Haelfte eines ```-Fence als Absatz
 * gerendert und der Rest nie wieder als Code. */

export interface StreamSplit {
  /** Abgeschlossene Bloecke inkl. ihrer abschliessenden Leerzeilen. Einmalig renderbar. */
  stable: string;
  /** Der noch laufende Rest. Bleibt Rohtext. */
  tail: string;
}

/** Zeile oeffnet oder schliesst einen Codeblock (``` oder ~~~, bis zu drei Leerzeichen
 *  eingerueckt — mehr waere nach CommonMark ein Indented Code Block). */
function isFence(line: string): boolean {
  return /^ {0,3}(?:```|~~~)/.test(line);
}

export function splitStable(text: string): StreamSplit {
  const lines = text.split("\n");
  let inFence = false;
  /** Index der ersten Zeile NACH der letzten gueltigen Grenze. 0 = noch keine gefunden. */
  let cut = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    // Eine leere Zeile ausserhalb eines Fence beendet den Absatz davor. Die Grenze liegt
    // hinter der LETZTEN einer Folge leerer Zeilen — mehrfache Leerzeilen gehoeren noch zum
    // abgeschlossenen Teil, nicht an den Anfang des naechsten.
    if (!inFence && line === "" && i + 1 < lines.length) cut = i + 1;
  }

  if (cut === 0) return { stable: "", tail: text };
  const stable = lines.slice(0, cut).join("\n") + "\n";
  return { stable, tail: lines.slice(cut).join("\n") };
}
