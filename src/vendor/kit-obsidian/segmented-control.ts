// vendored from obsidian-kit@0.113.0, src/obsidian/segmented-control.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Segment-Schalter (UI-STANDARD §8, Zustands-Knopf für mehr als zwei Stellungen): eine Gruppe von Knöpfen, von denen
 * genau einer gewählt ist — „Aus · Beschreibung · Ganz".
 *
 * ## Warum ein Baustein
 *
 * `koda-agent/src/obsidian/skill-segment.ts` (Welle 24) hatte die erste Fassung für drei feste Stellungen; die Suche vom
 * 2026-10-18 fand im Bestand kein zweites `radiogroup`. Ein Zustands-Knopf mit zwei Stellungen ist ein `aria-pressed`-Knopf,
 * mit drei oder mehr ist er eine Radiogruppe — und die richtig zu bauen (Rollen, Roving-Tabindex, Pfeiltasten) ist genau
 * die Arbeit, die man nicht zweimal machen will. Die Optionen kommen als `{value, label}[]`, das Kit kennt keine Modi.
 *
 * ## Verhalten
 *
 * - **Radio-Muster (CORE-META-20).** `role="radiogroup"` mit `aria-label`, je Knopf `role="radio"` und `aria-checked`. Nur der
 *   gewählte Knopf ist per Tab erreichbar (`tabindex="0"`, die anderen `-1`); innerhalb der Gruppe wechseln die Pfeiltasten
 *   (rechts/unten vor, links/oben zurück, am Ende ringsum) sowie Home und Ende. Ein Pfeil **wählt** und fokussiert den Nachbarn,
 *   wie bei nativen Radios. Fehlt der gewählte Wert in den Optionen, ist der erste Knopf der Tab-Einstieg und keiner gewählt.
 * - **Zweiter Kanal neben der Farbe.** Der gewählte Knopf trägt `is-active` und im CSS einen anderen Schnitt (halbfett) plus
 *   Rand; die Beschriftung bleibt Text (Rot-Grün-Schwäche, WCAG 1.4.1). Das Label zeigt den Ist-Zustand, nie die Aktion.
 * - **Das Modul schaltet selbst um** und meldet danach `onChange(value)`. Wer eine Wahl ablehnt (Speichern schlug fehl),
 *   setzt sie mit `setValue` zurück; `setValue` meldet nichts, weil der Aufrufer es ja gerade selbst tut.
 * - **Das Kit injiziert kein CSS.** `SEGMENTED_CONTROL_CSS` gehört in die `styles.css` des Consumers.
 */

export interface SegmentOption<V extends string = string> {
  value: V;
  /** Sichtbare Beschriftung — vom Consumer übersetzt, das Kit schreibt keine Sprache fest (UI-STANDARD §10). */
  label: string;
  /** Tooltip (`title`) am Knopf, z. B. was die Stellung bewirkt. */
  title?: string;
}

export interface SegmentedControlOptions<V extends string = string> {
  options: readonly SegmentOption<V>[];
  /** Der gewählte Wert. */
  value: V;
  /** Name der Gruppe für Screenreader (`aria-label`), z. B. „Modus von Skill X". */
  ariaLabel: string;
  /** Wird nach einer Wahl durch Klick oder Tastatur gemeldet, nicht bei `setValue`. */
  onChange: (value: V) => void;
  /** Zusätzliche Klassen an der Wurzel, durch Leerraum getrennt — der Design-Scope des Consumers. */
  cls?: string;
}

export interface SegmentedControl<V extends string = string> {
  readonly rootEl: HTMLElement;
  value(): V;
  /** Wählt programmatisch, ohne `onChange`. Ein Wert, den keine Option trägt, wird ignoriert. */
  setValue(value: V): void;
  /** Sperrt alle Knöpfe und die Tastatur (`disabled` und `aria-disabled`). */
  setDisabled(disabled: boolean): void;
}

