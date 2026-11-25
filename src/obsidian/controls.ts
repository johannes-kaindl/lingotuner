/** Station 3 des Kit-Rahmens (Slot `renderControls`): Quelle, Voreinstellungen, vier Regler. Das Auftragsfeld (die Anmerkung), Senden und Abbrechen zeichnet der Rahmen.
 *
 *  Der Rahmen zeichnet diesen Slot neu, wenn sich Sitzung oder Sperre aendern, und sperrt im Lauf alle Knoepfe und Felder darin. Ein Reglerzug aendert eine
 *  Einstellung, nicht die Sitzung: er zieht Stufenname und Voreinstellungs-Marke an Ort und Stelle nach, statt neu zu zeichnen (ein Neuaufbau zoege den gegriffenen
 *  Regler unter dem Zeiger weg). */
import { setIcon } from "obsidian";
import { DIMENSIONS, levelKey, presetFor, type Dials, type Dimension, type Level, type Preset } from "../core/dials";
import { readinessKey, type Readiness, type SourceKind } from "../core/source";
import { t } from "../vendor/kit/i18n";
import { buildSegmentedControl } from "../vendor/kit-obsidian/segmented-control";

export interface ControlsModel {
  source: SourceKind;
  readiness: Readiness;
  freeText: string;
  dials: Dials;
  presets: Preset[];
}

export interface ControlsHandlers {
  onSource(k: SourceKind): void;
  onFreeText(v: string): void;
  onDial(dim: Dimension, level: Level): void;
  onPreset(id: string): void;
  onSavePreset(): void;
}

export function readinessLine(r: Readiness, source: SourceKind): string {
  if (r.kind !== "ready") return t(readinessKey(r));
  if (source === "text") return t("source.ready.text", String(r.chars));
  return t(source === "selection" ? "source.ready.selection" : "source.ready.note", String(r.chars), r.name ?? "");
}

/** Zustands-Knopf (UI-STANDARD § 8): `aria-pressed` und `is-active` neben der Farbe. */
function chip(row: HTMLElement, text: string, cls: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const b = row.createEl("button", { text, cls, attr: { type: "button" } });
  b.toggleClass("is-active", active);
  b.setAttribute("aria-pressed", String(active));
  b.addEventListener("click", onClick);
  return b;
}

export function renderControls(host: HTMLElement, m: ControlsModel, h: ControlsHandlers): void {
  const box = host.createDiv({ cls: "lt-controls" });

  // Quelle: ein Segment-Schalter mit drei Stellungen (Kit `buildSegmentedControl`, UI-STANDARD § 8): Radiogruppe mit Pfeiltasten, am Telefon 44 px (K4).
  buildSegmentedControl<SourceKind>(box, {
    options: (["selection", "note", "text"] as const).map((k) => ({ value: k, label: t(`source.${k}`) })),
    value: m.source,
    ariaLabel: t("source.group"),
    cls: "lt-sources",
    onChange: (k) => { h.onSource(k); },
  });
  const line = box.createDiv({ cls: "lt-source-line", text: readinessLine(m.readiness, m.source) });
  line.toggleClass("is-blocked", m.readiness.kind !== "ready");
  if (m.source === "text") {
    const ta = box.createEl("textarea", { cls: "lt-freetext", attr: { rows: "6", "aria-label": t("source.text") } });
    ta.placeholder = t("source.textPlaceholder");
    ta.value = m.freeText;
    ta.addEventListener("input", () => {
      h.onFreeText(ta.value);
      line.setText(readinessLine(ta.value.trim() === "" ? { kind: "empty-text" } : { kind: "ready", text: ta.value, chars: ta.value.length, name: null }, "text"));
    });
  }

  const presetId = presetFor(m.dials, m.presets);
  const presets = box.createDiv({ cls: "lt-presets", attr: { role: "group", "aria-label": t("preset.group") } });
  const chips = m.presets.map((p) => chip(presets, p.label ?? t(`preset.${p.id}`), "lt-preset-chip", presetId === p.id, () => { h.onPreset(p.id); }));
  // Fester Platzhalter, kein bedingtes Element: ein Reglerzug schaltet ihn um, ohne die Zeile neu zu bauen.
  const custom = presets.createSpan({ text: presetId === null ? t("preset.custom") : "", cls: "lt-preset-custom" });
  const save = presets.createEl("button", { cls: "lt-preset-save clickable-icon", attr: { type: "button", "aria-label": t("preset.save") } });
  setIcon(save, "save");
  save.addEventListener("click", () => { h.onSavePreset(); });

  let dials: Dials = { ...m.dials };
  const dialBox = box.createDiv({ cls: "lt-dials" });
  for (const d of DIMENSIONS) {
    const row = dialBox.createDiv({ cls: "lt-dial" });
    const head = row.createDiv({ cls: "lt-dial-head" });
    head.createSpan({ text: t(`dial.${d}`), cls: "lt-dial-name" });
    const level = head.createSpan({ text: t(levelKey(d, dials[d])), cls: "lt-dial-level" });
    const dialLine = row.createDiv({ cls: "lt-dial-line" });
    dialLine.createSpan({ text: t(`dial.${d}.left`), cls: "lt-dial-pole" });
    const input = dialLine.createEl("input", {
      cls: "lt-dial-input",
      attr: { type: "range", min: "-2", max: "2", step: "1", value: String(dials[d]), "data-dim": d },
    });
    input.setAttribute("aria-label", t("dial.aria", t(`dial.${d}`), t(`dial.${d}.left`), t(`dial.${d}.right`)));
    input.setAttribute("aria-valuetext", t(levelKey(d, dials[d])));
    input.addEventListener("input", () => {
      const l = Number(input.value) as Level;
      dials = { ...dials, [d]: l };
      level.setText(t(levelKey(d, l)));
      input.setAttribute("aria-valuetext", t(levelKey(d, l)));
      const id = presetFor(dials, m.presets);
      m.presets.forEach((p, i) => {
        const b = chips[i];
        if (b === undefined) return;
        b.toggleClass("is-active", id === p.id);
        b.setAttribute("aria-pressed", String(id === p.id));
      });
      custom.setText(id === null ? t("preset.custom") : "");
      h.onDial(d, l);
    });
    dialLine.createSpan({ text: t(`dial.${d}.right`), cls: "lt-dial-pole" });
  }
}
