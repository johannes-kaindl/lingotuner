// vendored from obsidian-kit@0.112.0, src/obsidian/system-prompt-setting.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Setting } from "obsidian";
import type { SettingDefinitionRender, TextAreaComponent } from "obsidian";
import { effectivePrompt, normalizePromptOverride, promptPlaceholder } from "../kit/prompt-override";
import { copyToClipboard } from "./clipboard";
import { buildStatus, paintStatus } from "./status-indicator";

/** UI-STANDARD §8 „Systemprompt-Einstellung“ (seit 0.110.0): eine ausgelieferte Vorgabe (Systemprompt, Regelblock) ersetzbar machen, ohne sie einzufrieren.
 *  Bestes Exemplar ist koda-agent (`src/obsidian/model-control.ts`, `renderPromptRow`), Ursprung yijing-oracle (`src/obsidian/settings/llm-section.ts`, `promptRow`); vault-rag
 *  (`src/settings.ts`, schlichtes Textfeld) bringt die Altvorgaben (`legacy`). Die Logik dazu liegt in code-kit `pure/prompt-override`.
 *
 *  Vertrag:
 *  - Der gespeicherte Wert bleibt leer, bis er wirklich abweicht; leer heißt „der ausgelieferte Text gilt“ und folgt späteren Verbesserungen. Der ausgelieferte Text steht nur als
 *    Platzhalter im Feld (wäre er der Wert, fröre er beim ersten Öffnen ein).
 *  - Gespeichert wird bei jeder Änderung (`onChange`, nie erst bei `blur`: ein Escape bei fokussiertem Feld feuert kein `blur`, koda-agent Fix-Runde 4), und zwar normalisiert:
 *    der ausgelieferte Text oder eine Altvorgabe, unverändert gelassen oder zurückkopiert, wird `""` (`normalizePromptOverride`).
 *  - „Mitgelieferten Prompt bearbeiten“ lädt den ausgelieferten Text ins Feld, nur wenn es leer ist, und speichert nichts.
 *  - „Zurücksetzen“ schreibt `""`. Steht eigener Text im Feld, kommt er vorher in die Zwischenablage, und das Feld wird erst geleert, wenn das Kopieren gelungen ist
 *    (Eingaben nie verlieren). Kein Neuaufbau des Tabs: ein `display()` zwischen `mousedown` und `click` verschluckte in koda-agent den Klick.
 *  - Benannte Platzhalter (`placeholders`, etwa `sprache`) nennt die Beschreibung als `{{sprache}}`; eingesetzt werden sie beim Senden mit `fillPromptPlaceholders`.
 *  - `warnings` (optional) bekommt den wirksamen Text und liefert Warnzeilen; gezeichnet als §8-Status-Indikator (Symbol, Farbe, Klasse, `aria-label`) beim Aufbau, bei `blur`,
 *    nach Laden und Zurücksetzen — nicht je Tastendruck (das Neuzeichnen nähme den Cursor nicht mit, ist hier aber auch unnötig). Was eine Warnung auslöst, entscheidet das Plugin.
 *
 *  Styles: `SYSTEM_PROMPT_SETTING_CSS`, mit `warnings` zusätzlich `STATUS_INDICATOR_CSS`, beide wortgleich in die `styles.css` des Plugins. Texte vom Plugin (Kit bleibt i18n-frei); EN/DE
 *  unten sind Vorgaben zum Durchreichen oder Überlagern (`strings: { lang: "de", name: "Regeln" }`, Teil-Merge wie bei `buildLinkSettings`). */
export interface SystemPromptSettingStrings {
  name: string;
  /** Beschreibung; mit `placeholders` folgt ihr `placeholdersHint`. */
  desc: string;
  /** `{list}` wird durch die Platzhalter ersetzt (`{{sprache}}, {{ordner}}`). */
  placeholdersHint: string;
  load: string;
  loadTooltip: string;
  /** Tooltip des Kopier-Knopfs — dort der einzige zugängliche Name. */
  copy: string;
  copied: string;
  /** Tooltip des Zurücksetzen-Knopfs. */
  reset: string;
  /** Notice, wenn beim Zurücksetzen eigener Text in die Zwischenablage ging. */
  resetCopied: string;
  /** Notice, wenn er sich nicht kopieren ließ und deshalb stehen bleibt. */
  resetKept: string;
  copyFailed: string;
}

export interface SystemPromptSettingStringsOverride extends Partial<SystemPromptSettingStrings> {
  lang?: "en" | "de";
}

