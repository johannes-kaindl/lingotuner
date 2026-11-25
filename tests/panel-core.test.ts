/** Der reine Kern des Panels seit dem Umbau auf den Kit-Rahmen (Welle 37): Ziel aus der Quelle, Lauf mit Eingabe aus Ziel oder aktiver Runde, Notiz ersetzen. */
import { describe, it, expect, vi } from "vitest";
import "../src/i18n/strings";
import { targetFor, noteReplacement } from "../src/core/target";
import { createTuneRun, type TuneCall } from "../src/core/panel-run";
import { freshSession, type Round, type TuneSession } from "../src/core/session";
import { EMPTY_CAPTURE, type CaptureState } from "../src/core/source";
import { NEUTRAL, type Dials } from "../src/core/dials";
import type { TuneResult } from "../src/core/llm/client";
import type { HostRunCall, HostRunIo } from "../src/vendor/kit/panel-host";
import { pushRound, selectRound } from "../src/vendor/kit/rounds";
import { t } from "../src/vendor/kit/i18n";

const labels = { selection: (n: string) => `sel:${n}`, note: (n: string) => `note:${n}`, blocked: (r: { kind: string }) => `blocked:${r.kind}` };
const state: CaptureState = {
  selection: { kind: "selection", path: "a/Mail.md", name: "Mail", text: "Hallo Welt", from: { line: 2, ch: 0 }, to: { line: 3, ch: 4 } },
  note: { kind: "note", path: "a/Mail.md", name: "Mail", text: "Body", from: { line: 0, ch: 0 }, to: { line: 5, ch: 0 } },
  blocked: null,
};

describe("targetFor — Quelle wird Ziel", () => {
  it("Notiz → file mit Pfad und Name", () => {
    expect(targetFor("note", state, labels)).toEqual({ kind: "file", path: "a/Mail.md", label: "note:Mail" });
  });
  it("Markierung → selection mit Spanne und markiertem Text als Fingerabdruck; noteLines nur, wenn mitgeschrieben", () => {
    expect(targetFor("selection", state, labels)).toEqual({ kind: "selection", path: "a/Mail.md", from: { line: 2, ch: 0 }, to: { line: 3, ch: 4 }, label: "sel:Mail", text: "Hallo Welt" });
    const withLines = { ...state, selection: { ...state.selection!, noteLines: 7 } };
    expect(targetFor("selection", withLines, labels)).toMatchObject({ kind: "selection", noteLines: 7 });
  });
  it("eingefuegter Text → new, auch leer", () => {
    expect(targetFor("text", EMPTY_CAPTURE, labels)).toEqual({ kind: "new" });
  });
  it("Quelle nicht bereit → other mit dem Grund (der Rahmen sperrt Senden)", () => {
    expect(targetFor("selection", { ...state, selection: null }, labels)).toEqual({ kind: "other", label: "blocked:no-selection" });
    expect(targetFor("note", { selection: null, note: null, blocked: "reading-mode" }, labels)).toEqual({ kind: "other", label: "blocked:reading-mode" });
  });
});

describe("noteReplacement — Notiz ersetzen", () => {
  const p = { gone: "weg", changed: "geaendert" };
  it("Frontmatter bleibt, der Body wird das Ergebnis", () => {
    expect(noteReplacement("---\na: 1\n---\nalt", "alt", "neu", p)).toEqual({ ok: true, text: "---\na: 1\n---\nneu" });
  });
  it("ohne Frontmatter: ganzer Text", () => {
    expect(noteReplacement("alt", "alt", "neu", p)).toEqual({ ok: true, text: "neu" });
  });
  it("Body seit dem Lauf geaendert → abgelehnt", () => {
    expect(noteReplacement("alt und mehr", "alt", "neu", p)).toEqual({ ok: false, problem: "geaendert" });
  });
  it("Notiz weg → abgelehnt", () => {
    expect(noteReplacement(null, "alt", "neu", p)).toEqual({ ok: false, problem: "weg" });
  });
});

const round = (n: number, basedOn: number | null, sourceName: string | null = "Mail"): Round => ({
  dials: { ...NEUTRAL, social: 1 }, note: "", input: `in${n}`, output: `out${n}`, model: "m", at: n, basedOn, sourceName, truncated: false,
});

function io(): HostRunIo & { tokens: string[] } {
  const tokens: string[] = [];
  return { tokens, start: vi.fn(), clearAnswer: vi.fn(), onToken: (x) => { tokens.push(x); }, onReasoning: vi.fn(), onContentReset: vi.fn(), setStatus: vi.fn() };
}

function call(session: TuneSession, instruction = "", signal = new AbortController().signal): HostRunCall<TuneSession> & { io: ReturnType<typeof io> } {
  return { session, instruction, signal, model: "fallback", io: io() };
}

function deps(result: TuneResult, dials: Dials = { ...NEUTRAL, directness: -1 }) {
  const seen: TuneCall[] = [];
  return {
    seen,
    d: {
      dials: () => dials,
      sourceOf: vi.fn(() => Promise.resolve({ text: "Quelle", name: "Mail" })),
      tune: vi.fn((c: TuneCall) => { seen.push(c); c.onToken("tok"); return Promise.resolve(result); }),
      now: () => 42,
    },
  };
}

