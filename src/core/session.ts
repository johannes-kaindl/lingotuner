// uebernommen aus obsidian-transmute/src/core/session.ts (Datenmodell Version/selectVersion), 2026-09-07
/** Runden-Verlauf mit Rueckwahl. Jede Runde haelt Eingabe UND Ergebnis; der aktive Index
 *  bestimmt, was gezeigt, geschrieben und nachgeschaerft wird. Nichts wird abgeschnitten:
 *  Nachschaerfen ist Probieren, und der dritte Versuch kann schlechter sein als der erste. */
import type { Dials } from "./dials";

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
  aborted: boolean;
  truncated: boolean;
}

export interface Session {
  rounds: Round[];
  /** -1, solange es keine Runde gibt. */
  active: number;
}

export const EMPTY_SESSION: Session = { rounds: [], active: -1 };

export function addRound(s: Session, r: Round): Session {
  const rounds = [...s.rounds, r];
  return { rounds, active: rounds.length - 1 };
}

export function selectRound(s: Session, i: number): Session {
  if (i < 0 || i >= s.rounds.length || i === s.active) return s;
  return { ...s, active: i };
}

export function activeRound(s: Session): Round | null {
  return s.active >= 0 ? (s.rounds[s.active] ?? null) : null;
}

export function refineInput(s: Session): string | null {
  return activeRound(s)?.output ?? null;
}

/** Wurzel der aktiven Kette: von `s.active` ueber `basedOn` weiter, bis `basedOn === null`.
 *  Ohne Runden (`active === -1`) null. Eine Runde ohne Kette ist ihre eigene Wurzel; eine
 *  abgebrochene Zwischenrunde traegt ihr `basedOn` wie jede andere und unterbricht nichts. */
export function rootRound(s: Session): Round | null {
  if (s.active < 0) return null;
  let idx = s.active;
  let round: Round | undefined = s.rounds[idx];
  while (round !== undefined && round.basedOn !== null) {
    idx = round.basedOn;
    round = s.rounds[idx];
  }
  return round ?? null;
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
