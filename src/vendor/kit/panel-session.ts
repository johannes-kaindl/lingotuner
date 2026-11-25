// vendored from code-kit@0.90.0, src/ts/pure/panel-session.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `3d-codeblocks/src/core/shapes/panel-state.ts` (`PanelTarget`, `sameTarget`, `followTarget`, `resolveChain`/`chainOf`,
// `acceptText`, `baseTextForRefine`) and `src/obsidian/prompt-panel.ts` (`kind()`, `settleTarget()`), generalised: the round type `R` is the caller's,
// the format-bound steps (`applyChanges`, the round kinds `create`/`refine`, the `shapes-block`/`shapes-file` names) are parameters or renamed.
// Reduced to what the pure session needs; the rounds list itself is `rounds.ts`.

import { activeRound, type Rounds } from "./rounds";

/** What the panel works on. `block`: a fenced block in a note, `lineStart`/`lineEnd` its lines, `body` the text at the click (the fingerprint the
 *  writer checks against, it does not count for equality); `file`: a whole file; `other`: something the panel shows but cannot change. */
export type Target =
  | { kind: "new" }
  | { kind: "block"; path: string; lineStart: number; lineEnd: number; label: string; body: string }
  | { kind: "file"; path: string; label: string }
  | { kind: "other"; label: string };

/** The state of one panel: where the result goes and the rounds so far (`R` is whatever the caller stores per round). */
export interface PanelSession<R> {
  target: Target;
  rounds: Rounds<R>;
}

/** The result of a step that produces a text: the text, or the reason it could not be produced. A failing `applyRound` of the caller needs no
 *  `issue`; `acceptChain` wraps its problem as `round-failed`. */
export type Step = { ok: true; text: string } | { ok: false; problem: string; issue?: ChainIssue };

/** Why `chainOf` or `acceptChain` failed, as a code with the numbers the English `problem` text has in it, for a caller that words the message
 *  itself (a localised UI). `round` and `ref` are LIST numbers as the panel shows them (index + 1), the same as in the text.
 *  - `missing-round`: round `round` does not exist (the active one is out of range, or a round that the chain reaches is gone);
 *  - `missing-ref`: round `round` builds on round `ref`, which does not exist;
 *  - `self-ref`: round `round` builds on itself;
 *  - `forward-ref`: round `round` builds on a LATER round `ref`;
 *  - `nothing-to-apply`: no round is active, or the chain produced no text;
 *  - `round-failed`: `applyRound` of the caller failed at round `round`; `problem` is ITS text without the "round N: " in front (an `issue` that
 *    `applyRound` carried itself is not passed on: one field, one meaning).
 *
 *  Example, a German UI over the codes (the English `problem` stays the fallback):
 *  `const say = (i: ChainIssue): string => { switch (i.code) { case "missing-round": return `Runde ${i.round} gibt es nicht`; case "missing-ref": return `Runde ${i.round} verweist auf Runde ${i.ref}, die es nicht gibt`; case "self-ref": return `Runde ${i.round} zeigt auf sich selbst`; case "forward-ref": return `Runde ${i.round} zeigt nach vorn auf Runde ${i.ref}`; case "nothing-to-apply": return "nichts zu übernehmen"; case "round-failed": return `Runde ${i.round}: ${i.problem}`; } };` */
export type ChainIssue =
  | { code: "missing-round"; round: number }
  | { code: "missing-ref"; round: number; ref: number }
  | { code: "self-ref"; round: number }
  | { code: "forward-ref"; round: number; ref: number }
  | { code: "nothing-to-apply" }
  | { code: "round-failed"; round: number; problem: string };

/** What `chainOf` and `acceptChain` return on failure: `problem` is the English text (unchanged since 0.53.0), `issue` the same fact as a code. */
export type ChainFailure = { ok: false; problem: string; issue: ChainIssue };

/** Comparison form of a block body: CRLF → LF, one trailing line break does not count. */
const normBody = (t: string): string => t.replace(/\r\n/g, "\n").replace(/\n$/, "");

/** Structurally the same target? Block: path + lines + body text (the label does not count; a different body is a fresh fingerprint, so another
 *  target). A block whose lines moved is another target while rounds are open: the panel gets a fresh target on every click, and the writer finds
 *  the fence again by the line number and refuses if the block wandered. */
export function sameTarget(a: Target, b: Target): boolean {
  switch (a.kind) {
    case "new":
      return b.kind === "new";
    case "block":
      return b.kind === "block" && a.path === b.path && a.lineStart === b.lineStart && a.lineEnd === b.lineEnd && normBody(a.body) === normBody(b.body);
    case "file":
      return b.kind === "file" && a.path === b.path;
    case "other":
      return b.kind === "other" && a.label === b.label;
  }
}

/** A target offered to the panel: while rounds are open the target stays (the result of the rounds belongs to it); without rounds the panel
 *  takes the offered one. The same object comes back when nothing changes. Whether a different target was kept: `!sameTarget(s.target, offered)`. */
