// vendored from obsidian-kit@0.110.0, src/obsidian/panel-accept.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Herkunft: 3d-codeblocks `src/obsidian/panel-accept.ts:20-287` (Übernehmen im Prompt-Panel, Spec Modell per Prompt § 6.3/§ 5), dazu
// `json-editor/src/obsidian/repair-flow.ts:70-76` (Anhangpfad nie überschreiben, Text und binär) — Kit-Kandidat aus der Extraktionsprüfung SVG Studio
// (2026-11-02, Gegenleser K6). Das Format steckt in `AcceptSpec` (Zaun-Sprache, Berechnung, Prüfung, Haken vor dem Schreiben), die Texte in
// `AcceptStrings`; das Kit hat kein `t()`.
//
// ## Was das Modul tut
//
// `acceptPanel(env, spec, target, kind, where?)` schreibt das Ergebnis eines Prompt-Panels dorthin, wo es hingehört: in einen Codeblock einer Notiz
// (`target.kind === "block"`), in eine Datei (`"file"`) oder, für das Ziel `new`, in einen neuen Block am Cursor oder in eine neue Anhangdatei samt
// Verweis. Es **wirft nie**; jede Unsicherheit ist eine Ablehnung mit Meldung und ohne Schreibversuch (Datenschutz vor Komfort, die Nutzernotiz ist
// fremder Inhalt). Alles oder nichts: `compute` liefert den ganzen Text oder ein Problem.
//
// - **Block:** der Block wird nur geschrieben, wenn seine Zeilen, seine Sprache UND sein Rumpf noch die sind, die der Nutzer angeklickt hat
//   (`locateBlock`, Fingerabdruck wie in REGISTRY „Zeilenbasiertes Ziel braucht einen Inhalts-Fingerabdruck“): Zeilennummern allein treffen nach
//   einer Änderung darüber einen anderen Block. Geschrieben wird über `writeBlockBody` (seit K9 Etappe 2a über `editAtomic`: Editor mit Strg+Z, sonst `vault.process`), das den Rumpf
//   ein zweites Mal vor dem Schreiben prüft. **Vor dem Ersetzen läuft `spec.beforeWrite(path, alterNotiztext)` (K9 Etappe 2a, siehe „Schnappschuss-Regel“).** **Wiederfinden (0.80.1):** steht der Block unverändert woanders (der Nutzer tippt während des Laufs eine Zeile
//   darüber), findet `locateBlock` ihn nach Inhalt, aber nur bei **genau einem** Zaun gleicher Sprache, Länge und gleichen Rumpfs; die neue Lage kommt als
//   `retarget` zurück (auch bei `unchanged`). Zwei gleiche Blöcke bleiben `blockMoved`, ein geänderter Rumpf bleibt `blockChanged`.
//   **Im echten Obsidian gemessen (1.15.1, Live Preview, `pilot/insert-cursor.ts`, 2026-11-12):** ein getippte Zeile über dem Block (`Input.insertText`) steht sofort im Editor (`editorFor(path).getValue()`), die Datei im Vault erst später: deshalb liest `readNoteText` zuerst den Editor. Der Block wird wiedergefunden (`retarget` +1 Zeile), Cmd+Z (und `editor.undo()`) stellt den Rumpf wieder her; zwei gleiche Blöcke bleiben `blockMoved`; ein Block in Callout oder Zitat wird abgelehnt (`blockMoved`, nichts geschrieben). Messfalle: `executeCommandById("editor:undo")` nahm im Treiber nicht einmal ein einfaches Tippen zurück, die Taste und die Editor-API schon.
// - **Datei:** lesen, `compute(aktueller Text)`, `checkWrite`, dann `beforeWrite(path, alterText)` (der Haken für den Schnappschuss, `file-snapshot`),
//   dann `vault.process`, das nur schreibt, wenn die Datei seit dem Lesen unverändert ist. Wirft `beforeWrite`, wird nichts geschrieben: ein
//   Schreibvorgang ohne Rückweg findet nicht statt.
// - **Neu:** der Schreibweg ist ausdrücklich (`where`, siehe unten) oder, für Aufrufer aus dem Altbestand, `acceptAs` der Einstellung (`block`, `file`, `ask` → `env.choose()`); ein Spec ohne `newFile` kennt ohne `where` nur den Block und fragt nie.
//
// ## Seit K9 Etappe 2a (Welle 36): Schnappschuss-Regel, `where`, `retarget` für Neues
//
// - **Schnappschuss-Regel.** `spec.beforeWrite(path, alterText)` läuft vor **jedem Überschreiben von vorhandenem Inhalt**: beim Ersetzen einer Datei (schon vorher) und beim Ersetzen eines Blocks (neu), mit dem **ganzen alten Notiztext**,
//   nach allen Ablehnungen (`compute`, `checkWrite`/`refuse`, `closesFence`, Fingerabdruck) und direkt vor dem Schreiben: ein Schnappschuss ohne Schreiben wäre Platzverbrauch. Wirft der Haken, wird nichts geschrieben, und die Meldung kommt über
//   `couldNotApply`. **Kein Haken** beim reinen Hinzufügen: Einfügen an der Schreibmarke, neue Datei, und `appendToNote` im Lesemodus (es hängt nur an und überschreibt nichts; ein Schnappschuss entfiele also; das `retarget` auf den angehängten Block liefert es trotzdem, siehe „`retarget` für Neues“). Den Haken setzt der Rahmen ein: `snapshotBeforeWrite(app, pluginId, failed)` macht aus `snapshotFile` einen Haken, dessen `ok: false` ein Wurf ist; ein Plugin kann ihn so nicht auslassen. Der Fingerabdruck des Blocks bleibt der Rumpf:
//   Tippen außerhalb des Blocks zwischen Haken und Schreiben verhindert das Schreiben nicht, der Schnappschuss trägt dann den Stand von `locateBlock` (sicher den alten Rumpf, den Rest im Stand von dort).
// - **CRLF-Notiz offen im Editor.** `locateBlock` liest mit `readNoteText`; ist die Notiz im Quellmodus offen, ist das der Editorstand (LF, gegebenenfalls ungespeichert), nicht die Bytes der Platte. Der Schnappschuss trägt dann diesen Stand: gewollt, denn überschrieben
//   wird der Editorstand; eine geschlossene CRLF-Notiz sichert die Platte mit ihrem CRLF. (Obsidian speichert eine offene CRLF-Notiz ohnehin als LF, siehe Kopf von `note-edit.ts`, P5.)
// - **`where`.** `acceptPanel(env, spec, target, kind, where?)`: für das Ziel `new` legt `where` (`"block"` am Cursor, `"file"` als Anhang) den Schreibweg ausdrücklich fest; mit `where` werden `env.settings` und `env.choose` nie gerufen. Beide sind optional und nur noch für Aufrufer
//   ohne `where`; fehlen sie dort, gilt `"block"`. Der Rahmen kennt die Einstellung seines Plugins nicht und übergibt `where` immer.
// - **`retarget` für Neues.** Eine neue Datei liefert `retarget: { kind: "file", path, label: <Dateiname> }` in jedem `ok`-Ausgang nach dem Anlegen (auch ohne gesetzten Verweis: das Panel arbeitet auf der Datei weiter, statt eine zweite anzulegen); ein neuer Block liefert
//   `retarget` auf den eingefügten Zaun, **auch im Lesemodus mit `readingMode: "append"`** (der Text wird aus dem Pfad der Notiz gelesen, in die angehängt wurde, vorher und nachher; wechselt die aktive Notiz währenddessen, bleibt das Ziel in der beschriebenen; ohne diese Zeile sprang der Halter auf „neu“ und die nächste Runde legte ein zweites Bild an; verlorene Fähigkeit gegenüber svg-studio `d67cfd4`) (`blockAfterInsert`, aus `svg-studio/src/obsidian/accept.ts` hierher verschoben; Text vorher und nachher mit `readNoteText`, kein Treffer heißt kein `retarget`, nichts geraten). Die Beschriftung des Blocks kommt von
//   `spec.blockLabel?(path, openLine, body)`, Standard `<Notizname ohne .md>:<Zeile + 1>` (nicht formatneutral: svg-studio zeigt `Notiz:Zeile`, 3d-codeblocks den Titel der Form). Grund: svg-studio erfuhr den Pfad einer neuen Datei bisher nur, indem es die Meldungstexte des Bausteins abfing.
// - **Frontmatter ist Sperrzone (0.79.2):** `insertAtCursor` setzt den Text hinter die schließende `---`-Zeile, wenn der Cursor (bei einer Auswahl: deren Ende) in oder vor der Frontmatter
//   steht (`0:0`, eine YAML-Zeile). Was Frontmatter ist, sagt Obsidians `getFrontMatterInfo`; gemessen in 1.15.1: Obsidian öffnet eine Notiz mit Frontmatter mit dem Cursor auf der ersten Zeile
//   DAHINTER, `0:0` ist der Ausnahmefall (Strg+Pos1, Klick in den YAML-Text). Entscheidung „dahinter einfügen statt ablehnen“: Begründung im CHANGELOG 0.79.2.
// - **Lesemodus:** `view.editor` ist dort nicht der Puffer, den Obsidian zeigt; ein `replaceRange` verpuffte lautlos. `readingMode: "refuse"` lehnt ab,
//   `"append"` hängt den Text am Notizende über `vault.process` an und sagt das in der Meldung.
// - **`compute` und die Meldungen:** `problem` aus `compute` (etwa aus `acceptChain` von code-kit `panel-session`, dessen Probleme englisch sind) geht
//   unverändert durch `strings.notApplied(problem)`; das Modul übersetzt oder verändert es nicht.
//
// - **Grenzen, die der Aufrufer kennt (Opus-Review 2026-11-04):** (1) **Keine Sperre gegen einen zweiten Aufruf.** Block und Datei lehnen einen gleichzeitigen zweiten
//   Aufruf ab (`noteChanged`: der Fingerabdruck bzw. der Datei-Stand trägt), das Ziel `new` schreibt aber zweimal. Der Aufrufer sperrt den Knopf während des Laufs und
//   leert die Runden nach einem Erfolg. (2) **Leser und Schreiber lesen nicht dasselbe (seit code-kit 0.78.0).** `locateBlock` liest mit `listFences` flach und sieht seit 0.78.0 auch einen Zaun auf der Zeile eines Listenmarkers
//   (`- ```svg`, `1. ```svg`, Tilde); sein Rumpf trägt den Einzug des Punkts nicht. `Fence` hat dafür kein Feld, und der Schreiber (`writeBlockBody`, `replaceLines`) prüft die Öffnungszeile mit `FENCE_LINE` und kennt nur eine
//   Zeile, die mit dem Zaun beginnt. Schriebe `acceptPanel` dorthin, läge der Schnappschuss schon, und `writeBlockBody` würfe `BlockChangedError`, übersetzt in die irreführende Meldung `noteChanged`. Deshalb lehnt
//   `acceptIntoBlock` einen Block, dessen Öffnungszeile (gelesen aus dem Notiztext) nach dem Leerraum nicht mit dem Zaun beginnt, ausdrücklich ab (`strings.blockInList`, Standard `BLOCK_IN_LIST_TEXT`): vor `compute`,
//   `checkWrite` und `beforeWrite`, ohne Schnappschuss, ohne Schreiben. Lesen darf der Rahmen den Block weiter (`readBlockText`, `retarget`, Vorschau). Ein späterer Schreibweg für Listenblöcke bräuchte den Einzug
//   des Punkts als Wert, den `Fence` trägt. Ein Zaun in einem **Zitat oder Callout** (`> ```js`, `> - ```js`) sieht `locateBlock` weiterhin nicht (`blockMoved`, nichts geschrieben), ebenso einen mit vier und mehr
//   Leerzeichen Einzug ohne Listenpunkt; Einfügen am Cursor dort lehnt `insertAtCursor` seit 0.86.0 ab (`NestedFenceError`, `findNestedFenceAt`), statt im Zaun des Zitats zu landen.
//   (3) Bei mehreren Cursorn (Mehrfachauswahl) fügt `insertAtCursor` seit 0.86.0 nur am Hauptcursor ein (`replaceRange` statt `replaceSelection`; gemessen 1.15.1: `replaceSelection` fügte an jedem Cursor ein).
// Nicht Teil des Bausteins: **ungespeicherte Puffer einer Plugin-eigenen Dateiansicht** (etwa eine `.shapes`-Ansicht mit nicht gespeichertem Stand; der Aufrufer speichert sie vor `acceptPanel`, im Rahmen über `prepare`), die
// Zwei-Wege-Wahl bei `ask` (`env.choose`, das Kit-`confirm` ist Ja/Nein) und das Zeichnen des Panels.

