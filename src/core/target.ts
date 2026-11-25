/** Ziel des Panels aus der gewaehlten Quelle, und was das Uebernehmen in die Notiz schreibt (pure Haelfte des Kit-Rahmens `buildPromptPanel`).
 *
 *  Die drei Quellen werden drei Ziel-Arten des Kits (code-kit `panel-session`):
 *  - Notiz → `file` (Pfad, Name). Uebernehmen ersetzt den Body und laesst die Frontmatter stehen (`noteReplacement`).
 *  - Eingefuegter Text → `new`. Er hat keinen Ort in einer Notiz; geschrieben wird nur als neue Notiz.
 *  - Markierung → vorlaeufig `block` mit Pfad, Zeilen und dem markierten Text als Fingerabdruck. Die Ziel-Art `selection` (Spec Auftrags-Fenster § 7.6) gibt es im Kit
 *    noch nicht (Bestellung B1, Welle 37); `block` traegt bis dahin dieselbe Gleichheit (`sameTarget`: Pfad, Zeilen, Text). In ein `block`-Ziel schreibt dieses Plugin nie
 *    ueber `acceptPanel` (das suchte einen Codeblock-Zaun); der Schreibweg „Markierung ersetzen“ ist bis B1 gesperrt.
 *  - Quelle nicht bereit (keine Markierung, Lesemodus, keine Notiz) → `other` mit dem Grund als Beschriftung: der Rahmen sperrt Senden und zeigt den Grund. */
import type { Target } from "../vendor/kit/panel-session";
import { splitFrontmatter, type CaptureState, type Readiness, type SourceKind } from "./source";
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
  return { kind: "block", path: cap.path, lineStart: cap.from.line, lineEnd: cap.to.line, label: labels.selection(cap.name), body: cap.text };
}

/** Der Notiztext nach „Notiz ersetzen“: Frontmatter bleibt, der Body wird das Ergebnis. Abgelehnt, wenn der Body nicht mehr der Text ist, aus dem die Runden-Kette
 *  begann (`rootInput`): sonst ueberschriebe das Ergebnis eine Aenderung, die seit dem Lauf in der Notiz gemacht wurde. */
export function noteReplacement(current: string | null, rootInput: string | null, output: string, problems: { gone: string; changed: string }): { ok: true; text: string } | { ok: false; problem: string } {
  if (current === null) return { ok: false, problem: problems.gone };
  const { head, body } = splitFrontmatter(current);
  if (rootInput === null || body !== rootInput) return { ok: false, problem: problems.changed };
  return { ok: true, text: head + output };
}