export function followTarget<R>(s: PanelSession<R>, offered: Target): PanelSession<R> {
  if (s.rounds.rounds.length > 0) return s;
  return { ...s, target: offered };
}

/** A target that was held back during a run applies now if no round is open; `null` (nothing was held back) changes nothing. The same object
 *  comes back when nothing changes. */
export function settleTarget<R>(s: PanelSession<R>, offered: Target | null): PanelSession<R> {
  if (offered === null || s.rounds.rounds.length > 0) return s;
  return { ...s, target: offered };
}

/** `create` for a new target without rounds, otherwise `refine` (a new target with rounds refines the active round's text). */
export function taskKind<R>(s: PanelSession<R>): "create" | "refine" {
  return s.target.kind === "new" && s.rounds.rounds.length === 0 ? "create" : "refine";
}

/** The chain of round indices from the root to the active round, following `basedOnOf` (the index a round builds on, `null` for a round that
 *  starts from the target: a creation or a refinement of the target text). A broken chain (no such round, a round pointing at itself or forward)
 *  is a problem with list numbers as the panel shows them (index + 1), not a partial chain. No rounds: an empty chain. */
export function chainOf<R>(rounds: Rounds<R>, basedOnOf: (r: R) => number | null): { ok: true; chain: number[] } | ChainFailure {
  const chain: number[] = [];
  if (rounds.active < 0) return { ok: true, chain };
  let index = rounds.active;
  if (!Number.isInteger(index) || index >= rounds.rounds.length) {
    return { ok: false, problem: `the round chain is broken (round ${String(index + 1)} does not exist)`, issue: { code: "missing-round", round: index + 1 } };
  }
  // A round builds only on an EARLIER one (basedOn < own index); with that there are no cycles and the loop ends after at most `active + 1` steps.
  for (;;) {
    chain.unshift(index);
    const round = rounds.rounds[index];
    if (round === undefined) return { ok: false, problem: `the round chain is broken (round ${String(index + 1)} does not exist)`, issue: { code: "missing-round", round: index + 1 } };
    const based = basedOnOf(round);
    if (based === null) break;
    const n = String(index + 1);
    const m = String(based + 1);
    if (!Number.isInteger(based) || based < 0 || based >= rounds.rounds.length) {
      return { ok: false, problem: `the round chain is broken (round ${n} refers to round ${m} which does not exist)`, issue: { code: "missing-ref", round: index + 1, ref: based + 1 } };
    }
    if (based === index) return { ok: false, problem: `the round chain is broken (round ${n} points to itself)`, issue: { code: "self-ref", round: index + 1 } };
    if (based > index) return { ok: false, problem: `the round chain is broken (round ${n} points forward to round ${m})`, issue: { code: "forward-ref", round: index + 1, ref: based + 1 } };
    index = based;
  }
  return { ok: true, chain };
}

/** The text that accepting the active round would write: the chain is applied round by round, in chain order, to `current` (the text of the
 *  target NOW, `null` when it is gone) — hand edits in between survive because nothing stored is written back. All or nothing: a failing round
 *  gives `ok: false` with its list number in front ("round 2: …"), never a text. Every failure also carries `issue`, the same fact as a code with the list numbers ({@link ChainIssue}), so a caller can word it in its own language. `applyRound` gets the text so far (`null` for the first round
 *  if there is no current text; a creating round ignores it), the round and its list index (0-based), and answers with a `Step`. */
export function acceptChain<R>(
  rounds: Rounds<R>,
  current: string | null,
  o: { basedOnOf: (r: R) => number | null; applyRound: (text: string | null, r: R, index: number) => Step },
): { ok: true; text: string } | ChainFailure {
  const resolved = chainOf(rounds, o.basedOnOf);
  if (!resolved.ok) return { ok: false, problem: resolved.problem, issue: resolved.issue };
  if (resolved.chain.length === 0) return { ok: false, problem: "nothing to apply", issue: { code: "nothing-to-apply" } };
  let text: string | null = current;
  for (const index of resolved.chain) {
    const round = rounds.rounds[index];
    if (round === undefined) return { ok: false, problem: `the round chain is broken (round ${String(index + 1)} does not exist)`, issue: { code: "missing-round", round: index + 1 } };
    const step = o.applyRound(text, round, index);
    if (!step.ok) return { ok: false, problem: `round ${String(index + 1)}: ${step.problem}`, issue: { code: "round-failed", round: index + 1, problem: step.problem } };
    text = step.text;
  }
  return text === null ? { ok: false, problem: "nothing to apply", issue: { code: "nothing-to-apply" } } : { ok: true, text };
}

/** The base of the next refinement: the text of the active round (what the user sees), else the current text of the target; for the target `new`
 *  without rounds there is nothing to refine (`null`). */
export function baseTextForRefine<R>(s: PanelSession<R>, current: string | null, o: { textOf: (r: R) => string }): string | null {
  const active = activeRound(s.rounds);
  if (active !== null) return o.textOf(active);
  return s.target.kind === "new" ? null : current;
}
