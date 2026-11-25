// vendored from obsidian-kit@0.109.1, src/obsidian/version-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Versionsliste (UI-STANDARD §8, Listen-Zeile): der Verlauf mehrerer Stände als klickbare,
 * nummerierte Liste — Rückwahl auf einen früheren Stand.
 *
 * ## Warum dieses Modul nur die Liste baut
 *
 * Nachschärfen ist Probieren, und der dritte Versuch kann schlechter sein als der erste. Ohne
 * Verlauf wäre der erste dann verloren. Die Grammatik kommt aus
 * `obsidian-transmute/src/obsidian/view-render.ts` (`versionList`: Überschrift, nummerierte
 * Zeilen als `button`, aktive Zeile hervorgehoben, ab zwei Einträgen sichtbar), und die steht
 * dort ihrerseits als Muster aus `image-to-markdown` (`syncRefineLog`) und `lingotuner`
 * (Rundenleiste). Die drei Exemplare wurden gelesen, nicht kopiert; ihre Unterschiede sind
 * fachlicher Inhalt (Beschriftung, Treffer-Zähler, Zeitangabe) und stehen hier als Parameter
 * `label` und `meta`. Das Modul kennt weder Runden noch Schnappschüsse; den Zustand dazu liefert
 * `code-kit` `pure/rounds`, die Aufbewahrung `pure/rotation`.
 *
 * ## Verhalten
 *
 * - **`minItems` (Default 2).** Unter der Schwelle baut das Modul nichts und gibt `null`
 *   zurück: eine einzige Runde hat nichts zur Rückwahl. Für Schnappschüsse `1` — schon einer
 *   ist ein Rückweg.
 * - **`group`.** Ein Eintrag mit `group` bekommt beim Gruppenwechsel eine Zwischenüberschrift
 *   (Heute / Tage / Wochen / Monate). Nummerierung und `active` laufen über alle Gruppen
 *   durch — es ist **eine** Liste, ihr Index ist der Index in `items`. Die Reihenfolge ist die
 *   der Eingabe; sortiert wird nicht (wer gruppiert, übergibt die Einträge bereits geordnet).
 * - **Zustands-Knopf-Regel (§8).** Jede Zeile ist ein `button` mit `aria-pressed` und der
 *   Klasse `is-active`; die Tastatur bedient sie, weil es echte Knöpfe sind.
 * - **`mode: "select" | "action"` (seit 0.60.1).** `select` (Default) ist die Auswahl eines Standes, jede Zeile ein Zustands-Knopf.
 *   `action` ist für Listen, deren Klick etwas AUSLÖST (Zurückholen-Dialog öffnen, Version laden): keine Zeile trägt `aria-pressed`
 *   oder `is-active`, und jeder Klick ruft `onSelect`. Ein Screenreader kündigte sonst einen Umschalter an, wo ein Aktionsknopf ist
 *   (Befund sa-build 2026-10-03, settings-assistant). `active` ist dort bedeutungslos und seit 0.61.0 weglassbar (der Typ ist eine
 *   diskriminierte Union über `mode`: ohne `mode` oder mit `select` bleibt `active` Pflicht, damit eine vergessene Markierung nicht still bleibt).
 * - **Ein Klick auf die aktive Zeile ruft `onSelect` nicht** (nur in `select`). Auswahl des gewählten Standes ist
 *   keine Änderung; der Aufrufer braucht den Vergleich nicht selbst.
 * - **Das Modul zeichnet nicht neu.** Wer den Zustand ändert, leert den Elternknoten und ruft
 *   `buildVersionList` erneut — wie die Plugins ihre Panels ohnehin neu aufbauen.
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Das Kit injiziert kein CSS.** `VERSION_LIST_CSS` gehört in die `styles.css` des
 *    Consumers (Muster von `STREAM_AREA_CSS`/`HUB_CSS`).
 * 2. **Der Rückgabewert kann `null` sein** (unter `minItems`).
 */

export interface VersionListItem {
  /** Die Beschriftung der Zeile — fachlicher Inhalt, kommt vom Aufrufer. */
  label: string;
  /** Rechts in der Zeile, gedämpft (Treffer-Zähler, relative Zeit). */
  meta?: string;
  /** Zwischenüberschrift beim Wechsel zur nächsten Gruppe. */
  group?: string;
}

