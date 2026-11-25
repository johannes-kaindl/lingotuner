// vendored from obsidian-kit@0.112.0, src/obsidian/prompt-text.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { App, ButtonComponent, Modal } from "obsidian";

/** Texteingabe-Dialog hinter einer Promise-Fassade (Gegenstück zu `confirmAction` und `askChoice`, die Knopfdialoge sind).
 *
 *  Herkunft (n=3 im Bestand, gelesen am 2026-11-04): `finance-ledger/src/ui/promptModal.ts` (Vorlage: ein Feld, Enter, Promise), `diachronic/src/obsidian/comment-modal.ts`
 *  (Textarea, Enter sendet, leer gilt als Abbruch) und `anysource-sideloader/src/obsidian/install-url-modal.ts` (Enter, leer bleibt offen, kein Abbrechen-Knopf).
 *  Was die drei unterscheidet, ist hier Parameter oder hat einen Grund:
 *
 *  - **Leere Eingabe** (finance: liefert `""`, diachronic: liefert `null`, anysource: tut nichts): der Dialog bleibt offen und gibt dem Feld den Fokus zurück; eine Antwort
 *    „nichts“ ist `allowEmpty`. Grund: `null` ist ausschließlich „Abbruch“ (ein Aufrufer, der `null` und `""` gleich behandelt, verliert den Unterschied zwischen „will nicht“ und
 *    „hat nichts geschrieben“), und ein stilles Nichts (anysource) lässt den Nutzer raten.
 *  - **Leerraum** (finance: unverändert, diachronic und anysource: trimmen): standardmäßig getrimmt, `trim: false` für die Ausnahme. Grund: Leerraum am Rand eines getippten
 *    Namens oder Kommentars ist nie gewollt.
 *  - **Enter im mehrzeiligen Feld** (diachronic: Enter sendet, Umschalt+Enter macht eine Zeile): hier macht Enter eine Zeile und Strg/Cmd+Enter sendet. Grund: ein Kommentar
 *    ist Text, Enter ist darin der Zeilenumbruch; ein versehentliches Senden eines halb geschriebenen Absatzes verliert die Eingabe. Der iPhone-Weg (Knöpfe) bleibt.
 *  - **Enter während einer IME-Komposition** (nur diachronic prüfte es): bestätigt nie den Dialog, sondern nur die Komposition (`isComposing`, `keyCode` 229 bei Safari).
 *  - **Abbrechen-Knopf** (anysource hatte keinen): immer da, links; Escape und Klick daneben liefern ebenfalls `null`. Grund: auf dem iPhone gibt es kein Escape.
 *  - **Knopfreihe** (finance: `Setting`-Zeile): der native `modal-button-container`, Abbrechen links, OK rechts als Hauptknopf (UI-STANDARD § 2, wie `confirmAction`).
 *  - **Beschriftung** (alle drei: `t()` des Plugins): Parameter, englische Vorgaben; das Kit bleibt i18n-frei.
 *  - **Prüfung** (nur der Aufrufer von anysource prüfte die Adresse nach dem Schließen): `validate` liefert eine Meldung oder `null`; die Meldung steht im Dialog
 *    (`role="alert"`, am Feld über `aria-describedby`), der Dialog bleibt offen. Sie erscheint erst nach dem ersten Bestätigen und folgt dann der Eingabe.
 *
 *  Zwei Details, die tragen: `finish()` nullt den Callback VOR dem Auflösen (Klick plus nachlaufendes `onClose` lösen sonst doppelt auf), und `onClose()` löst mit `null` auf
 *  (sonst hängt das Promise bei Escape oder Klick daneben). */
export interface PromptTextOptions {
  /** Titelzeile des Dialogs; zugleich der Name des Feldes für Screenreader. */
  title: string;
  /** Optionaler Text unter dem Titel: ein Absatz oder eine Zeile je Array-Element. */
  message?: string | string[];
  /** Platzhalter im leeren Feld. */
  placeholder?: string;
  /** Vorbelegung. Einzeilig ist sie markiert (ein Tippen ersetzt sie), mehrzeilig nicht. */
  initial?: string;
  /** Vorgabe `"OK"`. */
  okLabel?: string;
  /** Vorgabe `"Cancel"`. */
  cancelLabel?: string;
  /** `true` → Textarea; Enter macht eine neue Zeile, Strg/Cmd+Enter bestätigt. Vorgabe: einzeiliges Feld, Enter bestätigt. */
  multiline?: boolean;
  /** Zeilen der Textarea (nur mit `multiline`). Vorgabe 5. */
  rows?: number;
  /** `true` → auch eine leere Eingabe ist eine Antwort (`""`). Vorgabe `false`: der Dialog bleibt offen. */
  allowEmpty?: boolean;
  /** `false` → der Text wird nicht getrimmt. Vorgabe `true`. */
  trim?: boolean;
  /** Prüft den (getrimmten) Text beim Bestätigen: eine Meldung hält den Dialog offen und steht im Dialog, `null` lässt die Antwort durch. Wird bei einer leeren Eingabe ohne `allowEmpty` nicht gerufen. */
  validate?: (value: string) => string | null;
}

/** Der Ausschnitt eines Tastaturereignisses, den die Entscheidung braucht (der Test baut ihn ohne DOM). */
export interface PromptKeyEvent { key: string; isComposing?: boolean; keyCode?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }

/** Was eine Taste im Feld bewirkt: `"submit"` oder `null` (die Taste gehört dem Feld). Rein, damit die Tabelle ohne DOM prüfbar ist. */
export function promptKeyAction(e: PromptKeyEvent, multiline: boolean): "submit" | null {
  if (e.key !== "Enter") return null;
  if (e.isComposing === true || e.keyCode === 229) return null;
  if (multiline && e.ctrlKey !== true && e.metaKey !== true) return null;
  return "submit";
}