const ok: TuneResult = { ok: true, text: "Ergebnis", reasoning: "", model: "gemma", truncated: false };

describe("createTuneRun — der Lauf des Panels", () => {
  it("alle Regler Mitte und leere Anmerkung: Fehlertext, kein Modellaufruf", async () => {
    const { d } = deps(ok, { ...NEUTRAL });
    const r = await createTuneRun(d)(call(freshSession({ kind: "new" })));
    expect(r).toEqual({ ok: false, kind: "error", message: t("run.noop") });
    expect(d.tune).not.toHaveBeenCalled();
  });

  it("Gegenprobe: Mitte, aber eine Anmerkung → der Lauf geht", async () => {
    const { d } = deps(ok, { ...NEUTRAL });
    const r = await createTuneRun(d)(call(freshSession({ kind: "new" }), "duzen"));
    expect(r.ok).toBe(true);
  });

  it("ohne Runde: Eingabe aus dem Ziel, Runde mit basedOn null und Quellname, Token laufen in den Puffer des Halters", async () => {
    const { d, seen } = deps(ok);
    const c = call(freshSession({ kind: "new" }), "kurz");
    const r = await createTuneRun(d)(c);
    expect(seen[0]?.text).toBe("Quelle");
    expect(seen[0]?.note).toBe("kurz");
    expect(c.io.start).toHaveBeenCalled();
    expect(c.io.tokens).toEqual(["tok"]);
    if (!r.ok) throw new Error("erwartet ok");
    expect(r.session.rounds.rounds).toEqual([{ ...round(0, null), dials: { ...NEUTRAL, directness: -1 }, note: "kurz", input: "Quelle", output: "Ergebnis", model: "gemma", at: 42 }]);
    expect(r.message).toBe(t("status.done"));
  });

  it("mit Runden: Nachschaerfen baut auf der AKTIVEN Runde auf, der Quellname kommt von der Wurzel", async () => {
    const { d, seen } = deps(ok);
    let s = freshSession({ kind: "new" });
    s = { ...s, rounds: selectRound(pushRound(pushRound(s.rounds, round(1, null)), round(2, 0, null)), 0) };
    const r = await createTuneRun(d)(call(s));
    expect(d.sourceOf).not.toHaveBeenCalled();
    expect(seen[0]?.text).toBe("out1");
    if (!r.ok) throw new Error("erwartet ok");
    const neu = r.session.rounds.rounds[2];
    expect(neu?.basedOn).toBe(0);
    expect(neu?.sourceName).toBe("Mail");
    expect(r.session.rounds.active).toBe(2);
  });

  it("fromSource: auch mit Runden aus der Quelle, basedOn null", async () => {
    const { d, seen } = deps(ok);
    const s: TuneSession = { ...freshSession({ kind: "new" }), rounds: pushRound(freshSession({ kind: "new" }).rounds, round(1, null)) };
    const r = await createTuneRun(d, { fromSource: true })(call(s));
    expect(seen[0]?.text).toBe("Quelle");
    if (!r.ok) throw new Error("erwartet ok");
    expect(r.session.rounds.rounds[1]?.basedOn).toBeNull();
  });

  it("Ziel nicht lesbar: der Grund steht in der Statuszeile, kein Modellaufruf", async () => {
    const { d } = deps(ok);
    d.sourceOf.mockImplementation(() => Promise.resolve({ problem: "keine Notiz" }) as never);
    const r = await createTuneRun(d)(call(freshSession({ kind: "new" })));
    expect(r).toEqual({ ok: false, kind: "error", message: "keine Notiz" });
    expect(d.tune).not.toHaveBeenCalled();
  });

  it("Abbruch: keine Runde (der Halter verwirft ohnehin), auch wenn noch ein Ergebnis kam", async () => {
    const ac = new AbortController();
    const { d } = deps(ok);
    d.tune.mockImplementation(() => { ac.abort(); return Promise.resolve(ok); });
    expect(await createTuneRun(d)(call(freshSession({ kind: "new" }), "", ac.signal))).toEqual({ ok: false, kind: "aborted" });
  });

  it("Fehler des Endpunkts: Meldung aus den Texten des Plugins", async () => {
    const { d } = deps({ ok: false, error: { kind: "network" }, partial: "" });
    expect(await createTuneRun(d)(call(freshSession({ kind: "new" })))).toEqual({ ok: false, kind: "error", message: t("error.network") });
  });

  it("abgeschnittene Antwort: Runde mit truncated, Statuszeile sagt es", async () => {
    const { d } = deps({ ...ok, truncated: true });
    const r = await createTuneRun(d)(call(freshSession({ kind: "new" })));
    if (!r.ok) throw new Error("erwartet ok");
    expect(r.session.rounds.rounds[0]?.truncated).toBe(true);
    expect(r.message).toBe(t("status.truncated"));
  });
});