import { MarkdownView, TFile, getFrontMatterInfo, type App } from "obsidian";
import { BlockChangedError, writeBlockBody, type WritePorts } from "../kit/block-writer";
import { editAtomic, readNoteText, swapNote } from "../kit/note-edit";
import { obsidianWritePorts } from "./write-ports";
import { closesFence, findFenceAt, findNestedFenceAt, listFences, type Fence } from "../kit/fences";
import { errorMessage } from "../kit/error-message";
import { snapshotFile } from "./file-snapshot";
import { detectEol } from "../kit/text-window";
import type { Target } from "../kit/panel-session";

export type BlockTarget = Extract<Target, { kind: "block" }>;

/** Wo `insertAtCursor` den Text hingesetzt hat. */
export type InsertWhere = "after-block-at-selection" | "after-block-at-cursor" | "after-frontmatter" | "after-selection" | "at-cursor";

/** Der Zaun am Cursor oder am Ende der Auswahl wird nie geschlossen: hinter ihm einzufügen hieße, im Zaun einzufügen. */
export class UnclosedFenceError extends Error {
  readonly selected: boolean;
  constructor(selected: boolean) {
    super("the cursor or selection is in a code block that is never closed");
    this.name = "UnclosedFenceError";
    this.selected = selected;
  }
}

