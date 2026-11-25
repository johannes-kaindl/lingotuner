// Die Markierungs-Haelfte ist seit obsidian-kit 0.112.0 der Kit-Baustein `captureSelection` (K1, Welle 38); eigen bleibt die zweite Quelle, die ganze Notiz ohne Frontmatter.
// Geschrieben wird nur ueber den Rahmen (`acceptPanel`, Ziel `selection`/`file`).
import type { App } from "obsidian";
import { captureSelection } from "../vendor/kit-obsidian/capture-selection";
import { splitFrontmatter } from "../vendor/kit/frontmatter";
import { EMPTY_CAPTURE, noteName, type Capture, type CaptureState } from "../core/source";

/** Schreibt den Editor-Stand mit, weil ein Klick ins Panel den Editor-Fokus nimmt: zum Zeitpunkt des Knopfdrucks gibt es keine Markierung mehr.
 *  Welche Notiz gemeint ist, sagt der Kit (`mainMarkdownView`: die zuletzt genutzte Notiz im Hauptbereich oder in einem Pop-out, auch mit dem Fokus im Panel);
 *  ist gar keine Notiz offen, heisst das „keine Notiz“ statt eines alten Stands einer vielleicht geschlossenen Notiz. */
export class SelectionTracker {
  private state: CaptureState = EMPTY_CAPTURE;

  constructor(private readonly app: App, private readonly lang: () => "en" | "de") {}

  capture(): void {
    const sel = captureSelection(this.app, { strings: { lang: this.lang() } });
    if (!sel.ok && sel.reason !== "no-selection") { this.state = { selection: null, note: null, blocked: sel.reason }; return; }
    const view = sel.view;
    const file = view?.file;
    if (!view || !file) { this.state = { selection: null, note: null, blocked: "no-note" }; return; }
    const editor = view.editor;
    const name = noteName(file.path);

    const value = editor.getValue();
    const { head, body } = splitFrontmatter(value);
    const note: Capture = {
      kind: "note", path: file.path, name, text: body,
      from: editor.offsetToPos(head.length), to: editor.offsetToPos(value.length),
    };

    const selection: Capture | null = sel.ok
      ? { kind: "selection", path: sel.target.path, name, text: sel.target.text, from: sel.target.from, to: sel.target.to, noteLines: sel.target.noteLines }
      : null;

    this.state = { selection, note, blocked: null };
  }

  get(): CaptureState { return this.state; }
}
