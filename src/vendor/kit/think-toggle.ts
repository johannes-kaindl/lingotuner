// vendored from code-kit@0.6.0, src/ts/pure/think-toggle.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The two halves of a "think" switch for local LLM chat UIs: what the toggle should show,
 *  and what the request should actually do. They belong in one module because they answer
 *  the same question — a switch that promises something the request does not deliver is a lie.
 *
 *  Six versions existed before this one (obsidian-plugins/, 2026-06..2026-08):
 *  `image-to-markdown/src/reasoning_toggle.ts` (richest — the only one besides koda-agent
 *  carrying the hint), `koda-agent/src/core/chat/reasoning-toggle.ts` and
 *  `obsidian-transmute/src/core/reasoning-toggle.ts` (both stamped copies of it),
 *  `vim-dojo/src/llm/thinkToggle.ts` and `markdown-presentation/src/llm/ai-settings-model.ts`
 *  (own lines), `kuro-gamification/src/llm/KuroChatClient.ts` (request half only).
 *  `effectiveSuppress` was byte-equal logic in all six; the display half had diverged.
 *
 *  ── What deliberately did NOT come along ────────────────────────────────────────────────
 *  **The i18n key.** Four versions returned a `labelKey`, and they disagreed about it
 *  (`view.thinkingOn` vs `deck.settings.thinking.on`); vim-dojo returned ready-made English
 *  prose. So this module returns a language-free `mode` and the consumer maps it onto its own
 *  key through its own `t()` — the same rule that keeps `endpoint_diagnostics` from leaking
 *  its German `klartext`, and that `markdown-presentation` already models with `roleKindKey`.
 *  **The CSS class.** Three versions emit `is-off` for the off state,
 *  `markdown-presentation` deliberately does not: its row uses a native Obsidian toggle whose
 *  switch position already shows the state, so a second, invisible channel would be noise.
 *  That is a real, argued disagreement about presentation, not drift — shipping one of the two
 *  would silently overrule the other. The class is one line at the call site; `mode` is the
 *  fact both derive it from.
 *
 *  `disabled` is redundant against `mode === "always"` and is returned anyway: every display
 *  version computed it, and it is what the UI actually binds a control to (same reasoning as
 *  `canAbort` in `run-state`).
 */
import { isAlwaysOnThinker } from "./reasoning";
import { guessFromName } from "./capabilities";

export type ThinkToggleMode = "on" | "off" | "always";

/** `"alwaysGuess"`: the name heuristic believes this model always thinks, but it is not one
 *  of the models that *reject* the suppression parameters — so the switch stays usable and the
 *  UI may add that turning it off will likely have no effect. There is deliberately no
 *  counterpart for "probably does not think": `guessFromName` returns `support:"none"` both for
 *  known non-thinkers and for every unrecognised name — the majority case with freely named
 *  local models — so such a hint would claim what the heuristic cannot support. */
export type ThinkToggleHint = "alwaysGuess" | null;

export interface ThinkToggleState {
  mode: ThinkToggleMode;
  hint: ThinkToggleHint;
  /** Always equal to `mode === "always"`. */
  disabled: boolean;
}

function hintFor(model: string): ThinkToggleHint {
  if (model === "") return null; // nothing chosen — no claim about a model that isn't there
  return guessFromName(model).thinking.support === "always" ? "alwaysGuess" : null;
}

/** Display state of the switch. gpt-oss/harmony cannot be silenced → locked and shown as
 *  "always"; otherwise on/off follows the user's flag. */
export function thinkToggleState(model: string, suppress: boolean): ThinkToggleState {
  if (isAlwaysOnThinker(model)) return { mode: "always", hint: null, disabled: true };
  return { mode: suppress ? "off" : "on", hint: hintFor(model), disabled: false };
}

/** What the request actually does: suppress only when the user wants it AND the model can be
 *  silenced. Mirrors the toggle's locked state onto the request side.
 *
 *  Bound to `isAlwaysOnThinker` on purpose, NOT to the richer `guessFromName`: deepseek-r1, qwq
 *  and friends swallow `reasoning_effort:"none"` as a harmless no-op and keep thinking, while
 *  gpt-oss/harmony reject the request outright. Only the second case justifies a block — the
 *  first would be paternalism based on a name guess. Pinned by test. */
export function effectiveSuppress(model: string, suppress: boolean): boolean {
  return suppress && !isAlwaysOnThinker(model);
}
