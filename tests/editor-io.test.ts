import { describe, it, expect } from "vitest";
import { MarkdownView, TFile } from "./__mocks__/obsidian";
import type { App } from "obsidian";
import { SelectionTracker } from "../src/obsidian/editor-io";
import "../src/i18n/strings";

function scene(content: string, mode: "source" | "preview" = "source") {
  const view = new MarkdownView({} as never);
  view.file = new TFile("A/Mail.md", "md");
  view.editor.setValue(content);
  view.getMode = () => mode;
  const leaf = { view };
  // Der Fokus liegt im Panel: keine aktive Markdown-Ansicht, die Notiz kommt ueber die zuletzt genutzte Ansicht (Kit `mainMarkdownView`, Schritt „recent“).
  const workspace = {
    rootSplit: {},
    getActiveViewOfType: () => null,
    getMostRecentLeaf: () => leaf,
    getLeavesOfType: () => [leaf],
  };
  const app = { workspace } as unknown as App;
  return { view, workspace, tracker: new SelectionTracker(app, () => "de") };
}

describe("SelectionTracker", () => {
  it("merkt Notiz-Body ohne Frontmatter und die Markierung", () => {
    const s = scene("---\nt: 1\n---\nHallo Welt");
    s.view.editor.setSelection({ line: 3, ch: 0 }, { line: 3, ch: 5 });
    s.tracker.capture();
    const st = s.tracker.get();
    expect(st.note?.text).toBe("Hallo Welt");
    expect(st.note?.name).toBe("Mail");
    expect(st.selection?.text).toBe("Hallo");
    expect(st.blocked).toBeNull();
  });

  it("ohne Markierung: selection null, Notiz bleibt", () => {
    const s = scene("Text");
    s.tracker.capture();
    expect(s.tracker.get().selection).toBeNull();
    expect(s.tracker.get().note?.text).toBe("Text");
  });

  it("Lesemodus blockiert beides", () => {
    const s = scene("Text", "preview");
    s.tracker.capture();
    expect(s.tracker.get()).toMatchObject({ selection: null, note: null, blocked: "reading-mode" });
  });

  it("Fokus im Panel: die Notiz kommt ueber die zuletzt genutzte Ansicht", () => {
    const s = scene("Hallo Welt");
    s.view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    s.tracker.capture();
    expect(s.tracker.get()).toMatchObject({ blocked: null, selection: { text: "Hallo", path: "A/Mail.md", name: "Mail" } });
  });

  it("gar keine Notiz offen: „keine Notiz“ statt des alten Stands (Kit captureSelection, seit 0.112.0)", () => {
    const s = scene("Text");
    s.tracker.capture();
    s.workspace.getMostRecentLeaf = () => ({ view: {} }) as never;
    s.tracker.capture();
    expect(s.tracker.get()).toMatchObject({ selection: null, note: null, blocked: "no-note" });
  });

  it("Markierung traegt die Zeilenzahl der Notiz (noteLines, fuer das Wiederfinden im Kit)", () => {
    const s = scene("A\nB\nC");
    s.view.editor.setSelection({ line: 1, ch: 0 }, { line: 1, ch: 1 });
    s.tracker.capture();
    expect(s.tracker.get().selection).toMatchObject({ text: "B", from: { line: 1, ch: 0 }, to: { line: 1, ch: 1 }, noteLines: 3 });
  });
});