export interface SystemPromptSettingOptions {
  /** Gespeicherter Wert; `""` heißt ausgeliefert. */
  value: string;
  /** Der ausgelieferte Text, wie er im Feld als Platzhalter steht (Platzhalter `{{…}}` unaufgelöst). */
  shipped: string;
  /** Frühere ausgelieferte Texte, die eine alte Version in die Einstellungen kopiert hat: sie gelten als „nicht geändert“. */
  legacy?: readonly string[];
  /** Namen der benannten Platzhalter, die das Plugin beim Senden einsetzt (ohne Klammern). */
  placeholders?: readonly string[];
  /** Der neue, schon normalisierte Wert. Der Aufrufer speichert. */
  onChange: (value: string) => void | Promise<void>;
  /** Warnzeilen zum wirksamen Text (leer: keine). */
  warnings?: (effective: string) => readonly string[];
  /** Zeilen des Feldes; Vorgabe 8. */
  rows?: number;
  strings?: SystemPromptSettingStringsOverride;
}

export interface SystemPromptSettingHandle {
  setting: Setting;
  textarea: TextAreaComponent;
}

export const SYSTEM_PROMPT_SETTING_STRINGS_EN: SystemPromptSettingStrings = {
  name: "System prompt",
  desc: "Leave empty to use the shipped prompt; it then follows later updates.",
  placeholdersHint: "Placeholders: {list}",
  load: "Edit shipped prompt",
  loadTooltip: "Loads the shipped prompt into the empty field",
  copy: "Copy the prompt in use",
  copied: "Prompt copied",
  reset: "Reset to the shipped prompt",
  resetCopied: "Your previous prompt is in the clipboard",
  resetKept: "Could not copy your prompt, so it was kept",
  copyFailed: "Copy failed",
};

export const SYSTEM_PROMPT_SETTING_STRINGS_DE: SystemPromptSettingStrings = {
  name: "Systemprompt",
  desc: "Leer lassen, dann gilt der mitgelieferte Prompt und folgt späteren Updates.",
  placeholdersHint: "Platzhalter: {list}",
  load: "Mitgelieferten Prompt bearbeiten",
  loadTooltip: "Lädt den mitgelieferten Prompt in das leere Feld",
  copy: "Geltenden Prompt kopieren",
  copied: "Prompt kopiert",
  reset: "Auf den mitgelieferten Prompt zurücksetzen",
  resetCopied: "Dein bisheriger Prompt liegt in der Zwischenablage",
  resetKept: "Dein Prompt ließ sich nicht kopieren und bleibt deshalb stehen",
  copyFailed: "Kopieren fehlgeschlagen",
};

/** Default der Sprache (EN ohne Angabe), Feld für Feld von `override` überlagert; ein ausdrückliches `undefined` überschreibt nichts. */
export function resolveSystemPromptSettingStrings(override?: SystemPromptSettingStringsOverride): SystemPromptSettingStrings {
  const base = override?.lang === "de" ? SYSTEM_PROMPT_SETTING_STRINGS_DE : SYSTEM_PROMPT_SETTING_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<SystemPromptSettingStrings>) };
}

/** Beschreibung samt Platzhalter-Hinweis — auch für die `desc` der Definition (Suche). */
export function systemPromptSettingDesc(s: SystemPromptSettingStrings, placeholders: readonly string[] = []): string {
  if (placeholders.length === 0) return s.desc;
  return `${s.desc} ${s.placeholdersHint.split("{list}").join(placeholders.map(promptPlaceholder).join(", "))}`;
}

