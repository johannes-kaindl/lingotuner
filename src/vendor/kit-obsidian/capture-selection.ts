// vendored from obsidian-kit@0.112.0, src/obsidian/capture-selection.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Captures the selection in the note the user means as the `selection` target of `acceptPanel` (`panel-accept`, Ziel `selection`,
 *  since 0.111.0), or answers why there is none as a value. The note comes from {@link mainMarkdownView}: the focus may sit in the
 *  plugin's side panel, where `getActiveViewOfType(MarkdownView)` is `null` (Bestellung K1, Welle 38 „Markierung mitschreiben“).
 *
 *  Contract of {@link captureSelection}:
 *  - `ok: true` with `target = { kind: "selection", path, from, to, label, text, noteLines }`: `from`/`to` are the editor's
 *    `getCursor("from")`/`getCursor("to")` (line and column of the editor, the count `acceptPanel` finds again; a CRLF note counts its
 *    lines the same, `pilot/auswahl-notiz.ts`), `text` is `getSelection()` untrimmed, `noteLines` is `lineCount()` (without it
 *    `acceptPanel` cannot find the selection again after a line was typed above it), `label` is `strings.label(file.basename)`.
 *  - `ok: false` with `reason` and the `message` for it: `"no-note"` (no Markdown view with a file), `"reading-mode"` (the note is
 *    open in reading mode; it has no selection to replace, `acceptPanel` refuses that mode anyway), `"no-selection"` (nothing or only
 *    blanks selected). `view` is the view found, or `null`.
 *  - It reads, it never writes and keeps no state: a plugin that wants to show the readiness while the user selects calls it on
 *    `selectionchange` itself (vault-rag `src/main.ts:703`, lingotuner `src/main.ts:204`, both debounced, both skip their own panel),
 *    and refreshes its panel from the answer.
 *
 *  Origin, both read, not converted: vault-rag `src/main.ts:295-313` (`captureSelection`) and lingotuner `src/obsidian/editor-io.ts:14-45`
 *  (`SelectionTracker.capture`, a copy of the first). Their differences, each settled:
 *  - Which view: vault-rag `getActiveViewOfType`, lingotuner `getMostRecentLeaf(rootSplit)`. Drift; the kit takes `mainMarkdownView`
 *    (lingotuner's way plus pop-outs), so the call works with the focus in the panel.
 *  - When no view is in front, both keep the capture they had. That is state of the carrier, kept there; with `mainMarkdownView` the
 *    case is rare (no note open at all), and the kit answers `"no-note"` instead of an old capture of a note that may be closed.
 *  - `noteLines`: only lingotuner. Taken: `acceptPanel` needs it to find the selection again.
 *  - A missing file is `no-editor` (vault-rag) or `no-note` (lingotuner): one case, named `no-note`.
 *  - lingotuner also captures the whole note body after the front matter as its second source: a lingotuner feature, it stays there.
 *  - Texts: lingotuner's (they say what to do; vault-rag's name its own feature, „Formatting not possible …“, and stay a plugin
 *    override). */

import type { App, MarkdownView } from "obsidian";
import type { Target } from "../kit/panel-session";
import { mainMarkdownView, type MainMarkdownViewOptions } from "./main-markdown-view";

export type CapturedSelection = Extract<Target, { kind: "selection" }>;

export type SelectionCaptureReason = "no-note" | "reading-mode" | "no-selection";

export interface SelectionCaptureStrings {
  noNote: string;
  readingMode: string;
  noSelection: string;
  /** The `label` of the target, from the note name without `.md`. */
  label: (noteName: string) => string;
}

export type SelectionCaptureStringsOverride = Partial<SelectionCaptureStrings> & { lang?: "en" | "de" };

export const SELECTION_CAPTURE_STRINGS_EN: SelectionCaptureStrings = {
  noNote: "Open a note in the main area first.",
  readingMode: "The note is in reading mode — switch to editing mode to use it.",
  noSelection: "Select some text in a note first.",
  label: (name) => `Selection in ${name}`,
};

export const SELECTION_CAPTURE_STRINGS_DE: SelectionCaptureStrings = {
  noNote: "Öffne zuerst eine Notiz im Hauptbereich.",
  readingMode: "Die Notiz ist im Lesemodus — in den Bearbeitungsmodus wechseln.",
  noSelection: "Markiere zuerst Text in einer Notiz.",
  label: (name) => `Markierung in ${name}`,
};

/** The base texts of `lang` (default English), with the given fields replaced. */
export function resolveSelectionCaptureStrings(override?: SelectionCaptureStringsOverride): SelectionCaptureStrings {
  const base = override?.lang === "de" ? SELECTION_CAPTURE_STRINGS_DE : SELECTION_CAPTURE_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<SelectionCaptureStrings>) };
}

export type SelectionCapture =
  | { ok: true; target: CapturedSelection; view: MarkdownView }
  | { ok: false; reason: SelectionCaptureReason; message: string; view: MarkdownView | null };

export interface CaptureSelectionOptions extends MainMarkdownViewOptions {
  strings?: SelectionCaptureStringsOverride;
}

/** The selection of the note the user means as an `acceptPanel` target, or the reason there is none; see the module comment. */
export function captureSelection(app: App, options: CaptureSelectionOptions = {}): SelectionCapture {
  const strings = resolveSelectionCaptureStrings(options.strings);
  const main = mainMarkdownView(app, options);
  if (main === null) return { ok: false, reason: "no-note", message: strings.noNote, view: null };
  const { view, file, editor } = main;
  if (editor === null) return { ok: false, reason: "reading-mode", message: strings.readingMode, view };
  const text = editor.getSelection();
  if (text.trim() === "") return { ok: false, reason: "no-selection", message: strings.noSelection, view };
  return {
    ok: true,
    view,
    target: {
      kind: "selection", path: file.path, from: editor.getCursor("from"), to: editor.getCursor("to"),
      label: strings.label(file.basename), text, noteLines: editor.lineCount(),
    },
  };
}
