import { describe, it, expect } from "vitest";
import { EMPTY_SESSION, addRound, selectRound, activeRound, refineInput, rootRound, rootInput, rootSourceName, type Round } from "../src/core/session";
import { NEUTRAL } from "../src/core/dials";

const round = (n: number, basedOn: number | null = null): Round => ({
  dials: { ...NEUTRAL, social: 1 }, note: "", input: `in${n}`, output: `out${n}`, model: "m", at: n, basedOn,
  sourceName: basedOn === null ? `note${n}` : null, aborted: false, truncated: false,
});

describe("session", () => {
  it("leer: keine aktive Runde, kein Nachschaerf-Input", () => {
    expect(activeRound(EMPTY_SESSION)).toBeNull();
    expect(refineInput(EMPTY_SESSION)).toBeNull();
  });

  it("addRound haengt an und macht die neue Runde aktiv", () => {
    const s = addRound(addRound(EMPTY_SESSION, round(1)), round(2, 0));
    expect(s.rounds).toHaveLength(2);
    expect(s.active).toBe(1);
    expect(activeRound(s)?.output).toBe("out2");
  });

  it("selectRound wechselt zurueck, spaetere Runden bleiben", () => {
    const s = selectRound(addRound(addRound(EMPTY_SESSION, round(1)), round(2, 0)), 0);
    expect(s.active).toBe(0);
    expect(s.rounds).toHaveLength(2);
    expect(refineInput(s)).toBe("out1");
  });

  it("selectRound ignoriert Indizes ausserhalb und liefert dasselbe Objekt", () => {
    const s = addRound(EMPTY_SESSION, round(1));
    expect(selectRound(s, 5)).toBe(s);
    expect(selectRound(s, -1)).toBe(s);
  });

  it("Nachschaerfen nach Rueckwahl haengt hinten an, ohne abzuschneiden", () => {
    let s = addRound(addRound(EMPTY_SESSION, round(1)), round(2, 0));
    s = selectRound(s, 0);
    s = addRound(s, round(3, s.active));
    expect(s.rounds.map((r) => r.output)).toEqual(["out1", "out2", "out3"]);
    expect(s.rounds[2].basedOn).toBe(0);
    expect(s.active).toBe(2);
  });

  it("ist immutable: addRound veraendert die Eingabe nicht", () => {
    const a = addRound(EMPTY_SESSION, round(1));
    addRound(a, round(2));
    expect(a.rounds).toHaveLength(1);
  });
});

describe("Wurzel der Runden-Kette", () => {
  it("leere Session: keine Wurzel, keine Wurzel-Eingabe, kein Quellname", () => {
    expect(rootRound(EMPTY_SESSION)).toBeNull();
    expect(rootInput(EMPTY_SESSION)).toBeNull();
    expect(rootSourceName(EMPTY_SESSION)).toBeNull();
  });

  it("Runde ohne Kette ist ihre eigene Wurzel", () => {
    const s = addRound(EMPTY_SESSION, round(1));
    expect(rootRound(s)?.output).toBe("out1");
    expect(rootInput(s)).toBe("in1");
    expect(rootSourceName(s)).toBe("note1");
  });

  it("Kette 0→1→2, aktiv 2: Wurzel ist Runde 0", () => {
    let s = addRound(EMPTY_SESSION, round(1));
    s = addRound(s, round(2, 0));
    s = addRound(s, round(3, 1));
    expect(s.active).toBe(2);
    expect(rootRound(s)?.output).toBe("out1");
    expect(rootInput(s)).toBe("in1");
    expect(rootSourceName(s)).toBe("note1");
  });

  it("Rueckwahl auf 1: Wurzel bleibt Runde 0", () => {
    let s = addRound(EMPTY_SESSION, round(1));
    s = addRound(s, round(2, 0));
    s = addRound(s, round(3, 1));
    s = selectRound(s, 1);
    expect(rootInput(s)).toBe("in1");
    expect(rootSourceName(s)).toBe("note1");
  });

  it("abgebrochene Zwischenrunde mit basedOn: Wurzel bleibt Runde 0", () => {
    let s = addRound(EMPTY_SESSION, round(1));
    s = addRound(s, { ...round(2, 0), aborted: true, model: "" });
    s = addRound(s, round(3, 1));
    expect(rootInput(s)).toBe("in1");
    expect(rootSourceName(s)).toBe("note1");
  });

  it("Wurzel aus dem Textfeld hat keinen Quellnamen", () => {
    const s = addRound(EMPTY_SESSION, { ...round(1), sourceName: null });
    expect(rootInput(s)).toBe("in1");
    expect(rootSourceName(s)).toBeNull();
  });
});
