// vendored from obsidian-kit@0.113.0, src/obsidian/panel-accept-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import type { AcceptStrings, InsertWhere } from "./panel-accept";

// Standardtexte des Übernehmens (`AcceptStrings` von `panel-accept`), seit 0.111.0 (Welle 37 Nachlauf, n-kit, K-A). Vorher baute jedes Plugin dieselben Sätze selbst: svg-studio
// `src/i18n/strings.ts` (`acceptStrings()`, das reichste Exemplar: alle Felder, vier Einfügeorte, drei Gründe ohne Verweis), 3d-codeblocks `src/i18n/strings.ts` (`ACCEPT_STRINGS`:
// dazu `nestedFence`, eine Datei ohne bekannten Pfad, Block an der Auswahl vs. am Cursor), lingotuner `src/obsidian/accept.ts`. Grundlage ist svg-studio; die Satzform „…; nothing was
// written.“ steht in svg-studio und lingotuner wortgleich, 3d-codeblocks schrieb „— nothing was applied.“ (Drift, hier angeglichen). Formatneutral gefasst, wo ein Exemplar sein Format
// nannte („A new image“, „the SVG would land“): solche Sätze überschreibt das Plugin. Fachlich eigen bleiben laut Gegenlesung in lingotuner `unchanged`, `cannotReplace`, `appliedTo`,
// `blockMoved` (und bei svg-studio `appliedAsBlock`, `savedFileNoReference`): das Plugin überschreibt sie Feld für Feld, `strings: { lang: "de", appliedTo: … }`.
// `BLOCK_IN_LIST_TEXT` aus `panel-accept` ist jetzt `ACCEPT_STRINGS_EN/DE.blockInList` (der Export bleibt, mit denselben Sätzen).

/** Alle Texte, auch die in `AcceptStrings` optionalen: ein Plugin, das die Standardtexte nimmt, hat damit jeden Satz. */
export type AcceptStringsFull = Required<AcceptStrings>;

export type AcceptStringsOverride = Partial<AcceptStrings> & { lang?: "en" | "de" };

/** Ein Problem endet oft mit einem Satzpunkt; der Schluss „; nothing was written.“ steht dahinter, also wird er abgenommen (svg-studio, lingotuner). */
const stripEnd = (problem: string): string => problem.replace(/[.\s]+$/, "");

const WHERE_EN: Record<InsertWhere, string> = {
  "at-cursor": "Code block inserted at the cursor.",
  "after-block-at-cursor": "Code block inserted after the code block at the cursor.",
  "after-block-at-selection": "Code block inserted after the code block at the selection.",
  "after-selection": "Code block inserted after the selection.",
  "after-frontmatter": "Code block inserted after the front matter.",
};

const WHERE_DE: Record<InsertWhere, string> = {
  "at-cursor": "Codeblock am Cursor eingefügt.",
  "after-block-at-cursor": "Codeblock hinter dem Codeblock am Cursor eingefügt.",
  "after-block-at-selection": "Codeblock hinter dem Codeblock an der Auswahl eingefügt.",
  "after-selection": "Codeblock hinter der Auswahl eingefügt.",
  "after-frontmatter": "Codeblock hinter den Eigenschaften der Notiz eingefügt.",
};

export const ACCEPT_STRINGS_EN: AcceptStringsFull = {
  unsupported: (label) => `${label} can't be changed here.`,
  notApplied: (problem) => `${stripEnd(problem)}; nothing was written.`,
  unchanged: "Nothing to apply: the target already has this content.",
  cannotReplace: "A new result can't replace an existing target; nothing was written.",
  blockMoved: "Block changed: it moved or was deleted since the panel opened; nothing was written.",
  blockChanged: "Block changed: its content differs from what the panel opened; nothing was written.",
  noteChanged: "The target changed while applying; nothing was written. Try again.",
  closesFence: "A line of the result would close the code block; nothing was written.",
  cancelled: "Cancelled; nothing was written.",
  noNoteOpen: "No note is open to put a code block in; nothing was written.",
  noteInReadingView: "The note is in reading view; nothing was written. Switch it to editing.",
  appliedTo: (label) => `Applied to ${label}.`,
  appliedAsBlock: (where) => WHERE_EN[where],
  appendedToNote: "The note is in reading view, so the code block was added at the end of the note.",
  fileGone: (path) => `${path} no longer exists; nothing was written.`,
  fileExists: (path) => `${path} already exists; nothing was written.`,
  couldNotCreate: (path, reason) => (path ? `Could not create ${path}: ${stripEnd(reason)}; nothing was written.` : `Could not create the file: ${stripEnd(reason)}; nothing was written.`),
  savedFileWithReference: (path) => `Saved ${path} and inserted its link at the cursor.`,
  savedFileNoReference: (path, why) =>
    why === "no-note" ? `Saved ${path}. No note is open, so no link was inserted.`
      : why === "reading" ? `Saved ${path}. The note is in reading view; no link was inserted.`
        : `Saved ${path}. The active note changed meanwhile; no link was inserted.`,
  savedFileAppended: (path) => `Saved ${path}. The note is in reading view, so its link was added at the end of the note.`,
  savedFileReferenceFailed: (path, reason) => `Saved ${path}, but the link could not be inserted: ${reason}`,
  unclosedFence: (selected) => (selected ? "The selection ends in a code block that is never closed; nothing was inserted." : "The cursor is in a code block that is never closed; nothing was inserted."),
  nestedFence: (selected) => `${selected ? "The selection ends" : "The cursor is"} in a code block inside a quote, callout or list. Nothing was written; move the cursor outside it and try again.`,
  blockInList: "This block sits in a list item; the panel only writes into blocks that start at the beginning of a line. Nothing was written.",
  selectionChanged: "The selected text has changed since the run started; nothing was written. Select it again and repeat.",
  selectionMoved: "The selected text is no longer at its place and occurs more than once, so the place is unclear; nothing was written. Select it again and repeat.",
  noFence: "This write would put a code block into the note, but the plugin gave no fence for it; nothing was written.",
  savedNote: (path) => `Note created: ${path}`,
  couldNotApply: (reason) => `Could not apply: ${reason}`,
};

