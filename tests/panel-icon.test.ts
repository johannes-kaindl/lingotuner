/**
 * Das Icon des Panels hat EINEN Namen, den Ribbon-Knopf (`main.ts`) und Tab (`getIcon()`) gemeinsam lesen.
 * `sliders-horizontal` gehoert settings-assistant und koda-agent; ein Name an zwei Orten war die Ursache der Dopplung.
 */
import { describe, it, expect } from "vitest";
import { LingoTunerView, PANEL_ICON } from "../src/obsidian/view";

describe("Panel-Icon", () => {
  it("getIcon() liefert PANEL_ICON", () => {
    const view = new LingoTunerView({ app: {} } as never, {} as never);
    expect(view.getIcon()).toBe(PANEL_ICON);
  });

  it("PANEL_ICON ist nicht das Icon der Schwester-Plugins", () => {
    expect(PANEL_ICON).not.toBe("sliders-horizontal");
  });
});