export function buildSegmentedControl<V extends string = string>(parent: HTMLElement, opts: SegmentedControlOptions<V>): SegmentedControl<V> {
  const rootEl = parent.createDiv({ cls: "okit-segmented", attr: { role: "radiogroup", "aria-label": opts.ariaLabel } });
  // Obsidians addClass wirft bei einem Leerzeichen (InvalidCharacterError) — mehrere Klassen einzeln.
  for (const c of (opts.cls ?? "").split(/\s+/)) if (c !== "") rootEl.addClass(c);

  let current: V = opts.value;
  let disabled = false;
  const buttons: HTMLElement[] = [];

  const paint = (): void => {
    const idx = opts.options.findIndex((o) => o.value === current);
    buttons.forEach((b, i) => {
      const on = i === idx;
      b.setAttribute("aria-checked", String(on));
      b.toggleClass("is-active", on);
      // Roving-Tabindex: genau ein Einstieg für Tab; ohne Treffer der erste Knopf.
      b.setAttribute("tabindex", on || (idx < 0 && i === 0) ? "0" : "-1");
    });
  };

  const choose = (index: number, focus: boolean): void => {
    const opt = opts.options[index];
    if (opt === undefined || disabled) return;
    if (focus) buttons[index]?.focus();
    if (opt.value === current) return;
    current = opt.value;
    paint();
    opts.onChange(opt.value);
  };

  opts.options.forEach((opt, index) => {
    const attr: Record<string, string> = { type: "button", role: "radio", "data-value": opt.value };
    if (opt.title !== undefined) attr.title = opt.title;
    const btn = rootEl.createEl("button", { cls: "okit-segmented-btn", text: opt.label, attr });
    btn.addEventListener("click", () => { choose(index, false); });
    btn.addEventListener("keydown", (e: KeyboardEvent) => {
      const n = opts.options.length;
      let target: number;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") target = (index + 1) % n;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") target = (index - 1 + n) % n;
      else if (e.key === "Home") target = 0;
      else if (e.key === "End") target = n - 1;
      else return;
      e.preventDefault();
      choose(target, true);
    });
    buttons.push(btn);
  });
  paint();

  return {
    rootEl,
    value: () => current,
    setValue(value: V): void {
      if (!opts.options.some((o) => o.value === value)) return;
      current = value;
      paint();
    },
    setDisabled(on: boolean): void {
      disabled = on;
      for (const b of buttons) {
        if (on) { b.setAttribute("disabled", ""); b.setAttribute("aria-disabled", "true"); }
        else { b.removeAttribute("disabled"); b.removeAttribute("aria-disabled"); }
      }
    },
  };
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS.
 *  Nur Theme-Variablen, keine harten Farben oder Größen (UI-STANDARD). */
export const SEGMENTED_CONTROL_CSS = `
.okit-segmented {
  display: inline-flex; flex-wrap: nowrap; align-items: stretch;
  border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s);
  background: var(--background-secondary); overflow: hidden;
}
.okit-segmented-btn {
  flex: 0 0 auto; margin: 0; padding: var(--size-2-1) var(--size-4-2);
  border: 0; border-radius: 0; box-shadow: none;
  background: transparent; color: var(--text-muted);
  font-size: var(--font-ui-small); cursor: var(--cursor);
}
.okit-segmented-btn + .okit-segmented-btn { border-inline-start: 1px solid var(--background-modifier-border); }
.okit-segmented-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
/* Der gewählte Knopf unterscheidet sich im Schnitt UND durch die Fläche, nicht nur durch Farbe (WCAG 1.4.1). */
.okit-segmented-btn.is-active {
  background: var(--background-primary); color: var(--text-normal); font-weight: var(--font-semibold);
  box-shadow: inset 0 -2px 0 var(--interactive-accent);
}
.okit-segmented-btn:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
.okit-segmented-btn:disabled { color: var(--text-faint); cursor: not-allowed; }
/* Am Telefon eine Tippfläche von mindestens 44 px (Welle 38, K4; vorher rund 21 px bei allen Trägern). Drei Selektorteile mit Element: die Kit-Mobilregel, damit Obsidians Knopfregeln am Telefon nicht gewinnen. */
.is-mobile .okit-segmented button.okit-segmented-btn {
  min-height: calc(var(--size-4-10) + var(--size-4-1));
  min-width: calc(var(--size-4-10) + var(--size-4-1));
  padding-inline: var(--size-4-3);
}
`;
