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
