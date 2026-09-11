// vendored from code-kit@0.6.0, src/ts/pure/stream-blocks.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Where a text that is still arriving can be cut into "finished" and "still running".
 *
 *  The problem it answers: a chat UI streaming a Markdown answer wants to show rendered
 *  Markdown, not raw asterisks and list dashes, while the answer is still coming in. The
 *  obvious route — push the whole accumulated text through the renderer every 200 ms — is the
 *  wrong one: it redraws what is already drawn, flickers, makes the scroll position jump, and
 *  its cost grows quadratically with the length of the answer.
 *
 *  Instead: whatever stands BEFORE the last paragraph boundary is finished and gets rendered
 *  exactly once; the rest stays raw until its paragraph closes. The price is deliberate — the
 *  text of a running paragraph is incomplete anyway, so rendering it buys nothing.
 *
 *  The one rule that makes this non-trivial: a blank line INSIDE an open code fence is not a
 *  boundary. Without it half a ``` fence would render as a paragraph and the rest would never
 *  render as code again.
 *
 *  Two identical versions existed before this one (obsidian-plugins/, 2026-09):
 *  `koda-agent/src/core/chat/stream-blocks.ts` (written there for its streaming chat view) and
 *  `lingotuner/src/core/stream-blocks.ts` (a stamped copy of it, same day). The logic was
 *  byte-equal in both — this is a plain de-duplication, no divergence had to be resolved.
 *
 *  ── Deliberate limits ───────────────────────────────────────────────────────────────────
 *  **A blank line is an empty line, not a whitespace-only one.** Markdown would count `" "`
 *  as blank; this module does not. Refusing a boundary only delays a render, it never loses
 *  or misplaces text, so the conservative reading is the safe one here — and it keeps the
 *  check a plain string comparison rather than a second regex per line.
 *  **No CommonMark completeness.** Fence *length* and matching info strings are not tracked
 *  (a ``` inside a ~~~~ block toggles the state), and indented code blocks are not modelled.
 *  Both would cost a real parser for a decision that is re-taken on the next chunk anyway.
 *  **Line endings are `\n`.** A CRLF stream leaves a `\r` on the line, which is then no
 *  longer empty and yields no boundary — again the harmless direction, but a caller that
 *  streams CRLF should normalise before calling.
 */

export interface StreamSplit {
  /** The completed blocks, including their trailing blank lines. Renderable exactly once. */
  stable: string;
  /** The part that is still running. Stays raw. */
  tail: string;
}

/** Whether the line opens or closes a code fence (``` or ~~~, indented by up to three
 *  spaces — four would be an indented code block under CommonMark, not a fence). */
function isFence(line: string): boolean {
  return /^ {0,3}(?:```|~~~)/.test(line);
}

/** Split `text` at the last paragraph boundary that lies outside a code fence. Concatenating
 *  the two halves reproduces the input exactly. */
export function splitStable(text: string): StreamSplit {
  const lines = text.split("\n");
  let inFence = false;
  /** Index of the first line AFTER the last valid boundary. 0 = none found yet. */
  let cut = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    // A blank line outside a fence ends the paragraph before it. The boundary sits behind the
    // LAST of a run of blank lines — a run belongs to the completed part in full, not to the
    // start of the next block.
    if (!inFence && line === "" && i + 1 < lines.length) cut = i + 1;
  }

  if (cut === 0) return { stable: "", tail: text };
  const stable = lines.slice(0, cut).join("\n") + "\n";
  return { stable, tail: lines.slice(cut).join("\n") };
}