/** Der Zaun am Cursor oder am Ende der Auswahl steht in einem Zitat, Callout oder Listenpunkt (Einzug ab vier Leerzeichen): `insertAtCursor` sieht dort keinen Zaun, und ein Block mitten hinein
 *  ließe den Callout zerfallen. Abgelehnt statt eingefügt (Opus-Review A3, Empfehlung „zuerst ablehnen“); der Nutzer setzt den Cursor außerhalb. */
export class NestedFenceError extends Error {
  readonly selected: boolean;
  constructor(selected: boolean) {
    super("the cursor or selection is in a code block inside a quote, callout or list");
    this.name = "NestedFenceError";
    this.selected = selected;
  }
}

/** Text, wenn die `strings` des Konsumenten `nestedFence` (seit 0.86.0, optional) noch nicht kennen. */
const NESTED_FENCE_FALLBACK = (selected: boolean): string =>
  `${selected ? "The selection ends" : "The cursor is"} in a code block inside a quote, callout or list. Nothing was written; move the cursor outside it and try again.`;

/** Die Meldung, wenn der Block hinter einem Listenmarker steht (`AcceptStrings.blockInList`): Folge, nicht Mechanismus. Zum Übernehmen in die eigenen Texte. */
export const BLOCK_IN_LIST_TEXT = {
  en: "This block sits in a list item; the panel only writes into blocks that start at the beginning of a line. Nothing was written.",
  de: "Dieser Block steht in einer Liste; das Panel schreibt nur in Blöcke, die am Zeilenanfang stehen. Es wurde nichts geschrieben.",
} as const;

/** Öffnungszeile eines Blocks, in den geschrieben werden darf: nach dem Leerraum steht der Zaun (dieselbe Regel wie `FENCE_LINE` in `pure/block-writer`, deren Schreiber sonst mit `BlockChangedError` ablehnt). */
const OPENS_WITH_FENCE = /^\s*(?:`{3,}|~{3,})/;

export interface AcceptStrings {
  unsupported(label: string): string;
  /** Umschlag um ein Problem aus `compute`/`checkWrite` („… — nothing was applied.“). Das Problem selbst kommt unverändert an. */
  notApplied(problem: string): string;
  unchanged: string;
  /** `create` auf ein bestehendes Ziel (Block oder Datei): würde dessen Inhalt kommentarlos ersetzen. */
  cannotReplace: string;
  blockMoved: string;
  blockChanged: string;
  noteChanged: string;
  /** Eine Zeile des neuen Rumpfs würde den Zaun des Blocks schließen. */
  closesFence: string;
  cancelled: string;
  noNoteOpen: string;
  noteInReadingView: string;
  appliedTo(label: string): string;
  appliedAsBlock(where: InsertWhere): string;
  /** Lesemodus mit `readingMode: "append"`: Block am Ende der Notiz angehängt. */
  appendedToNote: string;
  fileGone(path: string): string;
  fileExists(path: string): string;
  couldNotCreate(path: string, reason: string): string;
  savedFileWithReference(path: string): string;
  savedFileNoReference(path: string, why: "reading" | "no-note" | "note-changed"): string;
  /** Lesemodus mit `readingMode: "append"`: Datei angelegt, Verweis am Ende der Notiz angehängt. */
  savedFileAppended(path: string): string;
  savedFileReferenceFailed(path: string, reason: string): string;
  unclosedFence(selected: boolean): string;
  /** Seit 0.86.0, optional: Cursor oder Auswahlende liegt in einem Zaun in Zitat, Callout oder Liste (`NestedFenceError`). Fehlt der Text, gilt ein englischer Standard. */
  nestedFence?(selected: boolean): string;
  /** Seit 0.98.0, optional: der Block, in den geschrieben werden soll, öffnet nicht mit dem Zaun, sondern hinter einem Listenmarker (`- ```svg`). Das Panel liest ihn (Vorschau), schreibt aber nicht hinein; nichts wurde
   *  geschrieben, kein Schnappschuss gemacht. Fehlt der Text, gilt der englische Standard (`BLOCK_IN_LIST_TEXT.en`); `BLOCK_IN_LIST_TEXT.de` ist die deutsche Fassung zum Übernehmen. */
  blockInList?: string;
  couldNotApply(reason: string): string;
}

