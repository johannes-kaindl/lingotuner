// vendored from obsidian-kit@0.110.0, src/obsidian/prompt-panel-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Texte des Auftrags-Fensters (`prompt-panel.ts`), Deutsch und Englisch vollständig, formatneutral.
// Herkunft: svg-studio@0.1.4 `src/i18n/strings.ts` (`panelStrings()` und die Schlüssel `panel.*`, `run.aborted`, `run.start`, `accept.backupFailed`),
// dort an das Format gebunden („Neues SVG“, „Panel“); hier ohne Format. Das Plugin überschreibt, was fachlich seins ist: Platzhalter, Beispiele,
// Name des Ziels (`PromptPanelStringsOverride`). `lang` wählt die Grundsprache wie bei `resolveStatusBarSettingStrings`; `PanelStrings.lang` aus
// svg-studio entfällt (die Sprache steht in `PromptPanelDeps.lang`).

export interface PromptPanelStrings {
  targetNew: string;
  targetEdit: (label: string) => string;
  targetKept: (label: string) => string;
  newButton: string;
  /** Name der Aufgabe, nicht des Modells: er steht als `label` an der Modellzeile und ergibt deren `aria-label` „Model for <Aufgabe>“ / „Modell für <Aufgabe>“. Standard „Prompt“ / „Auftrag“. */
  modelLabel: string;
  promptLabel: string;
  placeholderCreate: string;
  placeholderRefine: string;
  /** Platzhalter, wenn das Auftragsfeld freiwillig ist (`instructionOptional`). */
  instructionOptional: string;
  create: string;
  refine: string;
  stop: string;
  accept: string;
  discard: string;
  rounds: string;
  reasoning: string;
  copyReasoning: string;
  running: (model: string) => string;
  aborted: string;
  noEndpoint: string;
  openSettings: string;
  emptyText: string;
  examples: readonly string[];
  previewOf: (n: number) => string;
  previewNone: string;
  /** Überschrift der Vorschau, solange es noch keine Runde gibt und sie den Stand des Ziels zeigt. */
  previewBase: string;
  unsupported: (label: string) => string;
  discardConfirm: (n: number) => string;
  closeConfirm: (n: number) => string;
  confirmDiscard: string;
  confirmKeep: string;
  thinkingOff: string;
  thinkingOn: (level: string) => string;
  thinkingPicker: string;
  /** Statusleisten-Eintrag, solange ein Lauf ohne Fenster läuft. */
  statusRunning: (name: string) => string;
  /** Statusleisten-Eintrag, wenn ein Lauf ohne Fenster geendet hat und seine Runde wartet. */
  statusWaiting: (name: string) => string;
  /** Meldung (Notice), wenn ein Lauf ohne Fenster mit einem Ergebnis endet. */
  noticeDone: (name: string) => string;
  /** Der Schnappschuss vor dem Überschreiben ist fehlgeschlagen; es wurde nichts geschrieben. */
  snapshotFailed: (path: string, reason: string) => string;
}

export type PromptPanelStringsOverride = Partial<PromptPanelStrings> & { lang?: "en" | "de" };

