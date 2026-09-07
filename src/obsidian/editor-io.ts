// uebernommen aus vault-rag/src/main.ts (captureSelection/captureIsLive) und obsidian-transmute/src/obsidian/editor-io.ts (activeMarkdownView), 2026-09-07
import { MarkdownView, normalizePath, type App, type Editor, type TFile, type Workspace } from "obsidian";
import {
  EMPTY_CAPTURE, isRangeStale, noteName, splitFrontmatter, splitSelectionAffix,
  type Capture, type CaptureState,
} from "../core/source";
import { t } from "../vendor/kit/i18n";

/** Die zuletzt genutzte Notiz im Hauptbereich — NICHT getActiveViewOfType: sobald man ins
 *  Seitenpanel klickt, IST das Panel die aktive Ansicht. rootSplit klammert die Sidebars aus. */
export function activeMarkdownView(workspace: Workspace): MarkdownView | null {
  const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
  return leaf?.view instanceof MarkdownView ? leaf.view : null;
}

export class SelectionTracker {
  private state: CaptureState = EMPTY_CAPTURE;
  /** WeakMap statt Map, NIE neu zugewiesen und NIE geleert: ein frueher per `get()`
   *  herausgereichtes Capture (z.B. das Panel waehrend eines 30-Sekunden-Streams) behaelt
   *  seinen Editor auch dann, wenn ein spaeteres `capture()` (selectionchange,
   *  active-leaf-change) die Karte fuer NEUE Captures weiterschreibt. Eintraege sterben mit
   *  dem Capture-Objekt selbst (GC) statt mit dem naechsten `capture()`-Lauf. Fix-Runde 1,
   *  Review-Befund: ein neu gebautes `Map` liess `isLive(altesCapture)` auf `false` fallen,
   *  obwohl Editor/Datei/Modus unveraendert waren (vault-rag haengt den Editor direkt ans
   *  Capture und hat das Problem nicht). */
  private readonly editors = new WeakMap<Capture, Editor>();

  constructor(private readonly workspace: Workspace) {}

  /** Liegt gerade KEIN Markdown-View vorn (Fokus im Panel), bleibt der gemerkte Stand stehen —
   *  genau dafuer existiert die Mitschrift. */
  capture(): void {
    const view = activeMarkdownView(this.workspace);
    if (view === null) return;
    if (view.getMode() !== "source") { this.set({ selection: null, note: null, blocked: "reading-mode" }); return; }
    const file = view.file;
    if (!file) { this.set({ selection: null, note: null, blocked: "no-note" }); return; }
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
      from: editor.getCursor("from"), to: editor.getCursor("to"),
    };

    this.editors.set(note, editor);
    if (selection !== null) this.editors.set(selection, editor);
    this.state = { selection, note, blocked: null };
  }

  private set(next: CaptureState): void {
    this.state = next;
  }

  get(): CaptureState { return this.state; }

  editorFor(cap: Capture): Editor | null { return this.editors.get(cap) ?? null; }

  /** Ein Editor gehoert zur VIEW, nicht zur Datei — er ueberlebt einen Notiz-Wechsel im
   *  selben Pane. Deshalb Identitaet + Modus + Pfad. */
  isLive(cap: Capture): boolean {
    const editor = this.editorFor(cap);
    if (editor === null) return false;
    return this.workspace.getLeavesOfType("markdown").some((leaf) =>
      leaf.view instanceof MarkdownView
      && leaf.view.editor === editor
      && leaf.view.getMode() === "source"
      && leaf.view.file?.path === cap.path);
  }
}

export type WriteOutcome = "ok" | "not-live" | "stale";

/** Schreibt ueber den Editor (Cmd+Z). Zwei Guards vor jedem Schreiben: Liveness + Staleness.
 *
 *  Abweichung vom Brief: fuer `kind: "note"` wird die Staleness gegen das aktuelle
 *  Dokumentende geprueft (`editor.offsetToPos(editor.getValue().length)`), nicht gegen das
 *  bei der Aufnahme eingefrorene `cap.to`. Grund: `cap.to` markiert bei der Notiz-Aufnahme das
 *  damalige Ende des Dokuments; wird nach dem Text am Ende NUR angehaengt, deckt sich das feste
 *  Praefix bis `cap.to` zufaellig weiter mit dem gemerkten Body, und eine echte Aenderung faellt
 *  durch den Guard (belegt: Test „verweigert bei veraendertem Text (stale)"). Fuer `kind:
 *  "selection"` bleibt `cap.to` massgeblich — die Markierung ist eine begrenzte Spanne, kein
 *  Dokumentende. */
export function replaceCapture(tracker: SelectionTracker, cap: Capture, text: string): WriteOutcome {
  if (!tracker.isLive(cap)) return "not-live";
  const editor = tracker.editorFor(cap);
  if (editor === null) return "not-live";
  const staleTo = cap.kind === "note" ? editor.offsetToPos(editor.getValue().length) : cap.to;
  if (isRangeStale(editor.getRange(cap.from, staleTo), cap.text)) return "stale";
  if (cap.kind === "selection") {
    const { lead, trail } = splitSelectionAffix(cap.text);
    editor.replaceRange(lead + text + trail, cap.from, cap.to);
  } else {
    editor.replaceRange(text, cap.from, cap.to);
  }
  return "ok";
}

export async function createTunedNote(app: App, folder: string, baseName: string, text: string): Promise<TFile> {
  const dir = normalizePath(folder.trim());
  const atRoot = dir === "" || dir === "/";
  if (!atRoot && app.vault.getAbstractFileByPath(dir) === null) await app.vault.createFolder(dir);
  const stem = `${baseName} ${t("out.newNoteSuffix")}`;
  const pathFor = (n: number): string => normalizePath(`${atRoot ? "" : `${dir}/`}${stem}${n === 1 ? "" : ` ${n}`}.md`);
  let n = 1;
  while (app.vault.getAbstractFileByPath(pathFor(n)) !== null) n += 1;
  return app.vault.create(pathFor(n), text);
}