export interface AcceptSpec {
  /** Sprache des Zauns, in dem der Block steht (`"svg"`); der Fingerabdruck prüft sie mit. */
  fenceLang: string;
  /** Der Block, wie er in die Notiz kommt (Zaun samt Sprache). */
  wrap(text: string): string;
  /** Neue Anhangdatei für das Ziel `new`; fehlt sie, kennt der Spec nur den Block. `reference` baut den Verweis aus dem Linktext. */
  newFile?: (text: string) => { name: string; content: string | ArrayBuffer; reference: (linktext: string) => string };
  /** Der Text, den die Übernahme schreibt, aus dem Text des Ziels JETZT (`null` für das Ziel `new`). Alles oder nichts. */
  compute(current: string | null): { ok: true; text: string } | { ok: false; problem: string };
  /** Letzte Prüfung des fertigen Textes; ein Problem verhindert das Schreiben. */
  checkWrite?(text: string): string | null;
  /** Vor dem Überschreiben einer bestehenden Datei (`file-snapshot`); wirft → nichts wird geschrieben. */
  beforeWrite?(path: string, oldText: string): Promise<void>;
  /** Beschriftung eines neu eingefügten Blocks im `retarget` (nicht formatneutral: svg-studio `Notiz:Zeile`, 3d-codeblocks der Titel der Form). `openLine` ist die 0-basierte Öffnungszeile. Standard: `<Notizname ohne .md>:<openLine + 1>`. */
  blockLabel?(path: string, openLine: number, body: string): string;
}

export interface AcceptEnv {
  app: App;
  ports: WritePorts;
  /** Seit K9 Etappe 2a optional: nur noch für Aufrufer ohne `where` (Altbestand). Fehlt es, gilt `"block"`. */
  settings?(): { acceptAs: "block" | "file" | "ask" };
  /** Die zuletzt bediente Notiz (Quell- oder Lesemodus), sonst `null`. */
  lastEditor(): MarkdownView | null;
  /** Seit K9 Etappe 2a optional, wie `settings`: die Zwei-Wege-Wahl bei `acceptAs: "ask"`. Fehlt sie, gilt `"block"`. */
  choose?(): Promise<"block" | "file" | null>;
  strings: AcceptStrings;
  readingMode: "append" | "refuse";
}

/** `retarget`: nach einem erfolgreichen Block-Apply das neue Ziel (geschriebener Rumpf, neue Schlusszeile), damit das Panel weiterarbeiten kann. */
export type AcceptOutcome = { ok: true; message: string; retarget?: Target } | { ok: false; message: string };


/** Vergleichsform eines Rumpfs: CRLF → LF, ein Zeilenende am Ende zählt nicht. */
const normBody = (t: string): string => t.replace(/\r\n/g, "\n").replace(/\n$/, "");

/* ── Anhang anlegen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type CreateAttachmentResult =
  | { ok: true; file: TFile; path: string }
  | { ok: false; code: "exists" | "error"; path: string; message: string };

/** Legt eine Anhangdatei an und überschreibt nie: der Pfad kommt von Obsidian (`getAvailablePathForAttachment`, Anhangordner der Notiz oder der
 *  Standardordner bei `notePath: null`), und ein Pfad, den Vault oder Adapter schon kennen (auch in anderer Schreibweise), wird abgelehnt, falls die
 *  Pfadvergabe ihn übersieht. `ArrayBuffer` geht über `createBinary`. Wirft nie. */
export async function createAttachmentFile(
  app: App,
  o: { name: string; notePath: string | null; content: string | ArrayBuffer },
): Promise<CreateAttachmentResult> {
  let path = "";
  try {
    path = await app.fileManager.getAvailablePathForAttachment(o.name, o.notePath ?? "");
    if (app.vault.getAbstractFileByPath(path) || (await app.vault.adapter.exists(path))) {
      return { ok: false, code: "exists", path, message: `${path} already exists` };
    }
    const file = typeof o.content === "string" ? await app.vault.create(path, o.content) : await app.vault.createBinary(path, o.content);
    return { ok: true, file, path };
  } catch (error) {
    return { ok: false, code: "error", path, message: errorMessage(error) };
  }
}

/* ── Einfügen am Cursor ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Einfügen, ohne Nutzerinhalt zu zerstören: **die Frontmatter ist Sperrzone** (Cursor oder Auswahlende in ihr, auch `0:0` vor ihr: der Text steht hinter ihrer schließenden
 *  `---`-Zeile, `after-frontmatter`; eine Einfügung davor machte sie zur Nicht-Frontmatter, eine in einer YAML-Zeile zerrisse sie). Was Frontmatter ist, sagt Obsidian
 *  selbst (`getFrontMatterInfo`, gemessen 1.15.1: erste Zeile genau `---`, schließende Zeile genau `---`, ein leerer Block zählt, ohne schließende Zeile gibt es keine); `locateFrontmatter` (frontmatter.ts) liest dieselbe Regel für `patchFrontmatter` und `parseFrontmatter` (Pilot `frontmatter-leser`, 2026-11-14). Ein Zaun unter dem Cursor
 *  bzw. am Ende der Auswahl bekommt den Text dahinter (sonst entstünde ein Block im Block); eine Auswahl außerhalb von Frontmatter und Zaun bleibt (Einfügung an ihrem Ende). Ein Zaun, der nie
 *  geschlossen wird, hat kein „dahinter“: `UnclosedFenceError`, nichts geschrieben. Ein Zaun in einem Zitat, Callout oder Listenpunkt (Einzug ab vier Leerzeichen), den der flache Scanner nicht sieht,
 *  wird abgelehnt: `NestedFenceError`, nichts geschrieben (seit 0.86.0). Die Zeilenenden der Notiz bleiben einheitlich. */