function applySystemPromptSetting(setting: Setting, opts: SystemPromptSettingOptions): TextAreaComponent {
  const s = resolveSystemPromptSettingStrings(opts.strings);
  const legacy = opts.legacy ?? [];
  setting.setName(s.name).setDesc(systemPromptSettingDesc(s, opts.placeholders));
  // Das Feld braucht die ganze Zeilenbreite: neben Name und Beschreibung bekam es vom Flex-Container nur ~18 px (gemessen in koda-agent, 1.13).
  setting.settingEl.addClass("okit-sysprompt-setting");

  let field: TextAreaComponent | null = null;
  let loadButton: { setDisabled(d: boolean): unknown } | null = null;
  const current = (): string => (field === null ? opts.value : field.getValue());
  const checkLoad = (): void => { loadButton?.setDisabled(current().trim() !== ""); };

  // Idempotent: der native Pfad (>= 1.13) ruft `render` erneut auf dieselbe Zeile auf, ohne `settingEl` zu leeren.
  setting.settingEl.querySelectorAll<HTMLElement>(".okit-sysprompt-warnings").forEach((old) => { old.remove(); });
  const warningsEl = opts.warnings ? setting.settingEl.createDiv({ cls: "okit-sysprompt-warnings" }) : null;
  const drawWarnings = (): void => {
    if (warningsEl === null || !opts.warnings) return;
    warningsEl.empty();
    for (const text of opts.warnings(effectivePrompt(current(), opts.shipped, legacy))) {
      paintStatus(buildStatus(warningsEl, "okit-sysprompt-warning"), "warning", text);
    }
  };
  const store = (v: string): void => { void opts.onChange(normalizePromptOverride(v, opts.shipped, legacy)); };

  setting
    .addTextArea((ta) => {
      field = ta;
      ta.setPlaceholder(opts.shipped).setValue(opts.value);
      ta.inputEl.rows = opts.rows ?? 8;
      ta.inputEl.addClass("okit-sysprompt-textarea");
      ta.onChange((v) => { store(v); checkLoad(); });
      ta.inputEl.addEventListener("blur", () => { drawWarnings(); });
    })
    .addButton((b) => {
      loadButton = b;
      b.setButtonText(s.load).setTooltip(s.loadTooltip).onClick(() => {
        if (field === null || field.getValue().trim() !== "") return;
        // Nur ins Feld, nicht in die Einstellungen: ein Text, den niemand anrührt, ist keine Abweichung.
        field.setValue(opts.shipped);
        field.inputEl.focus();
        checkLoad();
        drawWarnings();
      });
      checkLoad();
    })
    .addExtraButton((b) =>
      b.setIcon("copy").setTooltip(s.copy).onClick(() => {
        // Der Text, der jetzt gilt (Platzhalter unaufgelöst) — zum Aufheben vor dem Überschreiben.
        void copyToClipboard(effectivePrompt(current(), opts.shipped, legacy), { copiedMessage: s.copied, failedMessage: s.copyFailed });
      }),
    )
    .addExtraButton((b) =>
      b.setIcon("rotate-ccw").setTooltip(s.reset).onClick(() => {
        const own = current();
        const clear = (): void => {
          field?.setValue("");
          store("");
          checkLoad();
          drawWarnings();
        };
        if (own.trim() === "") { clear(); return; }
        void copyToClipboard(own, { copiedMessage: s.resetCopied, failedMessage: s.resetKept }).then((ok) => { if (ok) clear(); });
      }),
    );

  drawWarnings();
  // `field` ist hier gesetzt: `addTextArea` ruft den Rückruf synchron.
  return field as unknown as TextAreaComponent;
}

/** Für Tabs mit `display()`: die Zeile unter `containerEl`. */
export function buildSystemPromptSetting(containerEl: HTMLElement, opts: SystemPromptSettingOptions): SystemPromptSettingHandle {
  const setting = new Setting(containerEl);
  const textarea = applySystemPromptSetting(setting, opts);
  return { setting, textarea };
}

/** Dieselbe Zeile als deklarative Definition (Render-Hatch) für Tabs mit `getSettingDefinitions()`; Name und Beschreibung stehen auch an der Definition (Suche). */
export function systemPromptSettingDefinition(opts: SystemPromptSettingOptions): SettingDefinitionRender {
  const s = resolveSystemPromptSettingStrings(opts.strings);
  return { name: s.name, desc: systemPromptSettingDesc(s, opts.placeholders), render: (setting) => { applySystemPromptSetting(setting, opts); } };
}

/** Styles der Zeile; Konsumenten kopieren die Konstante wortgleich in ihre `styles.css` (Kit-Vertrag). Nur Theme-Variablen. Mit `warnings` gehört STATUS_INDICATOR_CSS dazu. */
export const SYSTEM_PROMPT_SETTING_CSS = `
.okit-sysprompt-setting { flex-wrap: wrap; }
.okit-sysprompt-setting > .setting-item-control { flex: 1 1 100%; flex-wrap: wrap; justify-content: flex-start; }
.okit-sysprompt-textarea { width: 100%; min-height: 8em; font-family: var(--font-monospace); }
.okit-sysprompt-warnings { flex: 1 1 100%; display: flex; flex-direction: column; gap: var(--size-4-1); margin-top: var(--size-4-1); }
.okit-sysprompt-warnings:empty { display: none; }
`;