export const PROMPT_PANEL_STRINGS_EN: PromptPanelStrings = {
  targetNew: "New target",
  targetEdit: (label) => `Edit: ${label}`,
  targetKept: (label) => `Target kept: ${label} — discard to switch`,
  newButton: "New",
  modelLabel: "Prompt",
  promptLabel: "Your instruction",
  placeholderCreate: "Describe what should be created.",
  placeholderRefine: "What should change?",
  instructionOptional: "Additional hint (optional)",
  create: "Create",
  refine: "Change",
  stop: "Stop",
  accept: "Apply",
  discard: "Discard",
  rounds: "Rounds",
  reasoning: "Thinking…",
  copyReasoning: "Copy thinking",
  running: (model) => `Asking ${model}… This can take minutes with local models.`,
  aborted: "Stopped.",
  noEndpoint: "No language model is set up yet.",
  openSettings: "Open settings",
  emptyText: "Nothing created yet. Describe it in words.",
  examples: [],
  previewOf: (n) => `Preview of round ${n}`,
  previewNone: "No preview yet.",
  previewBase: "Current state",
  unsupported: (label) => `${label} can't be changed here.`,
  discardConfirm: (n) => `Discard ${n} unapplied round(s)?`,
  closeConfirm: (n) => `${n} unapplied round(s) will be lost. Discard them? (Keep brings them back when the window opens again.)`,
  confirmDiscard: "Discard",
  confirmKeep: "Keep",
  thinkingOff: "Thinking: off",
  thinkingOn: (level) => `Thinking: ${level}`,
  thinkingPicker: "Thinking level",
  statusRunning: (name) => `${name}: running`,
  statusWaiting: (name) => `${name}: result waiting`,
  noticeDone: (name) => `${name}: the result is ready. Open the window to review it.`,
  snapshotFailed: (path, reason) => `Could not back up ${path} first: ${reason}`,
};

export const PROMPT_PANEL_STRINGS_DE: PromptPanelStrings = {
  targetNew: "Neues Ziel",
  targetEdit: (label) => `Ändern: ${label}`,
  targetKept: (label) => `Ziel festgehalten: ${label} — Verwerfen zum Wechseln`,
  newButton: "Neu",
  modelLabel: "Auftrag",
  promptLabel: "Deine Anweisung",
  placeholderCreate: "Beschreibe, was entstehen soll.",
  placeholderRefine: "Was soll sich ändern?",
  instructionOptional: "Zusätzlicher Hinweis (optional)",
  create: "Erzeugen",
  refine: "Ändern",
  stop: "Abbrechen",
  accept: "Übernehmen",
  discard: "Verwerfen",
  rounds: "Runden",
  reasoning: "Denkt nach …",
  copyReasoning: "Denken kopieren",
  running: (model) => `Frage ${model} … Mit lokalen Modellen kann das Minuten dauern.`,
  aborted: "Abgebrochen.",
  noEndpoint: "Noch kein Sprachmodell eingerichtet.",
  openSettings: "Einstellungen öffnen",
  emptyText: "Noch nichts erzeugt. Beschreibe es in Worten.",
  examples: [],
  previewOf: (n) => `Vorschau von Runde ${n}`,
  previewNone: "Noch keine Vorschau.",
  previewBase: "Aktueller Stand",
  unsupported: (label) => `${label} lässt sich hier nicht ändern.`,
  discardConfirm: (n) => `${n} nicht übernommene Runde(n) verwerfen?`,
  closeConfirm: (n) => `${n} nicht übernommene Runde(n) gehen verloren. Verwerfen? (Behalten bringt sie zurück, wenn das Fenster wieder aufgeht.)`,
  confirmDiscard: "Verwerfen",
  confirmKeep: "Behalten",
  thinkingOff: "Denken: aus",
  thinkingOn: (level) => `Denken: ${level}`,
  thinkingPicker: "Denkstufe",
  statusRunning: (name) => `${name}: läuft`,
  statusWaiting: (name) => `${name}: Ergebnis wartet`,
  noticeDone: (name) => `${name}: Das Ergebnis liegt vor. Öffne das Fenster, um es zu prüfen.`,
  snapshotFailed: (path, reason) => `Die Sicherung von ${path} vorab ist fehlgeschlagen: ${reason}`,
};

/** Grundsprache (EN ohne Angabe), Feld für Feld von `override` überlagert; ein ausdrückliches `undefined` überschreibt nichts. */
export function resolvePromptPanelStrings(override?: PromptPanelStringsOverride): PromptPanelStrings {
  const base = override?.lang === "de" ? PROMPT_PANEL_STRINGS_DE : PROMPT_PANEL_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<PromptPanelStrings>) };
}
