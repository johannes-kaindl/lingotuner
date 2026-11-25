// vendored from code-kit@0.91.1, src/ts/pure/prompt-override.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 37 Nachlauf, n-kit, 2026-11-25), lifted from two plugins that solved the same job:
//   * yijing-oracle `src/core/llm/settings-defaults.ts` (the origin: the stored prompt defaults to "", "" means the shipped text, reset writes "");
//   * koda-agent `src/core/prompt/rules.ts` (`effectiveRules`, `renderRules`, the `missing-placeholder` check) — adds named placeholders
//     `{{sprache}}` / `{{ordner}}` so an overridden prompt follows a later change of the language or the folder;
//   * vault-rag `src/settings_core.ts` (`effectiveSystemPrompt`, `migrateSystemPrompt`) — adds "a stored copy of an OLD shipped text counts as not
//     overridden" (users had the 0.25.0 default copied into their data.json).
// The settings row that edits the value is obsidian-kit `src/obsidian/prompt-setting.ts`.
//
// WHY THE STORED VALUE STAYS EMPTY: a text field that lets the user replace a shipped text (system prompt, rule block) tempts one to copy the shipped
// text into the stored value when the field is first opened. That freezes it: a later improvement of the shipped text never reaches the users who
// once opened the field. So the stored value is "" until someone really wants something else; the shipped text is only the field's placeholder.
//
// Placeholders are `{{name}}`, not the `{name}` of `field-template` (`fillFieldTemplate`): a prompt often carries JSON examples, and a single brace
// would read `{"a": 1}` as a field and blank it. Here an unknown `{{name}}` stays as written — it is either the user's typo (they should see it) or a
// placeholder of a newer version (dropping it would be the worse outcome). Values are inserted in ONE pass, so a value that itself contains
// `{{other}}` (a folder named that way) is not filled a second time.
//
// Whitespace: "empty" is decided by JavaScript's `trim()`. That is the right reader here — the text goes to a model, not to a CSS or HTML parser,
// and a prompt of only NBSPs is as empty to the user as one of only spaces.

/** Upper bound of a placeholder name; a longer `{{…}}` is text, not a placeholder (keeps the scan linear on a run of braces). */
export const PROMPT_PLACEHOLDER_MAX_NAME = 64;

/** `{{name}}` for a name — the spelling the settings row shows in its hint line. */
export function promptPlaceholder(name: string): string {
  return `{{${name}}}`;
}

/** True when `stored` means "use the shipped text": empty or blank, or (after trimming) equal to one of `legacy` — earlier shipped texts that a
 *  former version copied into the settings. */
export function isShippedPrompt(stored: string | null | undefined, legacy: readonly string[] = []): boolean {
  const own = (stored ?? "").trim();
  if (own === "") return true;
  return legacy.some((l) => l.trim() === own);
}

/** The text that applies: `shipped` when `stored` means "not overridden" (see `isShippedPrompt`), else `stored` unchanged (not trimmed — the
 *  user's line breaks at the edges are theirs). Placeholders are not filled here; call `fillPromptPlaceholders` on the result. */
export function effectivePrompt(stored: string | null | undefined, shipped: string, legacy: readonly string[] = []): string {
  return isShippedPrompt(stored, legacy) ? shipped : (stored as string);
}

/** What to store for a value typed into the field: "" when it equals the shipped text or an old one (after trimming), else the value as typed.
 *  Keeps "the shipped text applies" when the user loads the shipped text into the field and leaves it, or pastes it back. */
export function normalizePromptOverride(value: string, shipped: string, legacy: readonly string[] = []): string {
  const own = value.trim();
  if (own === "" || own === shipped.trim()) return "";
  return legacy.some((l) => l.trim() === own) ? "" : value;
}

/** Replaces each `{{name}}` whose `name` is an own key of `values` by its value, in one pass; unknown names, `{{}}` and names longer than
 *  `PROMPT_PLACEHOLDER_MAX_NAME` stay as written. The name is taken exactly (no trimming): `{{ sprache }}` is not `{{sprache}}`. */
export function fillPromptPlaceholders(template: string, values: Readonly<Record<string, string>>): string {
  let out = "";
  let from = 0;
  let i = template.indexOf("{{");
  while (i !== -1) {
    // A run of braces: the placeholder starts at the last `{{` before the name.
    let start = i;
    while (template.charCodeAt(start + 2) === 123 /* { */) start++;
    // Look for the closing `}}` only within the longest name: an unbounded search from every `{{` would be quadratic on `{{a{{a{{a…`.
    const close = template.slice(start + 2, start + 4 + PROMPT_PLACEHOLDER_MAX_NAME).indexOf("}}");
    const end = close === -1 ? -1 : start + 2 + close;
    const name = end === -1 ? "" : template.slice(start + 2, end);
    if (name.length > 0 && name.length <= PROMPT_PLACEHOLDER_MAX_NAME && !name.includes("{")
      && Object.prototype.hasOwnProperty.call(values, name)) {
      out += template.slice(from, start) + values[name];
      from = end + 2;
      i = template.indexOf("{{", from);
    } else {
      i = template.indexOf("{{", start + 1);
    }
  }
  return out + template.slice(from);
}

/** The names of `names` whose `{{name}}` does not occur in `template` — for a warning line ("the text no longer follows the language"). Order of
 *  `names`, each once. */
export function missingPromptPlaceholders(template: string, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of names) if (!out.includes(n) && !template.includes(promptPlaceholder(n))) out.push(n);
  return out;
}