interface VersionListBase {
  items: readonly VersionListItem[];
  /** Wird mit dem Index der geklickten Zeile gerufen — nicht für die aktive (nur in `select`). */
  onSelect(index: number): void;
  /** Überschrift über der Liste. Ohne sie liest sich die Liste wie Teil des Ergebnisses. */
  heading?: string;
  /** Ab so vielen Einträgen wird die Liste gebaut. Default 2. */
  minItems?: number;
}

/** `select` (Default): Auswahl eines Standes, §8-Zustands-Knopf; `active` ist Pflicht. */
export interface VersionListSelectOptions extends VersionListBase {
  mode?: "select";
  /** Index in `items` des gewählten Standes; −1 oder außerhalb markiert keine Zeile. */
  active: number;
}

/** `action`: jede Zeile löst etwas aus, kein `aria-pressed`, kein `is-active`. `active` entfällt (seit 0.61.0); ein übergebener Wert wird ignoriert. */
export interface VersionListActionOptions extends VersionListBase {
  mode: "action";
  active?: number;
}

export type VersionListOptions = VersionListSelectOptions | VersionListActionOptions;

/** Baut die Liste in `parent`. Unter `minItems` passiert nichts und der Rückgabewert ist `null`. */
export function buildVersionList(parent: HTMLElement, opts: VersionListOptions): HTMLElement | null {
  const { items } = opts;
  const action = opts.mode === "action";
  const active = opts.active ?? -1;
  if (items.length < (opts.minItems ?? 2)) return null;

  const root = parent.createDiv({ cls: "okit-vlist" });
  if (opts.heading !== undefined) root.createDiv({ text: opts.heading, cls: "okit-vlist-heading" });
  const list = root.createDiv({ cls: "okit-vlist-items" });

  let lastGroup: string | undefined;
  items.forEach((item, index) => {
    if (item.group !== undefined && item.group !== lastGroup) {
      list.createDiv({ text: item.group, cls: "okit-vlist-group" });
    }
    if (item.group !== undefined) lastGroup = item.group;

    const isActive = !action && index === active;
    const row = list.createEl("button", { cls: "okit-vlist-row", attr: { type: "button" } });
    if (!action) {
      row.toggleClass("is-active", isActive);
      row.setAttribute("aria-pressed", String(isActive));
    }
    row.createSpan({ text: `${index + 1}.`, cls: "okit-vlist-no" });
    // `title` mit dem vollen Text: in einer schmalen Leiste kürzt das CSS beide Spalten mit einer Ellipse.
    row.createSpan({ text: item.label, cls: "okit-vlist-label", attr: { title: item.label } });
    if (item.meta !== undefined) row.createSpan({ text: item.meta, cls: "okit-vlist-meta", attr: { title: item.meta } });
    row.addEventListener("click", () => {
      if (action || index !== active) opts.onSelect(index);
    });
  });
  return root;
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS. Nur Theme-Variablen. */
export const VERSION_LIST_CSS = `
.okit-vlist {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  margin-bottom: var(--size-4-2);
}

.okit-vlist-heading,
.okit-vlist-group {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}

.okit-vlist-group {
  margin-top: var(--size-4-1);
  color: var(--text-faint);
}

.okit-vlist-items {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
}

.okit-vlist-row {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-1);
  width: 100%;
  text-align: left;
  padding: var(--size-2-2) var(--size-4-1);
  background-color: transparent;
  box-shadow: none;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.okit-vlist-row:hover {
  background-color: var(--background-modifier-hover);
}

.okit-vlist-row:focus-visible {
  box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
}

.okit-vlist-row.is-active {
  background-color: var(--background-modifier-hover);
  color: var(--text-normal);
}

.okit-vlist-no {
  color: var(--text-faint);
  flex-shrink: 0;
}

/* Schmale Seitenleiste (Befund Diachronic, 2026-10-22): die Meta-Spalte war starr und verdrängte das Label. Jetzt ist die Meta auf 45 %
   der Zeile gedeckelt und wird mit einer Ellipse gekürzt (der volle Text steht im title); das Label darf unter seinen Inhalt schrumpfen
   (min-width: 0), sonst ließe die automatische Mindestgröße von Flex-Items die Zeile überlaufen. */
.okit-vlist-meta {
  color: var(--text-faint);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.okit-vlist-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