export function insertAtCursor(view: MarkdownView, text: string): InsertWhere {
  const editor = view.editor;
  const value = editor.getValue();
  const lines = value.split(/\r?\n/);
  const selected = editor.somethingSelected();
  const anchor = selected ? editor.getCursor("to") : editor.getCursor();
  const eol = detectEol(value);
  const fmEnd = frontmatterCloseLine(value);
  if (fmEnd !== null && anchor.line <= fmEnd) {
    editor.replaceRange(`${eol}${text.replace(/\r?\n/g, eol)}`, { line: fmEnd, ch: (lines[fmEnd] ?? "").length });
    return "after-frontmatter";
  }
  const fence = findFenceAt(value, anchor.line);
  if (!fence && findNestedFenceAt(value, anchor.line)) throw new NestedFenceError(selected);
  if (fence) {
    if (!fence.closed) throw new UnclosedFenceError(selected);
    editor.replaceRange(`${eol}${text.replace(/\r?\n/g, eol)}`, { line: fence.closeLine, ch: (lines[fence.closeLine] ?? "").length });
    return selected ? "after-block-at-selection" : "after-block-at-cursor";
  }
  if (selected) {
    editor.replaceRange(text, anchor);
    return "after-selection";
  }
  // Nicht `replaceSelection`: bei mehreren Cursorn fügt CodeMirror an jedem ein, an den Nebencursorn ohne die Prüfungen oben (gemessen in Obsidian 1.15.1, `pilot/insert-cursor.ts`:
  // zwei Cursor, zweimal der Block, einer davon mitten in einem Zaun). `replaceRange` am Hauptcursor fügt genau einmal ein, bei einem Cursor wie vorher.
  editor.replaceRange(text, anchor);
  return "at-cursor";
}

/** 0-basierte Zeile der schließenden `---` der Frontmatter, `null` ohne Frontmatter (Regel und Grenzfälle: `insertAtCursor`). */
function frontmatterCloseLine(value: string): number | null {
  const info = getFrontMatterInfo(value);
  if (!info.exists) return null;
  return value.slice(0, info.contentStart).replace(/\r?\n$/, "").split("\n").length - 1;
}

/** Die zuletzt bediente Notiz im Quellmodus (`{ view }`), im Lesemodus (`{ reading }`) oder keine (`{ none }`: keine Ansicht oder ohne Datei). */
export function sourceViewOf(last: MarkdownView | null): { view: MarkdownView } | { reading: MarkdownView } | { none: true } {
  if (!last?.file) return { none: true };
  return last.getMode() === "source" ? { view: last } : { reading: last };
}

/* ── Schreiben mit Wächter ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Dünne Hülle über `editAtomic` (`pure/note-edit`) für Aufrufer mit `App` und `TFile`: `fn` liefert den neuen Text, oder `null` (und denselben Text) für „nichts schreiben“; ein Wurf in `fn` schreibt
 *  nichts und kommt als `ok: false` zurück (die Hülle sagt „wirft nie“ zu, und Aufrufer melden eine Ablehnung per Wurf; `editAtomic` selbst lässt ihn durch).
 *  Ist die Notiz im Quellmodus offen, sieht `fn` den Editorstand (LF, auch ungespeichert) und geschrieben wird dort (Strg+Z wirkt, 0.93.0); die Hülle wartet dann bis zu drei Sekunden, bis die Platte den Text
 *  trägt, `ok` heißt weiter „steht auf der Platte“ und `persisted` sagt, ob das gelang. */
