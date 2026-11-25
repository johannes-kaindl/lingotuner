/** Ziel des Panels aus der gewaehlten Quelle, und was das Uebernehmen in die Notiz schreibt (pure Haelfte des Kit-Rahmens `buildPromptPanel`).
 *
 *  Die drei Quellen werden drei Ziel-Arten des Kits (code-kit `panel-session`):
 *  - Notiz → `file` (Pfad, Name). Uebernehmen ersetzt den Body und laesst die Frontmatter stehen (`noteReplacement`).
 *  - Eingefuegter Text → `new`. Er hat keinen Ort in einer Notiz; geschrieben wird nur als neue Notiz.
 *  - Markierung → `selection` (code-kit seit 0.91.0) mit Pfad, Spanne, dem markierten Text als Fingerabdruck und der Zeilenzahl der Notiz beim Anbieten
 *    (`noteLines`: nur damit findet der Baustein die Markierung wieder, wenn Zeilen darueber dazukamen oder wegfielen).
 *  - Quelle nicht bereit (keine Markierung, Lesemodus, keine Notiz) → `other` mit dem Grund als Beschriftung: der Rahmen sperrt Senden und zeigt den Grund. */
import type { Target } from "../vendor/kit/panel-session";
import { splitFrontmatter } from "../vendor/kit/frontmatter";
import { type CaptureState, type Readiness, type SourceKind } from "./source";
import { readiness } from "./source";

export interface TargetLabels {
  selection(name: string): string;
  note(name: string): string;
  /** Warum die Quelle nicht bereit ist (Text der Bereitschaftszeile). */
  blocked(r: Readiness): string;
}

export function targetFor(kind: SourceKind, state: CaptureState, labels: TargetLabels): Target {
  if (kind === "text") return { kind: "new" };
  const r = readiness(kind, state, "");
  if (r.kind !== "ready") return { kind: "other", label: labels.blocked(r) };
  const cap = kind === "selection" ? state.selection : state.note;
  if (cap === null) return { kind: "other", label: labels.blocked(r) };
  if (kind === "note") return { kind: "file", path: cap.path, label: labels.note(cap.name) };
  return { kind: "selection", path: cap.path, from: cap.from, to: cap.to, label: labels.selection(cap.name), text: cap.text, ...(cap.noteLines !== undefined ? { noteLines: cap.noteLines } : {}) };
}

/** Der Notiztext nach „Notiz ersetzen“: Frontmatter bleibt, der Body wird das Ergebnis. Abgelehnt, wenn der Body nicht mehr der Text ist, aus dem die Runden-Kette
 *  begann (`rootInput`): sonst ueberschriebe das Ergebnis eine Aenderung, die seit dem Lauf in der Notiz gemacht wurde. */
export function noteReplacement(current: string | null, rootInput: string | null, output: string, problems: { gone: string; changed: string }): { ok: true; text: string } | { ok: false; problem: string } {
  if (current === null) return { ok: false, problem: problems.gone };
  const { head, body } = splitFrontmatter(current);
  if (rootInput === null || body !== rootInput) return { ok: false, problem: problems.changed };
  return { ok: true, text: head + output };
}
