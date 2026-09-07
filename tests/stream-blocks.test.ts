import { describe, it, expect } from "vitest";
import { splitStable } from "../src/core/stream-blocks";

describe("splitStable", () => {
  it("schneidet an der letzten Absatzgrenze", () => {
    expect(splitStable("A\n\nB\n\nC lae")).toEqual({ stable: "A\n\nB\n\n", tail: "C lae" });
  });
  it("eine Leerzeile im offenen Codeblock ist keine Grenze", () => {
    expect(splitStable("```\nx\n\ny")).toEqual({ stable: "", tail: "```\nx\n\ny" });
  });
  it("ohne Grenze bleibt alles tail", () => {
    expect(splitStable("nur eine Zeile")).toEqual({ stable: "", tail: "nur eine Zeile" });
  });
});
