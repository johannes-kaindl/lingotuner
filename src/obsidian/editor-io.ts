// uebernommen aus vault-rag/src/main.ts (captureSelection) und obsidian-transmute/src/obsidian/editor-io.ts (activeMarkdownView), 2026-09-07.
// Geschrieben wird seit Kit 0.111.0 nur noch ueber den Rahmen (`acceptPanel`, Ziel `selection`/`file`); die frueheren Wege `replaceCapture` und `createTunedNote` sind entfallen.
import { MarkdownView, type Workspace } from "obsidian";
import { EMPTY_CAPTURE, noteName, splitFrontmatter, type Capture, type CaptureState } from "../core/source";

/** Die zuletzt genutzte Notiz im Hauptbereich — NICHT getActiveViewOfType: sobald man ins
 *  Seitenpanel klickt, IST das Panel die aktive Ansicht. rootSplit klammert die Sidebars aus. */
export function activeMarkdownView(workspace: Workspace): MarkdownView | null {
  const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
  return leaf?.view instanceof MarkdownView ? leaf.view : null;
}

/** Schreibt den Editor-Stand mit, weil ein Klick ins Panel den Editor-Fokus nimmt: zum Zeitpunkt des Knopfdrucks gibt es keine Markierung mehr. */
export class SelectionTracker {
  private state: CaptureState = EMPTY_CAPTURE;

  constructor(private readonly workspace: Workspace) {}

  /** Liegt gerade KEIN Markdown-View vorn (Fokus im Panel), bleibt der gemerkte Stand stehen —
   *  genau dafuer existiert die Mitschrift. */
  capture(): void {
    const view = activeMarkdownView(this.workspace);
    if (view === null) return;
    if (view.getMode() !== "source") { this.state = { selection: null, note: null, blocked: "reading-mode" }; return; }
    const file = view.file;
    if (!file) { this.state = { selection: null, note: null, blocked: "no-note" }; return; }
    const editor = view.editor;
    const name = noteName(file.path);

    const value = editor.getValue();
    const { head, body } = splitFrontmatter(value);
    const note: Capture = {
      kind: "note", path: file.path, name, text: body,
      from: editor.offsetToPos(head.length), to: editor.offsetToPos(value.length),
    };

    const sel = editor.getSelection();
    const selection: Capture | null = sel.trim() === "" ? null : {
      kind: "selection", path: file.path, name, text: sel,
      from: editor.getCursor("from"), to: editor.getCursor("to"), noteLines: editor.lineCount(),
    };

    this.state = { selection, note, blocked: null };
  }

  get(): CaptureState { return this.state; }
}
