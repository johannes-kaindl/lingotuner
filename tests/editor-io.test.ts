import { describe, it, expect } from "vitest";
import { MarkdownView, TFile } from "./__mocks__/obsidian";
import type { Workspace, App } from "obsidian";
import { SelectionTracker, replaceCapture, createTunedNote } from "../src/obsidian/editor-io";
import "../src/i18n/strings";

function scene(content: string, mode: "source" | "preview" = "source") {
  const view = new MarkdownView({} as never);
  view.file = new TFile("A/Mail.md", "md");
  view.editor.setValue(content);
  view.getMode = () => mode;
  const leaf = { view };
  const workspace = {
    rootSplit: {},
    getMostRecentLeaf: () => leaf,
    getLeavesOfType: () => [leaf],
  } as unknown as Workspace;
  return { view, workspace, tracker: new SelectionTracker(workspace) };
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

  it("ohne MarkdownView bleibt der alte Stand stehen (Panel hat den Fokus)", () => {
    const s = scene("Text");
    s.tracker.capture();
    (s.workspace as unknown as { getMostRecentLeaf: () => unknown }).getMostRecentLeaf = () => ({ view: {} });
    s.tracker.capture();
    expect(s.tracker.get().note?.text).toBe("Text");
  });

  it("isLive: gleicher Editor, gleicher Pfad, source-Modus", () => {
    const s = scene("Text");
    s.tracker.capture();
    const cap = s.tracker.get().note!;
    expect(s.tracker.isLive(cap)).toBe(true);
    s.view.file = new TFile("B/Andere.md", "md");
    expect(s.tracker.isLive(cap)).toBe(false);
  });

  it("ein zweites capture() laesst ein aelteres Capture live, solange Editor, Datei und Modus gleich sind", () => {
    const s = scene("alt");
    s.tracker.capture();
    const cap = s.tracker.get().note!;
    s.tracker.capture();
    expect(s.tracker.isLive(cap)).toBe(true);
    expect(replaceCapture(s.tracker, cap, "neu")).toBe("ok");
    expect(s.view.editor.getValue()).toBe("neu");
  });
});

describe("replaceCapture", () => {
  it("ersetzt die Markierung mit erhaltenem Rand-Whitespace", () => {
    const s = scene("A\n\n  alt\nB");
    s.view.editor.setSelection({ line: 1, ch: 0 }, { line: 3, ch: 0 });
    s.tracker.capture();
    const cap = s.tracker.get().selection!;
    expect(cap.text).toBe("\n  alt\n");
    expect(replaceCapture(s.tracker, cap, "neu")).toBe("ok");
    expect(s.view.editor.getValue()).toBe("A\n\nneu\nB");
  });

  it("ersetzt den Notiz-Body, Frontmatter bleibt", () => {
    const s = scene("---\nt: 1\n---\nalt");
    s.tracker.capture();
    expect(replaceCapture(s.tracker, s.tracker.get().note!, "neu")).toBe("ok");
    expect(s.view.editor.getValue()).toBe("---\nt: 1\n---\nneu");
  });

  it("verweigert bei veraendertem Text (stale) und bei geschlossener Notiz (not-live)", () => {
    const s = scene("alt");
    s.tracker.capture();
    const cap = s.tracker.get().note!;
    s.view.editor.setValue("alt geaendert");
    expect(replaceCapture(s.tracker, cap, "neu")).toBe("stale");
    s.view.getMode = () => "preview";
    expect(replaceCapture(s.tracker, cap, "neu")).toBe("not-live");
  });
});

describe("createTunedNote", () => {
  it("legt die Datei im Ordner an und weicht bei Namenskollision aus", async () => {
    const files = new Map<string, string>();
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) => (files.has(p) || p === "Out" ? {} : null),
        createFolder: () => Promise.resolve(),
        create: (p: string, c: string) => { files.set(p, c); return Promise.resolve(new TFile(p, "md")); },
      },
    } as unknown as App;
    const a = await createTunedNote(app, "Out", "Mail", "x");
    const b = await createTunedNote(app, "Out", "Mail", "y");
    expect(a.path).toBe("Out/Mail (tuned).md");
    expect(b.path).toBe("Out/Mail (tuned) 2.md");
    expect(files.get("Out/Mail (tuned) 2.md")).toBe("y");
  });

  it("legt bei leerem Ordner in der Vault-Wurzel an", async () => {
    const files = new Map<string, string>();
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) => (files.has(p) ? {} : null),
        createFolder: () => { throw new Error("darf bei Wurzel nicht gerufen werden"); },
        create: (p: string, c: string) => { files.set(p, c); return Promise.resolve(new TFile(p, "md")); },
      },
    } as unknown as App;
    const f = await createTunedNote(app, "", "Mail", "x");
    expect(f.path).toBe("Mail (tuned).md");
  });
});