let nextId = 0;

class PromptTextModal extends Modal {
  private done: ((value: string | null) => void) | null;
  private field!: HTMLInputElement | HTMLTextAreaElement;
  private errorEl: HTMLElement | null = null;
  /** Nach dem ersten gescheiterten Bestätigen folgt die Meldung der Eingabe; vorher schweigt der Dialog. */
  private checking = false;
  private readonly errorId = `okit-prompt-error-${(nextId += 1)}`;

  constructor(app: App, private readonly opts: PromptTextOptions, done: (value: string | null) => void) {
    super(app);
    this.done = done;
  }

  onOpen(): void {
    const { opts, contentEl } = this;
    this.titleEl.setText(opts.title);
    const message = opts.message;
    if (message !== undefined) for (const line of Array.isArray(message) ? message : [message]) contentEl.createEl("p", { text: line });
    const multiline = opts.multiline === true;
    const attr: Record<string, string> = { "aria-label": opts.title };
    if (opts.placeholder !== undefined) attr.placeholder = opts.placeholder;
    if (multiline) attr.rows = String(opts.rows ?? 5);
    else attr.type = "text";
    this.field = contentEl.createEl(multiline ? "textarea" : "input", { cls: "okit-prompt-field", attr });
    this.field.value = opts.initial ?? "";
    const target: HTMLElement = this.field;
    target.addEventListener("keydown", (e: KeyboardEvent) => {
      if (promptKeyAction(e, multiline) !== "submit") return;
      e.preventDefault();
      this.submit();
    });
    target.addEventListener("input", () => { if (this.checking) this.check(); });
    // Die Meldung steht von Anfang an im DOM (leer, per CSS ausgeblendet): ein `role="alert"`, das erst beim Fehler entsteht, wird von manchen Screenreadern nicht vorgelesen.
    this.errorEl = contentEl.createDiv({ cls: "okit-prompt-error", attr: { id: this.errorId, role: "alert" } });
    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(opts.cancelLabel ?? "Cancel").onClick(() => { this.finish(null); });
    new ButtonComponent(btns).setButtonText(opts.okLabel ?? "OK").setCta().onClick(() => { this.submit(); });
    this.field.focus();
    if (!multiline && this.field.value !== "") (this.field as HTMLInputElement).select();
  }

  onClose(): void {
    this.finish(null);
    this.contentEl.empty();
  }

  /** Der Text, wie er abgegeben würde. */
  private current(): string {
    const raw = this.field.value;
    return this.opts.trim === false ? raw : raw.trim();
  }

  /** `null` heißt gültig. Eine leere Eingabe ohne `allowEmpty` ist ungültig, ohne dass es einen Text dazu gibt (der Fokus kehrt zurück, das Feld ist als ungültig markiert). */
  private problem(): string | null {
    const value = this.current();
    if (this.opts.allowEmpty !== true && value.trim() === "") return "";
    return this.opts.validate?.(value) ?? null;
  }

  /** Zeichnet den Zustand des Feldes zur aktuellen Eingabe; liefert, ob sie gültig ist. */
  private check(): boolean {
    const problem = this.problem();
    const bad = problem !== null;
    if (bad) {
      this.field.setAttribute("aria-invalid", "true");
      if (problem !== "") this.field.setAttribute("aria-describedby", this.errorId);
      else this.field.removeAttribute("aria-describedby");
    } else {
      this.field.removeAttribute("aria-invalid");
      this.field.removeAttribute("aria-describedby");
    }
    this.errorEl?.setText(problem ?? "");
    return !bad;
  }

  private submit(): void {
    if (this.done === null) return;
    this.checking = true;
    if (!this.check()) {
      this.field.focus();
      return;
    }
    this.finish(this.current());
  }

  private finish(value: string | null): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(value);
    this.close();
  }
}

/** Öffnet den Dialog; löst mit dem Text auf, mit `null` bei Abbrechen, Escape, Klick daneben oder Schließen. Eine leere Eingabe ist `""` nur mit `allowEmpty`.
 *  @example const name = await promptText(app, { title: "Name des Standes", placeholder: "z. B. vor der Überarbeitung", okLabel: "Speichern" });
 *  if (name !== null) save(name); */
export function promptText(app: App, opts: PromptTextOptions): Promise<string | null> {
  return new Promise((resolve) => {
    new PromptTextModal(app, opts, resolve).open();
  });
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS. Nur Theme-Variablen. */
export const PROMPT_TEXT_CSS = `
/* Ein Feld füllt die Zeile: eine Adresse oder ein Kommentar ist lang, und ein Feld von Standardbreite schnitt den Platzhalter ab (anysource-sideloader, asl-url-field). */
.okit-prompt-field { display: block; width: 100%; box-sizing: border-box; }
textarea.okit-prompt-field { resize: vertical; min-height: calc(var(--size-4-12) * 2); }
/* Mit Fokus gewinnt Obsidians input:focus (Rand und Schein in der Fokusfarbe, gemessen 1.15.1: der Fehlerrand blieb grau), also nennt die Regel den Fokus mit. */
.okit-prompt-field[aria-invalid="true"], .okit-prompt-field[aria-invalid="true"]:focus { border-color: var(--text-error); }
.okit-prompt-field[aria-invalid="true"]:focus { box-shadow: 0 0 0 2px var(--text-error); }
/* Die Meldung ist Text (der zweite Kanal neben der Randfarbe); leer behält sie ihren Platz nicht, der Dialog darf beim ersten Fehler wachsen. */
.okit-prompt-error { margin: var(--size-4-1) 0 0; color: var(--text-error); font-size: var(--font-ui-small); }
.okit-prompt-error:empty { display: none; }
`;