export const ACCEPT_STRINGS_DE: AcceptStringsFull = {
  unsupported: (label) => `${label} lässt sich hier nicht ändern.`,
  notApplied: (problem) => `${stripEnd(problem)}; nichts geschrieben.`,
  unchanged: "Nichts zu übernehmen: Das Ziel hat schon diesen Inhalt.",
  cannotReplace: "Ein neues Ergebnis ersetzt kein bestehendes Ziel; nichts geschrieben.",
  blockMoved: "Block geändert: Er wurde seit dem Öffnen des Panels verschoben oder gelöscht; nichts geschrieben.",
  blockChanged: "Block geändert: Sein Inhalt weicht von dem ab, den das Panel geöffnet hat; nichts geschrieben.",
  noteChanged: "Das Ziel hat sich beim Übernehmen geändert; nichts geschrieben. Versuche es noch einmal.",
  closesFence: "Eine Zeile des Ergebnisses würde den Codeblock schließen; nichts geschrieben.",
  cancelled: "Abgebrochen; nichts geschrieben.",
  noNoteOpen: "Keine Notiz offen, in die ein Codeblock käme; nichts geschrieben.",
  noteInReadingView: "Die Notiz steht im Lesemodus; nichts geschrieben. Stelle sie auf Bearbeiten.",
  appliedTo: (label) => `Übernommen in ${label}.`,
  appliedAsBlock: (where) => WHERE_DE[where],
  appendedToNote: "Die Notiz steht im Lesemodus, deshalb steht der Codeblock am Ende der Notiz.",
  fileGone: (path) => `${path} gibt es nicht mehr; nichts geschrieben.`,
  fileExists: (path) => `${path} gibt es schon; nichts geschrieben.`,
  couldNotCreate: (path, reason) => (path ? `${path} ließ sich nicht anlegen: ${stripEnd(reason)}; nichts geschrieben.` : `Die Datei ließ sich nicht anlegen: ${stripEnd(reason)}; nichts geschrieben.`),
  savedFileWithReference: (path) => `${path} gespeichert, der Link steht am Cursor.`,
  savedFileNoReference: (path, why) =>
    why === "no-note" ? `${path} gespeichert. Keine Notiz offen, deshalb kein Link.`
      : why === "reading" ? `${path} gespeichert. Die Notiz steht im Lesemodus; kein Link eingefügt.`
        : `${path} gespeichert. Die aktive Notiz hat inzwischen gewechselt; kein Link eingefügt.`,
  savedFileAppended: (path) => `${path} gespeichert. Die Notiz steht im Lesemodus, deshalb steht der Link am Ende der Notiz.`,
  savedFileReferenceFailed: (path, reason) => `${path} gespeichert, aber der Link ließ sich nicht einfügen: ${reason}`,
  unclosedFence: (selected) => (selected ? "Die Auswahl endet in einem Codeblock, der nie geschlossen wird; nichts eingefügt." : "Der Cursor steht in einem Codeblock, der nie geschlossen wird; nichts eingefügt."),
  nestedFence: (selected) => `${selected ? "Die Auswahl endet" : "Der Cursor steht"} in einem Codeblock innerhalb eines Zitats, Callouts oder einer Liste; nichts geschrieben. Setze den Cursor außerhalb davon und versuche es erneut.`,
  blockInList: "Dieser Block steht in einer Liste; das Panel schreibt nur in Blöcke, die am Zeilenanfang stehen. Es wurde nichts geschrieben.",
  selectionChanged: "Der markierte Text hat sich seit dem Start geändert; nichts geschrieben. Markiere ihn neu und wiederhole.",
  selectionMoved: "Der markierte Text steht nicht mehr an seiner Stelle und kommt mehrfach vor, die Stelle ist also unklar; nichts geschrieben. Markiere ihn neu und wiederhole.",
  noFence: "Dieser Weg würde einen Codeblock in die Notiz setzen, aber das Plugin hat keinen Zaun dafür angegeben; nichts geschrieben.",
  savedNote: (path) => `Notiz angelegt: ${path}`,
  couldNotApply: (reason) => `Übernehmen nicht möglich: ${reason}`,
};

/** Grundsprache aus `lang` (EN ohne Angabe), Feld für Feld von `override` überlagert; ein ausdrückliches `undefined` überschreibt nichts. */
export function resolveAcceptStrings(override?: AcceptStringsOverride): AcceptStringsFull {
  const base = override?.lang === "de" ? ACCEPT_STRINGS_DE : ACCEPT_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<AcceptStrings>) };
}