export async function processGuarded(
  app: App,
  file: TFile,
  fn: (current: string) => string | null,
): Promise<{ ok: true; changed: boolean; persisted: boolean } | { ok: false; message: string }> {
  try {
    const r = await editAtomic<null>(obsidianWritePorts(app), file.path, (current) => ({ outcome: null, next: fn(current) }));
    return r.kind === "error" ? { ok: false, message: errorMessage(r.error) } : { ok: true, changed: r.changed, persisted: r.persisted };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

/* ── Block finden ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** `relocated`: der Block stand nicht mehr auf den gemerkten Zeilen und wurde an `fence.openLine`/`closeLine` wiedergefunden (0.80.1). */
export type Located = { fence: Fence; text: string; relocated: boolean } | { problem: "moved" | "changed" };

/** Zaun des Blocks finden UND prüfen, dass es noch der Block ist, den der Nutzer angeklickt hat: gleiche Öffnungs- und Schlusszeile, gleiche Sprache,
 *  gleicher Rumpf (Fingerabdruck `t.body`). Zeilennummern allein tragen nicht: nach dem Löschen eines Blocks darüber trifft eine veraltete Position
 *  einen anderen. `moved`: an der Stelle steht kein Block dieser Sprache mit diesen Zeilen; `changed`: es ist derselbe Ort, aber ein anderer Rumpf.
 *
 *  **Wiederfinden (0.80.1):** Tippt der Nutzer während eines Panel-Laufs eine Zeile über den Block, steht er unverändert eine Zeile tiefer, und die gemerkten
 *  Zeilen zeigen ins Leere. Das ist kein `moved`: steht auf den gemerkten Zeilen KEIN Block dieser Sprache und Länge, wird der Block nach Inhalt gesucht
 *  (Sprache, Länge in Zeilen, Rumpf, der Zaun muss geschlossen sein) und genau dann wiedergefunden (`relocated: true`), wenn es **genau einen** solchen Zaun gibt.
 *  Zwei oder mehr gleiche Blöcke bleiben `moved`: eine falsche Zuordnung überschriebe einen fremden Block, ein verlorener Lauf kostet nur eine Runde
 *  (REGISTRY „Zeilenbasiertes Ziel braucht einen Inhalts-Fingerabdruck“). Ebenso bleibt `changed`, wenn auf den gemerkten Zeilen ein Block gleicher Sprache und
 *  Länge mit anderem Rumpf steht: ob der Nutzer ihn geändert hat oder ein Nachbar nachgerutscht ist, sagt der Text nicht, und die Umlenkung träfe im ersten Fall
 *  eine Kopie. Welcher Zaun die Zeilen schließt (Backtick, Tilde), ist für das Wiederfinden gleich: der Schreiber ersetzt nur Zeilen zwischen den Zäunen. */
export async function locateBlock(ports: WritePorts, t: BlockTarget, lang: string): Promise<Located> {
  const text = await readNoteText(ports, t.path);
  const want = lang.toLowerCase();
  const fences = listFences(text);
  const here = fences.find((f) => f.openLine === t.lineStart && f.lang === want && f.closeLine === t.lineEnd);
  if (here) return normBody(here.body) === normBody(t.body) ? { fence: here, text, relocated: false } : { problem: "changed" };
  const span = t.lineEnd - t.lineStart;
  const same = fences.filter((f) => f.lang === want && f.closeLine - f.openLine === span && f.closed && normBody(f.body) === normBody(t.body));
  const only = same.length === 1 ? same[0] : undefined;
  return only ? { fence: only, text, relocated: true } : { problem: "moved" };
}

/** Der Rumpf des Blocks jetzt (LF-normalisiert) für das Panel; `null`, wenn Block oder Notiz nicht (mehr) auffindbar oder verändert sind. Wirft nie. */
export async function readBlockText(ports: WritePorts, t: BlockTarget, lang: string): Promise<string | null> {
  try {
    const found = await locateBlock(ports, t, lang);
    return "fence" in found ? found.fence.body : null;
  } catch {
    return null;
  }
}

/** Der Block, den ein Einfügen neu in die Notiz gesetzt hat: der erste Zaun der Sprache `spec.fenceLang` mit diesem Rumpf ab der ersten Zeile, in der sich die Notiz geändert hat.
 *  Was davor steht, ist unverändert (auch ein gleicher Block weiter oben); der neue steht an der Änderung oder dahinter, vor einem gleichen weiter unten. `null`: nichts Passendes,
 *  dann gibt es kein `retarget` (nichts geraten). Die Beschriftung kommt von `spec.blockLabel`, Standard `<Notizname ohne .md>:<Öffnungszeile + 1>`.
 *  Herkunft: `svg-studio/src/obsidian/accept.ts` (`blockAfterInsert`, Review C4), dort mit fester Sprache und `Notiz:Zeile` als einziger Beschriftung; hier verschoben, damit der
 *  Baustein den Pfad einer neuen Datei und die Lage eines neuen Blocks selbst liefert, statt dass der Aufrufer die Meldungstexte abfängt. */
export function blockAfterInsert(spec: Pick<AcceptSpec, "fenceLang" | "blockLabel">, notePath: string, before: string, after: string, body: string): Target | null {
  const lines = (text: string): string[] => text.split(/\r?\n/);
  const was = lines(before);
  const now = lines(after);
  let changed = 0;
  while (changed < was.length && changed < now.length && was[changed] === now[changed]) changed++;
  const lang = spec.fenceLang.toLowerCase();
  const hit = listFences(after).find((f) => f.openLine >= changed && f.lang === lang && normBody(f.body) === normBody(body));
  if (hit === undefined) return null;
  const name = notePath.split("/").pop() ?? notePath;
  const label = spec.blockLabel?.(notePath, hit.openLine, hit.body) ?? `${name.replace(/\.md$/i, "")}:${String(hit.openLine + 1)}`;
  return { kind: "block", path: notePath, lineStart: hit.openLine, lineEnd: hit.closeLine, label, body: hit.body };
}

/** Der Haken, den der Rahmen als `AcceptSpec.beforeWrite` einsetzt: `snapshotFile` mit der `pluginId` des Plugins (`file-snapshot`); ein `ok: false` wird ein Wurf mit dem Text aus `failed(path, Grund)`,
 *  und `acceptPanel` schreibt dann nicht. Ein Plugin kann den Schnappschuss so nicht auslassen. */
export function snapshotBeforeWrite(app: App, pluginId: string, failed: (path: string, reason: string) => string): (path: string, oldText: string) => Promise<void> {
  return async (path, oldText) => {
    const r = await snapshotFile(app, { pluginId, path, content: oldText });
    if (!r.ok) throw new Error(failed(path, r.message));
  };
}

/* ── Übernehmen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Schreibt das Ergebnis des Panels in `target`. Wirft nie; `kind: "create"` verweigert ein bestehendes Ziel. `where` legt für das Ziel `new` den Schreibweg ausdrücklich fest
 *  (`"block"` am Cursor, `"file"` als Anhang); mit `where` werden `env.settings` und `env.choose` nie gerufen. Für Block und Datei als Ziel gibt es nichts zu wählen. */
export async function acceptPanel(env: AcceptEnv, spec: AcceptSpec, target: Target, kind: "create" | "refine", where?: "block" | "file"): Promise<AcceptOutcome> {
  try {
    if (target.kind === "other") return { ok: false, message: env.strings.unsupported(target.label) };
    // Ein `create` baut aus dem Nichts: auf einem bestehenden Block oder einer Datei würde es dessen Inhalt kommentarlos ersetzen.
    if (kind === "create" && (target.kind === "block" || target.kind === "file")) return { ok: false, message: env.strings.cannotReplace };
    if (target.kind === "block") return await acceptIntoBlock(env, spec, target);
    if (target.kind === "file") return await acceptIntoFile(env, spec, target);
    return await acceptAsNew(env, spec, where);
  } catch (error) {
    return { ok: false, message: env.strings.couldNotApply(errorMessage(error)) };
  }
}

/** Die letzte Prüfung vor jedem Schreiben; `null` = darf geschrieben werden. */
function refuse(env: AcceptEnv, spec: AcceptSpec, text: string): AcceptOutcome | null {
  const problem = spec.checkWrite?.(text) ?? null;
  return problem === null ? null : { ok: false, message: env.strings.notApplied(problem) };
}

async function acceptIntoBlock(env: AcceptEnv, spec: AcceptSpec, t: BlockTarget): Promise<AcceptOutcome> {
  const { strings } = env;
  const found = await locateBlock(env.ports, t, spec.fenceLang);
  if ("problem" in found) return { ok: false, message: found.problem === "moved" ? strings.blockMoved : strings.blockChanged };
  const { fence, text } = found;
  // Ein Block hinter einem Listenmarker (`- ```svg`) wird gelesen (Vorschau, `retarget`), aber nicht beschrieben: `Fence` trägt den Einzug des Punkts nicht, der Schreiber prüft die Öffnungszeile und
  // würfe `BlockChangedError`, nachdem der Schnappschuss schon liegt. Die Prüfung steht vor `compute`, `checkWrite` und `beforeWrite`: kein Schnappschuss, kein Schreiben, eine ehrliche Meldung.
  if (!OPENS_WITH_FENCE.test(text.split(/\r?\n/)[fence.openLine] ?? "")) return { ok: false, message: strings.blockInList ?? BLOCK_IN_LIST_TEXT.en };
  const result = spec.compute(fence.body);
  if (!result.ok) return { ok: false, message: strings.notApplied(result.problem) };
  // Wiedergefundener Block: auch ohne Schreiben bekommt der Aufrufer die neue Lage, sonst sucht das Panel in der nächsten Runde wieder an der alten Stelle.
  const moved: Target | undefined = found.relocated ? { ...t, lineStart: fence.openLine, lineEnd: fence.closeLine, body: fence.body } : undefined;
  if (normBody(result.text) === normBody(fence.body)) return moved ? { ok: true, message: strings.unchanged, retarget: moved } : { ok: true, message: strings.unchanged };
  const refused = refuse(env, spec, result.text);
  if (refused) return refused;
  if (closesFence(text.split(/\r?\n/)[fence.openLine] ?? "", result.text)) return { ok: false, message: strings.closesFence };
  // Der Rückweg zuerst, erst nach allen Ablehnungen oben (ein Schnappschuss ohne Schreiben wäre Platzverbrauch): wirft der Haken, wird nichts geschrieben, und `acceptPanel` meldet es über `couldNotApply`.
  // Der Haken bekommt den ganzen alten Notiztext aus `locateBlock` (Editorstand, siehe Kopf); der Fingerabdruck bleibt der Rumpf, ein Tippen außerhalb des Blocks zwischen Haken und Schreiben verhindert das Schreiben nicht.
  await spec.beforeWrite?.(t.path, text);
  try {
    // `fence.body` ist der Text, gegen den der Schreiber vor dem Schreiben noch einmal prüft (Rumpf unverändert).
    await writeBlockBody(env.ports, { path: t.path, lineStart: fence.openLine, lineEnd: fence.closeLine, fence: spec.fenceLang }, fence.body, result.text);
  } catch (error) {
    if (error instanceof BlockChangedError) return { ok: false, message: strings.noteChanged };
    throw error;
  }
  // Schlusszeile = Öffnungszeile + Rumpfzeilen + 1.
  const lineEnd = fence.openLine + result.text.split("\n").length + 1;
  return { ok: true, message: strings.appliedTo(t.label), retarget: { ...t, lineStart: fence.openLine, lineEnd, body: result.text } };
}

async function acceptIntoFile(env: AcceptEnv, spec: AcceptSpec, t: Extract<Target, { kind: "file" }>): Promise<AcceptOutcome> {
  const { strings, app } = env;
  const file = app.vault.getAbstractFileByPath(t.path);
  if (!(file instanceof TFile)) return { ok: false, message: strings.fileGone(t.path) };
  // `readNoteText`, nicht `vault.read`: ist die Notiz im Quellmodus offen, gilt der Editorstand (auch ungespeichert), derselbe, über den `swapNote` schreibt.
  const seen = await readNoteText(env.ports, t.path);
  const result = spec.compute(seen);
  if (!result.ok) return { ok: false, message: strings.notApplied(result.problem) };
  if (result.text === seen) return { ok: true, message: strings.unchanged };
  const refused = refuse(env, spec, result.text);
  if (refused) return refused;
  // Der Rückweg zuerst: wirft der Haken, wird nichts geschrieben. Der Schnappschuss trägt damit genau den Text, der überschrieben wird.
  await spec.beforeWrite?.(t.path, seen);
  // Geschrieben wird nur, wenn die Notiz noch der Text ist, von dem der Schnappschuss und `compute` ausgingen (Vergleich ohne BOM, `\r\n` als `\n`); sonst entsteht höchstens ein Schnappschuss zu viel.
  // Kein Warten auf die Platte (`persistWaitMs: 0`): wer danach weiterarbeitet, liest mit `readNoteText` aus derselben Quelle.
  const written = await swapNote(env.ports, t.path, seen, result.text, { persistWaitMs: 0 });
  if (written.kind === "stale") return { ok: false, message: strings.noteChanged };
  if (written.kind === "error") return { ok: false, message: strings.couldNotApply(errorMessage(written.error)) };
  if (written.kind === "same") return { ok: true, message: strings.unchanged };
  return { ok: true, message: strings.appliedTo(t.label) };
}

async function acceptAsNew(env: AcceptEnv, spec: AcceptSpec, whereGiven?: "block" | "file"): Promise<AcceptOutcome> {
  const { strings } = env;
  const result = spec.compute(null);
  if (!result.ok) return { ok: false, message: strings.notApplied(result.problem) };
  const refused = refuse(env, spec, result.text);
  if (refused) return refused;
  let where: "block" | "file" | null = "block";
  if (whereGiven !== undefined) {
    where = whereGiven;
  } else if (spec.newFile) {
    // Altbestand ohne `where`: die Einstellung und die Rückfrage des Aufrufers. Fehlen beide, gilt `"block"` (wie für einen Spec ohne `newFile`).
    const setting = env.settings?.().acceptAs ?? "block";
    where = setting === "ask" ? (env.choose ? await env.choose() : "block") : setting;
    if (where === null) return { ok: false, message: strings.cancelled };
  }
  return where === "block" ? insertAsBlock(env, spec, result.text) : createAsFile(env, spec, result.text);
}

/** Text ans Ende der Notiz hängen (Lesemodus), mit Leerzeile davor, in den Zeilenenden der Notiz. Endet die Notiz in einem nie geschlossenen Zaun, würde der
 *  Text zu dessen Inhalt und unser Schlusszaun schlösse den Zaun des Nutzers: `UnclosedFenceError`, nichts geschrieben (derselbe Wächter wie `insertAtCursor`).
 *  „Endet in“ heißt: der letzte Zaun ist offen UND reicht bis zur letzten Zeile. Seit code-kit 0.88.0 endet ein offener Zaun unter einem Listenpunkt mit dem
 *  Punkt (`- a` / `  ```js` / `b`: Zaun auf Zeile 1 bis 1, `closed: false`); der Text dahinter ist kein Code, Anhängen ist sicher (Welle 37, kw37c, Teil B,
 *  Task „Zaun-Leser — drei Reste nach 0.88.0“, Rest 3). */
async function appendToNote(env: AcceptEnv, path: string, text: string): Promise<void> {
  await env.ports.vault.process(path, (cur) => {
    const last = listFences(cur).at(-1);
    if (last && !last.closed && last.closeLine === cur.split(/\r?\n/).length - 1) throw new UnclosedFenceError(false);
    const eol = detectEol(cur);
    const gap = cur === "" ? "" : cur.endsWith("\n") ? eol : eol + eol;
    return `${cur}${gap}${text.replace(/\r?\n/g, eol)}${eol}`;
  });
}

async function insertAsBlock(env: AcceptEnv, spec: AcceptSpec, text: string): Promise<AcceptOutcome> {
  const { strings } = env;
  const src = sourceViewOf(env.lastEditor());
  if ("none" in src) return { ok: false, message: strings.noNoteOpen };
  if ("reading" in src) {
    if (env.readingMode === "refuse") return { ok: false, message: strings.noteInReadingView };
    // Der Pfad wird einmal gemerkt: Vorher, Anhängen und Nachher gelten derselben Notiz, auch wenn die zuletzt aktive Notiz während der `await`s wechselt (svg-studio d67cfd4 las `before` und `after` ebenso aus dem Pfad
    // der beschriebenen Notiz). Der Text vorher und nachher kommt mit `readNoteText` aus derselben Quelle wie in `insertAsBlock` im Quellmodus; kein Treffer heißt kein `retarget`, nichts geraten.
    const appendPath = src.reading.file?.path ?? "";
    const before = appendPath === "" ? null : await readNoteText(env.ports, appendPath).catch(() => null);
    try {
      await appendToNote(env, appendPath, spec.wrap(text));
    } catch (error) {
      const refusal = fenceRefusal(error, strings);
      if (refusal !== null) return { ok: false, message: refusal };
      throw error;
    }
    const after = appendPath === "" || before === null ? null : await readNoteText(env.ports, appendPath).catch(() => null);
    const appended = after === null || before === null ? null : blockAfterInsert(spec, appendPath, before, after, text);
    return appended !== null ? { ok: true, message: strings.appendedToNote, retarget: appended } : { ok: true, message: strings.appendedToNote };
  }
  const notePath = src.view.file?.path ?? null;
  // Text VOR dem Einfügen merken: nur der Vergleich vorher/nachher findet den neuen Block. Gelesen mit `readNoteText` (Editor zuerst), aus derselben Quelle wie das Einfügen.
  const before = notePath === null ? null : await readNoteText(env.ports, notePath).catch(() => null);
  try {
    const where = insertAtCursor(src.view, `\n${spec.wrap(text)}\n`);
    const after = notePath === null || before === null ? null : await readNoteText(env.ports, notePath).catch(() => null);
    const block = notePath !== null && before !== null && after !== null ? blockAfterInsert(spec, notePath, before, after, text) : null;
    return block !== null ? { ok: true, message: strings.appliedAsBlock(where), retarget: block } : { ok: true, message: strings.appliedAsBlock(where) };
  } catch (error) {
    const refusal = fenceRefusal(error, strings);
    if (refusal !== null) return { ok: false, message: refusal };
    throw error;
  }
}

/** Die Meldung zu einer Ablehnung durch einen Zaun (`UnclosedFenceError`, `NestedFenceError`), sonst `null`. */
function fenceRefusal(error: unknown, strings: AcceptStrings): string | null {
  if (error instanceof UnclosedFenceError) return strings.unclosedFence(error.selected);
  if (error instanceof NestedFenceError) return (strings.nestedFence ?? NESTED_FENCE_FALLBACK)(error.selected);
  return null;
}

async function createAsFile(env: AcceptEnv, spec: AcceptSpec, text: string): Promise<AcceptOutcome> {
  const { strings, app } = env;
  const make = spec.newFile;
  if (!make) return { ok: false, message: strings.couldNotApply("no file format") };
  const src = sourceViewOf(env.lastEditor());
  const noteView = "view" in src ? src.view : "reading" in src ? src.reading : null;
  const notePath = noteView?.file?.path ?? null;
  const spec1 = make(text);
  const created = await createAttachmentFile(app, { name: spec1.name, notePath, content: spec1.content });
  if (!created.ok) {
    return { ok: false, message: created.code === "exists" ? strings.fileExists(created.path) : strings.couldNotCreate(created.path, created.message) };
  }
  const { path } = created;
  // Ab hier besteht die Datei: nichts darf mehr als `ok: false` („nichts angewendet“) enden, sonst legt der nächste Versuch `bild 1.svg` daneben an.
  // Jedes dieser Ergebnisse trägt `retarget` auf die Datei, auch wenn der Verweis nicht gesetzt wurde: das Panel arbeitet auf der Datei weiter, statt eine zweite neu anzulegen.
  const retarget: Target = { kind: "file", path, label: path.split("/").pop() ?? path };
  const done = (message: string): AcceptOutcome => ({ ok: true, message, retarget });
  try {
    if ("none" in src) return done(strings.savedFileNoReference(path, "no-note"));
    const reference = spec1.reference(app.metadataCache.fileToLinktext(created.file, notePath ?? "", false));
    // Das Anlegen hatte `await`s: die zuletzt aktive Notiz kann inzwischen eine andere sein oder im Lesemodus stehen. Der Verweis geht nur dorthin, wo er gebaut wurde.
    const now = sourceViewOf(env.lastEditor());
    const nowView = "view" in now ? now.view : "reading" in now ? now.reading : null;
    if (nowView?.file?.path !== notePath || "view" in now !== "view" in src) return done(strings.savedFileNoReference(path, "note-changed"));
    if ("reading" in now) {
      if (env.readingMode === "refuse") return done(strings.savedFileNoReference(path, "reading"));
      await appendToNote(env, notePath ?? "", reference);
      return done(strings.savedFileAppended(path));
    }
    insertAtCursor((now as { view: MarkdownView }).view, `\n${reference}\n`);
    return done(strings.savedFileWithReference(path));
  } catch (error) {
    const reason = fenceRefusal(error, strings) ?? errorMessage(error);
    return done(strings.savedFileReferenceFailed(path, reason));
  }
}
