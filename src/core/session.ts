/** Runden-Verlauf mit Rueckwahl. Jede Runde haelt Eingabe UND Ergebnis; der aktive Index
 *  bestimmt, was gezeigt, geschrieben und nachgeschaerft wird. Nichts wird abgeschnitten:
 *  Nachschaerfen ist Probieren, und der dritte Versuch kann schlechter sein als der erste.
 *  Seit dem Umbau auf den Kit-Rahmen (Welle 37) ist die Sitzung des Panels eine `PanelSession` (Ziel und Runden, code-kit `panel-session`); der Halter
 *  (`createPromptPanelHost`) haelt sie ueber das Schliessen des Fensters hinaus. */
import type { Dials } from "./dials";
import { chainOf, type PanelSession, type Target } from "../vendor/kit/panel-session";
import { EMPTY_ROUNDS, type Rounds } from "../vendor/kit/rounds";

export interface Round {
  dials: Dials;
  note: string;
  input: string;
  output: string;
  model: string;
  at: number;
  /** Index der Runde, deren Ausgabe die Eingabe war — null = aus der Quelle. */
  basedOn: number | null;
  /** Name der Quellnotiz beim Lauf aus der Quelle, `null` beim Textfeld. Beim Nachschaerfen
   *  der Name der WURZEL-Runde: die Kette hat genau eine Quelle, egal wie oft nachgeschaerft wird. */
  sourceName: string | null;
  truncated: boolean;
}

/** Verlauf und Auswahl liegen im Kit (`rounds`); die Runde selbst ist Fachdaten dieses Plugins. */
export type Session = Rounds<Round>;

export const EMPTY_SESSION: Session = EMPTY_ROUNDS;

/** Die Sitzung des Panels: worauf es arbeitet (Markierung, Notiz, eingefuegter Text) und die Runden. */
export type TuneSession = PanelSession<Round>;

/** Frische Sitzung ohne Runden (Halter-Option `fresh`). */
export function freshSession(target: Target): TuneSession {
  return { target, rounds: EMPTY_ROUNDS };
}

/** Wurzel der aktiven Kette (Kit `chainOf`: von `s.active` ueber `basedOn` bis `basedOn === null`; die Kette heisst vom Kit, die Wurzel steht vorn).
 *  Ohne Runden (`active === -1`) null. Eine Runde ohne Kette ist ihre eigene Wurzel; eine abgebrochene Zwischenrunde traegt ihr `basedOn` wie jede andere
 *  und unterbricht nichts. Eine kaputte Kette (Verweis auf sich selbst, nach vorn oder ins Leere) liefert null; die eigene Schleife davor lief bei einem
 *  Verweis auf sich selbst endlos. Das Plugin legt nur Verweise auf fruehere Runden an, die Kette ist also immer heil. */
export function rootRound(s: Session): Round | null {
  const c = chainOf(s, (r) => r.basedOn);
  const first = c.ok ? c.chain[0] : undefined;
  return first === undefined ? null : (s.rounds[first] ?? null);
}

/** Eingabe der Wurzel-Runde — der Text, gegen den ein Ersetzen die lebende Markierung/Notiz
 *  prueft. Nicht die Quelle zum Klickzeitpunkt: die kann inzwischen eine andere sein. */
export function rootInput(s: Session): string | null {
  return rootRound(s)?.input ?? null;
}

/** Name der Quellnotiz der Wurzel-Runde, `null` beim Textfeld. */
export function rootSourceName(s: Session): string | null {
  return rootRound(s)?.sourceName ?? null;
}
