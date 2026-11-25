// vendored from code-kit@0.93.0, src/ts/pure/editor-span.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 37 Nachlauf, n-kit, B1: the target `selection` of the prompt panel and its write path in obsidian-kit `panel-accept`).
// Lifted from the two plugins that replace a selection after a model run:
//   * vault-rag `src/main.ts` (`runTransform`: the range `from..to` must still hold the captured text, else refuse; `editor.replaceRange(lead + result + trail, from, to)`)
//     and `src/reformat_mechanical.ts` (`splitSelectionAffix`);
//   * lingotuner `src/obsidian/editor-io.ts` (`replaceCapture`, same check, same write) and `src/core/source.ts` (`splitSelectionAffix`, copied from vault-rag, byte-equal
//     in its logic).
// What differs from both, and why: they only work in an open editor and refuse when the range moved; the panel also writes into a closed note (`vault.process`, as its
// `block` and `file` ways do) and FINDS the text again when it occurs exactly once (as `locateBlock` does for a block), because the user may type above the selection
// while the model runs. A closed note may carry CRLF and a BOM; the editor positions (`{ line, ch }`, 0-based, as CodeMirror and Obsidian give them) count lines by
// `\n` and do not see `\r` or the BOM, so the text is read in its LF form without BOM and written back in its own line ends.
//
// Positions are strict: a line past the last, or a `ch` past the end of its line, is no position (`null`), never a spot in the next line.

export interface EditorPos { line: number; ch: number }

const BOM = "\uFEFF";

/** Offset of `pos` in `text` (lines split at `\n` only); `null` when the line does not exist or `ch` lies outside it (negative, fractional, past its end). */
export function offsetOfPos(text: string, pos: EditorPos): number | null {
  if (!Number.isInteger(pos.line) || !Number.isInteger(pos.ch) || pos.line < 0 || pos.ch < 0) return null;
  let start = 0;
  for (let l = 0; l < pos.line; l++) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  const nl = text.indexOf("\n", start);
  const end = nl === -1 ? text.length : nl;
  return pos.ch <= end - start ? start + pos.ch : null;
}

/** Position of `offset` (clamped to `0..text.length`) in `text`, lines split at `\n`. */
export function posOfOffset(text: string, offset: number): EditorPos {
  const at = Math.max(0, Math.min(text.length, Math.floor(offset)));
  let line = 0;
  let last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < at; i = text.indexOf("\n", i + 1)) { line++; last = i; }
  return { line, ch: at - (last + 1) };
}

/** The text as the editor counts it: without a leading BOM, CRLF as LF; and what is needed to write it back. */
interface Plain { lf: string; bom: boolean; crlf: boolean }

function plain(text: string): Plain {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  return { lf: body.replace(/\r\n/g, "\n"), bom, crlf: body.includes("\r\n") };
}

function unplain(lf: string, p: Plain): string {
  return (p.bom ? BOM : "") + (p.crlf ? lf.replace(/\n/g, "\r\n") : lf);
}

/** Number of lines of `text` as the editor counts them (`\n` + 1, after the LF form without BOM): what `Editor.lineCount()` gives. */
export function lineCountOf(text: string): number {
  const { lf } = plain(text);
  let n = 1;
  for (let i = lf.indexOf("\n"); i !== -1; i = lf.indexOf("\n", i + 1)) n++;
  return n;
}

/** Where the span is. `relocated`: the text was not at `from..to` any more, but the note only moved by whole lines above it (positions are the new ones). */
export type SpanLocation = { from: EditorPos; to: EditorPos; relocated: boolean } | { problem: "changed" | "moved" };

