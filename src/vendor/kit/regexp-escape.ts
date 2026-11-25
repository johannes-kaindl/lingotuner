// vendored from code-kit@0.93.0, src/ts/pure/regexp-escape.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: lifted from code-kit `src/ts/pure/redact.ts:254` (a file-private `escapeRegExp`; Welle 38, divergence run 2026-11-25, task "Regex-Zeichen
// maskieren"). The same line stood in image-to-markdown `src/fm_migration.ts:19` and `src/img_to_md.ts:133`, pseudonymizer
// `src/core/note-parts.ts:71`, vault-rag `src/link_writer.ts:20` (`escapeRe`) and settings-assistant `src/obsidian/snapshots.ts:97` (inline),
// character for character.
//
// CONTRACT: `new RegExp(escapeRegExp(s), flags)` matches exactly the text `s`, with or without the flags `u` and `v`, as long as the result
// stands OUTSIDE a character class. It puts a backslash before the fourteen characters that have a meaning there: `. * + ? ^ $ { } ( ) | [ ] \`.
// Every other character stays as it is (a line break, a lone surrogate, `/`, `-`): in a pattern given to the constructor they are literal.
//
// LIMITS:
// - Not for the inside of `[…]`: there `-` makes a range and is left alone here (escaping it outside a class is a SyntaxError under `u`/`v`),
//   and `v` reserves more characters inside a class (`&&`, `--`, `!!` …). A character class needs its own escaper; no carrier needs one.
// - Not for gluing behind a backslash escape: `"\\0" + escapeRegExp("1")` reads as `\01`, `"\\c" + escapeRegExp("J")` as a control escape.
//   Concatenate whole tokens.
//
// WHY NOT `RegExp.escape` (ES2025): it is not everywhere yet (measured 2026-11-25: Node 24.14, Playwright WebKit 26.6 and Chromium 153 have
// it; the installed Obsidian app (installer 1.12.4, Electron 39.7.0, Chromium 142) and the iOS webview were not measured), and its output is a
// different string: it also escapes a leading digit or ASCII letter as `\xNN`, white space (`\x20`, `\t`, `\n`), the punctuators
// `,-=<>#&!%:;@~'`"` as `\xNN` and `/` as `\/` (measured in Node 24.14), which makes it safe to glue behind an escape as above. The MATCH is
// the same for text outside a class (tested against it where the runtime has it); the pattern source is not. A carrier that stores or
// compares a pattern source must not swap one for the other.

const SYNTAX = /[.*+?^${}()|[\]\\]/g;

/** `s` with every regular-expression syntax character escaped, for use outside a character class. See the module header. */
export function escapeRegExp(s: string): string {
  return s.replace(SYNTAX, "\\$&");
}
