/** Quellzustand — pure Haelfte des vault-rag-Musters „Editor-Auswahl aus einem Sidebar-Panel"
 *  (REGISTRY; 2. Exemplar, nach dem Bau als Kit-Kandidat nachtragen). Die Adapter-Haelfte
 *  (Listener, Liveness) liegt in src/obsidian/editor-io.ts. */

export type SourceKind = "selection" | "note" | "text";
export interface Pos { line: number; ch: number }

export interface Capture {
  kind: "selection" | "note";
  path: string;
  name: string;
  /** Bei "note": der Body ohne Frontmatter. */
  text: string;
  from: Pos;
  to: Pos;
}

export interface CaptureState {
  selection: Capture | null;
  note: Capture | null;
  blocked: "reading-mode" | "no-note" | null;
}

export const EMPTY_CAPTURE: CaptureState = { selection: null, note: null, blocked: null };

export type Readiness =
  | { kind: "ready"; text: string; chars: number; name: string | null }
  | { kind: "no-selection" }
  | { kind: "reading-mode" }
  | { kind: "no-note" }
  | { kind: "empty-text" };

export function readiness(kind: SourceKind, state: CaptureState, freeText: string): Readiness {
  if (kind === "text") {
    if (freeText.trim() === "") return { kind: "empty-text" };
    return { kind: "ready", text: freeText, chars: freeText.length, name: null };
  }
  if (state.blocked === "reading-mode") return { kind: "reading-mode" };
  if (state.blocked === "no-note") return { kind: "no-note" };
  const cap = kind === "selection" ? state.selection : state.note;
  if (cap === null) return kind === "selection" ? { kind: "no-selection" } : { kind: "no-note" };
  return { kind: "ready", text: cap.text, chars: cap.text.length, name: cap.name };
}

export function readinessKey(r: Readiness): string {
  switch (r.kind) {
    case "ready": return "";
    case "no-selection": return "source.noSelection";
    case "reading-mode": return "source.readingMode";
    case "no-note": return "source.noNote";
    case "empty-text": return "source.emptyText";
  }
}

/** Steht an der gemerkten Stelle noch der gemerkte Text? */
export function isRangeStale(current: string, captured: string): boolean {
  return current !== captured;
}

// uebernommen aus vault-rag/src/reformat_mechanical.ts (splitSelectionAffix), 2026-09-07
export function splitSelectionAffix(text: string): { lead: string; core: string; trail: string } {
  const rawLead = /^\s*/.exec(text)?.[0] ?? "";
  const trail = /\s*$/.exec(text)?.[0] ?? "";
  const lead = rawLead.slice(0, rawLead.lastIndexOf("\n") + 1);
  const core = text.slice(lead.length, text.length - trail.length);
  return { lead, core, trail };
}

/** YAML-Kopf abtrennen; `head` endet mit der Trennzeile samt Zeilenumbruch. */
export function splitFrontmatter(content: string): { head: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (m === null) return { head: "", body: content };
  return { head: m[0], body: content.slice(m[0].length) };
}

export function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}