/** Finds the span `from..to` that held `expected` (compared in LF form): at its place, or, if it is not there, where it went when lines were inserted or
 *  removed ABOVE it (the user types a line while the model runs). Finding it again needs `noteLines`, the line count of the note when the span was taken
 *  (`Editor.lineCount()`), and is allowed only for that case: `expected` occurs exactly once, at the same columns (`from.ch`, `to.ch`), over the same number
 *  of lines, with as many lines after it as before. Anything else is refused, because a text that also stands elsewhere is no proof of the place: a selected
 *  word the user changed in place while the same word stands in another line would otherwise be written there (review of n-kit B1, finding 1). Without
 *  `noteLines` there is no search.
 *  `changed`: `expected` is not at its place and was not found again (or is empty: an empty selection is a cursor, not a span); `moved`: it is not at its
 *  place and occurs more than once. */
export function locateSpan(text: string, from: EditorPos, to: EditorPos, expected: string, noteLines?: number): SpanLocation {
  const want = expected.replace(/\r\n/g, "\n");
  if (want === "") return { problem: "changed" };
  const { lf } = plain(text);
  const a = offsetOfPos(lf, from);
  const b = offsetOfPos(lf, to);
  if (a !== null && b !== null && b - a === want.length && lf.startsWith(want, a)) return { from, to, relocated: false };
  const first = lf.indexOf(want);
  if (first === -1) return { problem: "changed" };
  if (lf.indexOf(want, first + 1) !== -1) return { problem: "moved" };
  if (noteLines === undefined) return { problem: "changed" };
  const nf = posOfOffset(lf, first);
  const nt = posOfOffset(lf, first + want.length);
  const onlyLinesAbove = nf.ch === from.ch && nt.ch === to.ch && nt.line - nf.line === to.line - from.line && lineCountOf(lf) - nt.line === noteLines - to.line;
  return onlyLinesAbove ? { from: nf, to: nt, relocated: true } : { problem: "changed" };
}

/** Replaces the span `from..to` by `replacement` (written in the text's own line ends, BOM kept) — only if the span still holds `expected` exactly at that place
 *  (no search: this is the second check right before writing). `null`: the span is not there or holds something else. `to` is the end of the written text
 *  (editor positions, LF form), `lines` the line count afterwards (for the next `noteLines`). Mixed line ends in a CRLF text come back as CRLF throughout,
 *  and a lone `\r` is no line end here (CodeMirror counts it as one): positions in such a note may not match, the check then refuses. */
export function replaceSpan(text: string, from: EditorPos, to: EditorPos, expected: string, replacement: string): { next: string; to: EditorPos; lines: number } | null {
  const p = plain(text);
  const want = expected.replace(/\r\n/g, "\n");
  const a = offsetOfPos(p.lf, from);
  const b = offsetOfPos(p.lf, to);
  if (a === null || b === null || b - a !== want.length || !p.lf.startsWith(want, a)) return null;
  const put = replacement.replace(/\r\n/g, "\n");
  const lf = p.lf.slice(0, a) + put + p.lf.slice(b);
  return { next: unplain(lf, p), to: posOfOffset(lf, a + put.length), lines: lineCountOf(lf) };
}

export interface SelectionAffix { lead: string; core: string; trail: string }

const isSpace = (c: string): boolean => c.trim() === "";

/** Splits a selection into the white space at its edges that should stay and the core that a transform gets. `lead` keeps only the part up to and including
 *  the last line break of the leading white space (an indent of the first line belongs to the core, or it would stick to the first line of the result only);
 *  `trail` is all trailing white space. Write back `lead + result + trail`. White space is what `trim()` removes: the text goes to a model, not to a parser.
 *  Behaviour of vault-rag `splitSelectionAffix`, with one fix: a selection of white space only gave a `lead` and a `trail` that overlapped (writing back doubled
 *  it); here it is `lead` + `core`, `trail` empty. Read by hand, not with `/\s*$/`, which is quadratic on a long run of white space before a letter. */
export function splitSelectionAffix(text: string): SelectionAffix {
  let s = 0;
  while (s < text.length && isSpace(text.charAt(s))) s++;
  let e = text.length;
  if (s < text.length) while (e > s && isSpace(text.charAt(e - 1))) e--;
  const lead = text.slice(0, text.lastIndexOf("\n", s - 1) + 1);
  return { lead, core: text.slice(lead.length, e), trail: text.slice(e) };
}
