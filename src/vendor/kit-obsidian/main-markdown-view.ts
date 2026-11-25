// vendored from obsidian-kit@0.112.0, src/obsidian/main-markdown-view.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Which note the user means while the focus is in a plugin's side panel. `getActiveViewOfType(MarkdownView)` is `null` then: the panel
 *  is the active view, and `workspace.activeEditor` is `null` too. {@link mainMarkdownView} answers with the Markdown view of the note
 *  the user worked in last, with its file and, in editing mode, its editor; a view without a file never counts.
 *
 *  Order of the fallbacks, each named in `via`:
 *  1. `"active"`: the active view, if it is a Markdown view with a file (the focus is in a note: a command, a hotkey, a ribbon
 *     button, a note opened in a sidebar).
 *  2. `"recent"`: `workspace.getMostRecentLeaf()` WITHOUT an argument, which per the API (`obsidian.d.ts`, since 0.15.4) searches the
 *     `rootSplit` and the pop-out windows and leaves the sidebars out (koda-agent `src/obsidian/workspace.ts:8`, named there). With
 *     `popouts: false` it is `getMostRecentLeaf(rootSplit)` (main window only), as six carriers called it.
 *  3. `"first"`: only with `firstLeaf: true`, the first Markdown leaf with a file (`getLeavesOfType("markdown")`). Off by default: no
 *     carrier did it, and a write into a note the user did not pick is worse than the reason "no note".
 *
 *  `editor` is `null` outside editing mode (`getMode() !== "source"`; live preview counts as source): `replaceRange` in reading
 *  mode has no effect, so a writer must not take it (diachronic `src/obsidian/editor-io.ts:11`, best exemplar).
 *
 *  Origin (Divergenz-Lauf 2026-11-25, Weg B; read, not converted): diachronic `src/obsidian/editor-io.ts:11` (`activeDoc`, file and
 *  editor only in source mode), svg-studio `src/main.ts:194` and 3d-codeblocks `src/main.ts:541` (`lastEditor`: rootSplit plus a
 *  remembered view for pop-outs, which the no-argument call makes unnecessary), epub-exporter `src/obsidian/hub-view.ts:12` (file only),
 *  lingotuner `src/obsidian/editor-io.ts:8` and obsidian-transmute `src/obsidian/editor-io.ts:13` (`activeMarkdownView`, no file
 *  check), yijing-oracle `src/obsidian/reading-writer.ts:150`, koda-agent `src/obsidian/workspace.ts:8`.
 *
 *  Seam in the kit (not changed here): `AcceptEnv.lastEditor()` of `panel-accept` is supplied by each plugin; `() =>
 *  mainMarkdownView(app)?.view ?? null` is the call that fills it. `insertAtCursor(view, …)` takes the view it is given.
 *
 *  Measured in the real Obsidian: pilot `pilot/notiz-ziel.ts` (part B). */

import { MarkdownView, type App, type Editor, type TFile } from "obsidian";

export type MainMarkdownVia = "active" | "recent" | "first";

export interface MainMarkdownView {
  view: MarkdownView;
  file: TFile;
  /** The editor in editing mode (source or live preview), `null` in reading mode. */
  editor: Editor | null;
  via: MainMarkdownVia;
}

export interface MainMarkdownViewOptions {
  /** Count the leaves of pop-out windows in step 2. Default `true`. */
  popouts?: boolean;
  /** Step 3: fall back to the first Markdown leaf with a file. Default `false`. */
  firstLeaf?: boolean;
}

function asNote(view: unknown, via: MainMarkdownVia): MainMarkdownView | null {
  if (!(view instanceof MarkdownView) || !view.file) return null;
  return { view, file: view.file, editor: view.getMode() === "source" ? view.editor : null, via };
}

/** The Markdown view the user means, or `null`; see the module comment for the order. */
export function mainMarkdownView(app: App, options: MainMarkdownViewOptions = {}): MainMarkdownView | null {
  const { workspace } = app;
  const active = asNote(workspace.getActiveViewOfType(MarkdownView), "active");
  if (active) return active;
  const leaf = options.popouts === false ? workspace.getMostRecentLeaf(workspace.rootSplit) : workspace.getMostRecentLeaf();
  const recent = asNote(leaf?.view, "recent");
  if (recent) return recent;
  if (options.firstLeaf === true) {
    for (const l of workspace.getLeavesOfType("markdown")) {
      const first = asNote(l.view, "first");
      if (first) return first;
    }
  }
  return null;
}
