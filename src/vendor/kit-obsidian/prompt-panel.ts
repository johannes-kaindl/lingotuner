// vendored from obsidian-kit@0.112.0, src/obsidian/prompt-panel.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Rahmen der Auftrags-Fenster (K9, Welle 36): zeichnet die acht Stationen eines Fensters, das einen Auftrag an ein Modell gibt, das Ergebnis zeigt und es auf Knopfdruck schreibt.
// Herkunft: svg-studio@0.1.4 `src/obsidian/panel/shell.ts` (`buildPanelShell`, 628 Zeilen), verschoben und auf den Halter umgebaut; die Tests stammen aus `tests/obsidian/panel-shell.test.ts`
// (17 Tests, von happy-dom auf das Fake-DOM des Kits umgeschrieben). Spec: Cockpit `_SDD/2026-11-15-auftrags-fenster-rahmen-design`, Plan `…-plan-etappe-1-3`.
//
// ## Zwei Lebensdauern
//
// Der Rahmen lebt, solange das Fenster offen ist. Lauf, Sitzung, Puffer des Laufs und der halb getippte Auftrag leben im Halter (`PanelHost`, code-kit `panel-host`) und überstehen das Schließen.
// Der Rahmen hält keinen eigenen Zustand der Sitzung: er meldet sich beim Bauen als Zuhörer am Halter an und zeichnet aus `host.session()` und `host.live()`. `destroy()` meldet nur ab, es bricht
// nichts ab; ein neuer Rahmen am selben Halter zeigt den bisherigen Text sofort und läuft weiter mit. Zwei Rahmen am selben Halter (geteiltes Fenster) führen nie zu zwei Läufen.
//
// ## Die acht Stationen (Reihenfolge von oben nach unten, zugleich der Tastaturweg)
//
// 1 Ziel und „Neu“ · 2 Modellzeile (Kit `buildModelBar`, gesperrt im Lauf und beim Schreiben) · 3 Platz für die eigenen Bedienteile, Auftragsfeld, Senden/Abbrechen · 4 Antwortbereich mit Statuszeile
// (`aria-live="polite"`) · 5 Vorschau und Änderungen · 6 Runden · 7 Übernehmen (ein Knopf je Schreibweg, der erste ist der Hauptknopf), Verwerfen · 8 Schließen (`requestClose`).
//
// ## Was der Rahmen garantiert, nicht das Plugin
//
// - **Übernehmen** läuft immer über `host.accept` und `acceptPanel`. Den Haken `beforeWrite` setzt der Rahmen selbst (`snapshotBeforeWrite` mit `deps.pluginId`); ein `beforeWrite` in `way.spec`
//   wird überschrieben, und es gibt keinen Parameter, der den Schnappschuss abschaltet. Wirft `way.prepare`, wird nichts geschrieben. Ein Doppelklick schreibt einmal (Sperre im Halter).
// - **Eingaben gehen nie verloren.** Das Auftragsfeld wird aus `live().draft` nur beim Aufbau und nach einem Ergebnis gefüllt, das eine Runde ist (dann ist der Entwurf leer), nie bei einem anderen Ereignis.
//   Bei Fehler und Abbruch bleibt der Text im Feld.
// - **Prüfliste und Felder werden am Ende jedes Laufs und jedes Schreibens neu gezeichnet** (Übergang von `busy()` wahr nach falsch, über `run` und `apply`; Erfolg, Abbruch, Fehler, fehlgeschlagenes Übernehmen),
//   damit ihre Slots den Zustand selbst bestimmen: Sperren, die ein Slot setzt, bleiben seine Sache. Der Rahmen selbst sperrt beide im Lauf nur zu, nie auf (`renderControls`), und das Ereignis `session` kommt noch im
//   Lauf, zeichnet sie also gesperrt. Ohne das Neuzeichnen blieben nach jedem Verfeinern der Ablehnen-Knopf und die Zahlenfelder gesperrt (gemessen von svg-studio am Rahmen 0.96.0). Die Vorschau wird dabei nicht
//   neu gezeichnet (teuer, und ein neues Ticket verwürfe ein laufendes Zeichnen); die Felder bekommen den Text, den die Vorschau zeigt, Runde oder Bestand.
// - **Ids sind je Rahmen eindeutig** (Zähler im Modul): die Hinweise an gesperrten Schreibwegen tragen `okit-prompt-panel-<n>-…`.
// - **Eine asynchrone Vorschau, die nach einem neueren Zeichnen fertig wird, schreibt nicht mehr in den Platz:** jedes Zeichnen bekommt ein eigenes Wurzelelement, das beim nächsten Zeichnen
//   mit dem alten Inhalt abgehängt wird; dazu sagt `ctx.current()` dem Slot, ob sein Zeichnen noch gilt.
// - **Antworttext aus dem Modell und der Linkschutz (Station 4 und 5):** der Antwortbereich zeigt den laufenden Text über `StreamArea.setTail`, und das setzt reinen Text (`tailEl.setText`, `stream-area.ts`),
//   es rendert kein Markdown. Ein gestreamtes `![](https://…)` wird deshalb nie ein `img` (Test `rendert keinen Markdown`). Was ein Plugin in der Vorschau (`renderPreview`) selbst rendert, ist seine Sache
//   und läuft für Modelltext über `neutralizeModelMarkdown` (`.claude/rules/fernquellen.md`).
//
// ## Abweichungen von `shell.ts`, mit Grund
//
// - **`requestClose()` liefert `void`, nicht `boolean`** (shell.ts: „schließen ja/nein“). Grund: Obsidian wartet in `onClose` nicht auf einen Dialog, die Ansicht ist beim Antworten schon weg. Der Dialog läuft deshalb nach
//   `destroy()` weiter und erreicht den **Halter**, nicht den Rahmen: „Verwerfen“ ruft `host.discard()`, jeder andere Ausgang lässt die Sitzung beim Halter (Test „Schließen: der Dialog läuft nach destroy weiter“). Wer
//   `onClose` baut (Etappe 3), ruft `void panel.requestClose()` und danach `panel.destroy()`; ein Rückgabewert, der über das Schließen entschiede, gäbe es nicht mehr zu entscheiden.
// - **Jedes Zeichnen der Vorschau bekommt ein eigenes Wurzelelement.** Grund: `ctx.current()` schützt nur einen Slot, der es nach dem `await` fragt; das Element schützt auch einen, der es vergisst (Spec § 11: eine späte
//   Vorschau schreibt nicht mehr in den Platz).
// - **Die Schreibweg-Knöpfe bleiben stabil** (`renderWays`): bei gleicher Form der Wegliste (Anzahl, Beschriftungen, Reihenfolge) behält `refreshAccept()` und jedes andere Neuzeichnen die Knopf-Elemente und setzt nur das Weg-Objekt
//   neu; der Klick liest den Weg zur Klickzeit. shell.ts baute sie bei jedem Aufruf neu. Grund: der `mousedown` auf einen Knopf aktiviert das Blatt des Fensters, das Plugin ruft dabei `refreshAccept()`, und ein ersetzter
//   Knopf bekommt das `mouseup` ohne `mousedown` (kein `click`): Übernehmen verpuffte ohne Meldung (gemessen von svg-studio im echten Obsidian, Rahmen 0.98.0). Gleiche Falle an anderen Stellen, mit Urteil: **Hinweise (`notices`)** sind Knöpfe des Plugins, und `host.offer` meldet `target` (ohne Runde und Lauf auch `session`, mit neuem Sitzungsobjekt) bei jedem Angebot, auch bei einem
//   Blattwechsel ohne Zieländerung; `renderNotices` zeichnet sie deshalb nur neu, wenn sich ihr Schlüssel ändert (Ziel nach `sameTarget` mit Zeilen und Blockinhalt, `kept`, `offered`, die übrigen Sitzungsfelder per Referenz), in
//   jedem Weg, der sie zeichnet (`target`, `session`, `renderAll`); der Kopf ersetzt keine Elemente (`setText`) und braucht den Schlüssel nicht, er folgt Modell und Güte. shell.ts baute die Hinweise bei jedem Ereignis neu (svg-studio: Reparatur-Knopf
//   verpuffte). Ein Slot, der von etwas außerhalb der Sitzung abhängt, zeichnet sich selbst neu (`setSession` mit neuem Feld oder eigener Aufruf).
//   Urteil je Slot (Teil 0e; die frühere Annahme „kein Blattwechsel“ stimmte nicht: ohne Runde ersetzt `offer` die Sitzung bei jedem Angebot und meldet `session`): **Bedienteile** (`renderControls`), **Prüfliste** (`renderChanges`) und **Felder**
//   (`renderFields`) tragen Knöpfe und Eingabefelder des Plugins und gelten für denselben Schlüssel samt `busy` (sie werden beim Zeichnen gesperrt), die Felder zusätzlich mit dem Text, den sie bekamen; erzwungen zeichnen sie am Ende eines
//   Laufs und Schreibens (`run`, `apply`, `releaseAfterBusy`). Die **Rundenliste** hängt nur an `session.rounds` und zeichnet bei einer anderen Referenz darauf. Die **Vorschau** zeichnet weiter bei jedem Angebot: sie ist der Weg, auf dem eine
//   auf der Platte geänderte Datei sichtbar wird (der Schlüssel kennt die Platte nicht), und sie trägt keine Bedienung des Rahmens. Die **Beispiele** sind feste Knöpfe (nur Sichtbarkeit), **Neu**, **Verwerfen**, **Senden** und **Abbrechen** feste Knöpfe.
// - **`refreshControls()` zeichnet die Bedienteile auf Zuruf neu (Welle 38, Teil D, Bestellung lingotuner).** Mit offenen Runden meldet der Halter einen Zielwechsel nur als `target`, und `target` zeichnet Station 3 nicht:
//   lingotuners Quellen-Chips und das Textfeld blieben auf dem alten Stand (Smoke ML1 bis ML7). Bewusst die Methode und kein Neuzeichnen bei jedem `target`: nur das Plugin weiß, wann sein Slot veraltet ist, und ein Neuzeichnen
//   bei jedem Angebot nähme allen Trägern den Fokus aus einem aktiven Feld (lingotuner Smoke B10). Im Lauf und beim Schreiben zeichnet sie nicht (Ergebnis `"busy"`): das Ende des Laufs zeichnet den Slot ohnehin neu
//   (`run`, `apply`). Fokus: steht er in einem Textfeld des Slots (`textarea`, `input` mit Texteingabe, `contenteditable`), wird das Neuzeichnen aufgeschoben (`"deferred"`) und geschieht einmal, sobald der Fokus den
//   Slot verlässt; auf einem anderen Element des Slots (Chip, Regler) zeichnet sie gleich und gibt den Fokus dem Element an derselben Stelle (Index unter den fokussierbaren Elementen des Slots) zurück, sonst niemandem.
// - **Keine Abweichung mehr beim Entsperren:** `shell.ts` zeichnete nach jedem Laufende alles neu (`runInner` `finally`, `stop()`: `settle(); renderAll()`); der erste Stand dieses Rahmens zeichnete nur die Bedienteile
//   (ein Fehler, keine gewollte Abweichung). Seit dem Fix zeichnet er Prüfliste und Felder neu und die Vorschau nicht; das ist der einzige Unterschied zum Neuzeichnen von allem, und er hat den Grund oben (die Vorschau ist teuer).
// - **Die Rundenliste erscheint ab zwei Runden** (`minItems` des Bausteins `buildVersionList`, Standard 2) wie in svg-studio, dem besten Exemplar; bei einer Runde zeigt die Vorschau sie ohnehin.
//
// ## Gemessen im echten Obsidian
//
// Pilot `pilot/prompt-panel.ts` (Gast `pilot/prompt-panel-view.ts`: Ansicht mit diesem Rahmen, Halter `createPromptPanelHost`, Lauf über Zeitgeber ohne Endpunkt), Lauf vom 2026-11-18 am Commit 7692339:
// **Obsidian 1.15.1** (`apiVersion`; die Programmhülle meldet im User-Agent 1.12.4), **macOS (MacIntel), Desktop**, Zweitinstanz mit frischem Profil, Live Preview. **10 von 10 grün**, nichts übersprungen, nichts ungemessen.
// Rohzeilen: `prompt-panel-rohzeilen.txt` im Planungsordner der Welle 36 (Kit-Linie). Ein erster Lauf am Commit 14ffbe6 galt nicht (ein fremder Lauf tauschte das Pilot-Plugin im Staging-Vault, Exit 6;
// dazu war Q8 durch einen Treiberfehler rot, nicht durch den Rahmen).
//
// - **Q1 grün** Senden mit Strg+Enter startet genau einen Lauf; der Antworttext wächst (35 → 78 Zeichen in 0,9 s), das Denken ist sichtbar; Abbrechen löst das `AbortSignal` aus, die Statuszeile sagt „Stopped.“,
//   der Auftragstext steht noch im Feld und im Entwurf.
// - **Q2 grün** Ansicht schließen im Lauf: der Lauf läuft weiter (Signal nicht ausgelöst), die Statusleiste zeigt „Pilot panel: running“; Wiederöffnen zeigt den bisherigen Text (35 → 134 → 174 Zeichen), den Auftrag im
//   Feld und den Abbrechen-Knopf, der Eintrag der Statusleiste ist weg.
// - **Q3 grün** Lauf endet bei geschlossener Ansicht: Meldung „… the result is ready …“, Eintrag „result waiting“, eine Runde in der Sitzung; beim Öffnen steht die Vorschau, der Eintrag ist weg.
// - **Q4 grün** Block ersetzen in einer Markdown-Notiz: genau ein neuer Schnappschuss unter `.obsidian/plugins/okit-pilot/snapshots/by-file/…`, mit dem ganzen alten Notiztext; Strg+Z (echte Taste) stellt die Notiz her.
//   Zwischen der letzten Änderung im Editor und Übernehmen lagen mehrere Sekunden (nicht gemessen, aber weit über den 600 ms aus Pilot `note-edit`, P9); der kurze Abstand von 100 ms ist hier nicht geprüft.
// - **Q5 grün** Einfügen an der Schreibmarke und „Save as file“ legen keinen Schnappschuss an (Anzahl 1 → 1 → 1).
// - **Q6 grün** Block von Hand geändert, dann Übernehmen: nichts geschrieben, Grund „Block changed: …“, die Runde bleibt, kein Schnappschuss.
// - **Q7 grün** Zwei Ansichten im geteilten Fenster am selben Halter: vier Ids `okit-prompt-panel-<n>-hint-<i>`, alle verschieden; ein Senden im zweiten Rahmen startet keinen zweiten Lauf; beide zeigen denselben Text.
// - **Q8 grün** Tab-Weg: Neu → Modellzeile (Auswahl, Neu laden) → Auftragsfeld → Senden → Gedankenblock/Kopierknopf → Rundenliste → Übernehmen → Verwerfen, in der Reihenfolge der Stationen. Der gesperrte Weg trägt
//   `aria-describedby`; der Zugänglichkeitsbaum (CDP `Accessibility.getPartialAXTree`) liefert als Beschreibung den Grund („Insert at cursor: Open a note first“), `disabled` ist gesetzt. Ein gesperrter Knopf nimmt keinen
//   Tab-Fokus: gelesen wird der Grund über den Zugänglichkeitsbaum, nicht über die Tab-Reihe.
// - **Q9 grün** Ansicht schließen mit einer Runde: der Dialog „1 unapplied round(s) …“ mit „Keep“ und „Discard“ erscheint nach dem Schließen; Escape behält (Runde bleibt, beim Wiederöffnen steht sie da); „Discard“ verwirft.
//
// Layout und Bedienung am echten Fenster (Welle 36, k9u; Treiber `pilot/prompt-panel-layout.ts`, Obsidian 1.15.1, macOS, Zweitinstanz, Bilder hell und dunkel):
// - **L1 grün** 300 × 420 px, Deutsch, Sperrgrund mit vier Zeilen: der Hinweis der Fußzeile steht auf einer Zeile (voller Text im DOM, `aria-describedby` und `title`), Verwerfen steht mit den Wegen in einem Umbruch-Behälter
//   (zwei statt drei Zeilen); Fußzeile 106 von 382 px (28 %), Eingabe und Senden bei scrollTop 0 an allen vier Ecken sichtbar, jedes Bedienelement nach PP24-Probe erreichbar. Am Stand 0.104.0 rot (Fußzeile 195 px, 51 %, Senden 0 von 3).
// - **L2 grün** 320 px Breite: alle Knöpfe erreichbar, nichts ragt nach rechts; Verwerfen bricht gewollt um, solange es nicht neben „Als Datei speichern“ passt.
// - **L3 grün** leeres Fenster: der Antwortbereich trägt `is-idle` (1 px, unsichtbar, ohne Platz, im Baum für `aria-live`), kein leerer Kreis; im Lauf 143 px, mit Ergebnis 90 px (Mindesthöhe 6em). Am Stand 0.104.0 rot (90 px, Kreis).
// - **L4 grün** der gekürzte Sperrgrund ist ein Umschalter (`button`, `aria-expanded`): Tab erreicht ihn in drei Schritten ab Senden, Enter zeigt den vollen Text (60 px, im Bild), Leertaste klappt zu. Rot am Stand vor Teil 1c (kein Knopf).
// - **K1 grün** Klick mit echter Maus auf einen Schreibweg, nachdem der Editor aktiv war, mit Angebot und `active-leaf-change` im `mousedown`: der Knopf bleibt im Dokument, der Block wird ersetzt. Rot an 0.99.0 und 0.97.0 (Knopf ersetzt, Notiz unverändert).
// - **K2 grün** Prüfliste mit zwei Karten: im Lauf 8 von 8 Knöpfen gesperrt (Gegenprobe), nach dem Lauf 0 von 8, ein Klick auf „Annehmen“ kommt an. Rot an 0.97.0 (nach dem Lauf 8 von 8 gesperrt).
//
// Ungemessen: iOS und iPadOS, Windows, Linux, der Kompaktmodus der Seitenleiste, Layout mit mehr als zwei Wegen und anderen Sprachen als Deutsch und Englisch, ein echter Endpunkt (der Lauf ist ein Zeitgeber).

import type { App } from "obsidian";
import { sameTarget, taskKind, type PanelSession, type Target } from "../kit/panel-session";
import { selectRound } from "../kit/rounds";
import { errorMessage } from "../kit/error-message";
import type { HostAcceptOutcome, HostEvent, HostRunCall, HostRunResult, HostStatusPhase, PanelHost } from "../kit/panel-host";
import { markChatHost } from "./chat-host";
import { confirmAction } from "./confirm";
import type { LlmConnection } from "./llm-connection";
import { buildModelBar, type ModelBar } from "./model-bar";
import { acceptPanel, snapshotBeforeWrite, type AcceptEnv, type AcceptSpec } from "./panel-accept";
import { resolvePromptPanelStrings, type PromptPanelStrings } from "./prompt-panel-strings";
import { buildStatus, paintStatus } from "./status-indicator";
import { buildStreamArea, type StreamArea } from "./stream-area";
import { thinkingLevelTexts, thinkingOffTexts, type ThinkingControlOptions } from "./thinking-control";
import { buildVersionList } from "./version-list";

/** Ein Schreibweg des Fensters: ein eigener, sichtbarer Knopf. Der Rahmen schreibt über `acceptPanel`; das Plugin beschreibt nur. */
export interface PromptPanelWay<S> {
  /** Stabile Kennung (Test, Smoke). */
  id: string;
  /** Beschriftung des Knopfes. */
  label: string;
  /** Der Grund, aus dem dieser Weg jetzt nicht geht (Knopf gesperrt, Grund sichtbar daneben und über `aria-describedby` gelesen), sonst `null`. Wird bei jedem Zeichnen und bei `refreshAccept()` neu bewertet. */
  blockedReason?(s: S): string | null;
  /** Was geschrieben wird. Den Haken `beforeWrite` setzt der Rahmen selbst; ein mitgebrachter wird überschrieben. */
  spec: Omit<AcceptSpec, "beforeWrite">;
  kind(s: S): "create" | "refine";
  /** Nur für das Ziel `new`: Block am Cursor, Datei als Anhang mit Verweis, oder (seit 0.111.0) neue Notiz ohne Verweis (`spec.newNote`). */
  where?: "block" | "file" | "note";
  /** Seit 0.111.0: das Ziel dieses Wegs, wenn es nicht das der Sitzung ist. Standard: `s.target`. Ein Weg mit einem anderen Ziel (und jeder Weg mit `where: "note"`, der ohnehin immer neu
   *  anlegt) hängt die Sitzung nach dem Schreiben nicht um: sie bleibt auf ihrem Ziel (der Halter bekommt kein `retarget`), die Runden werden wie nach jedem Erfolg geleert. */
  target?(s: S): Target;
  /** Eigene Puffer vor dem Schreiben sichern (3d-codeblocks: offene `.shapes`-Ansichten speichern). Wirft es, wird nichts geschrieben; die Meldung kommt über `deps.accept.strings.notApplied`. */
  prepare?(s: S): Promise<void>;
}

/** Was ein Zeichnen der Vorschau fragen darf. */
export interface PreviewCtx {
  /** Gilt dieses Zeichnen noch? Nach einem `await` prüfen, bevor der Slot schreibt. */
  current(): boolean;
}

/** Was ein Hinweis am Fenster tun darf. */
export interface NoticeCtx<S> {
  /** Gilt dieses Zeichnen noch? Nach `await` prüfen, bevor der Host beschrieben wird. */
  current(): boolean;
  /** Läuft gerade ein Lauf oder Übernehmen? Dann sind Knöpfe gesperrt. */
  busy(): boolean;
  session(): S;
  /** Die Sitzung ersetzen (eine lokale Regelrunde) und neu zeichnen; im Lauf und beim Übernehmen wirkungslos. */
  setSession(s: S): void;
  /** Einen Lauf mit eigener Anfrage starten (gleiche Sperre, gleicher Abbruch wie das Senden). */
  run(instruction: string, exec: (call: HostRunCall<S>) => Promise<HostRunResult<S>>): void;
  setStatus(phase: HostStatusPhase, text: string): void;
}

/** Was die Änderungen am Fenster tun dürfen: den Zustand lesen und eine Entscheidung (neue Sitzung) zurückgeben. */
export type ChangesCtx<S> = Pick<NoticeCtx<S>, "busy" | "session" | "setSession" | "setStatus">;

/** Die formatgebundenen Teile; `R` ist die Runde des Formats, `S` seine Sitzung. `fresh` und `run` stehen nicht hier, sondern in den Optionen des Halters (der Lauf überlebt das Fenster). */
export interface PromptPanelSlots<R, S extends PanelSession<R>> {
  /** Die Vorschau der Runde (mit `round === null` der Stand des Ziels, mit `text === null` der Leerzustand). Darf asynchron sein. */
  renderPreview(host: HTMLElement, round: R | null, text: string | null, ctx: PreviewCtx): void | Promise<void>;
  /** Darf der Text des Ziels ohne Runde als Vorschau stehen? Fehlt der Slot, zeigt das Fenster ohne Runde keine Vorschau. */
  canPreviewBase?(text: string): boolean;
  /** Die Änderungen der aktiven Runde (die Prüfliste). Wird auch am Ende jedes Laufs und Schreibens neu gezeichnet (nicht nur bei einem neuen Ergebnis); `ctx.busy()` sagt, ob gesperrt zu zeichnen ist. */
  renderChanges(host: HTMLElement, round: R | null, session: S, ctx: ChangesCtx<S>): void;
  roundLabel(round: R, index: number): string;
  roundMeta(round: R): string;
  /** Der Text nach dieser Runde (Vorschau). */
  roundText(round: R): string;
  quality(model: string, task: "create" | "refine"): { measured: boolean; text: string };
  /** Die Schreibwege; der erste ist der Hauptknopf. */
  acceptWays(session: S): PromptPanelWay<S>[];
  /** Die eigenen Bedienteile in Station 3 (Stil, Sprache, Folienzahl). Der Rahmen sperrt ihre Knöpfe und Felder im Lauf und beim Schreiben und zeichnet sie nach jedem Wechsel dieses Zustands neu. */
  renderControls?(host: HTMLElement, ctx: ChangesCtx<S>): void;
  /** Der Lauf startet auch mit leerem Feld; das Feld trägt den Hinweistext „Zusätzlicher Hinweis (optional)“. */
  instructionOptional?: boolean;
  /** Hinweise zum Text, auf dem die Sitzung steht, mit Knöpfen, die über `ctx` eine Regelrunde setzen oder einen Lauf starten. Wird bei jedem Zeichnen mit leerem `host` gerufen. */
  notices?(host: HTMLElement, ctx: NoticeCtx<S>): void;
  /** Die Felder unter der Vorschau für den Text, den die Vorschau zeigt. Wird wie `renderChanges` am Ende jedes Laufs und Schreibens neu gezeichnet, ohne dass die Vorschau neu gezeichnet wird. */
  renderFields?(host: HTMLElement, text: string | null, session: S, ctx: ChangesCtx<S>): void;
  dispose?(): void;
}

export interface PromptPanelDeps {
  app: App;
  lang: "en" | "de";
  llm: LlmConnection;
  /** Zustand und Schalter der Denk-Steuerung in der Modellzeile (ohne Texte). */
  thinking: Pick<ThinkingControlOptions, "family" | "backend" | "current" | "onLevel" | "setLevel" | "levelPicker">;
  /** Aktueller Text des Ziels; `null`: das Ziel ist weg (oder es gibt keinen, beim neuen Ziel). */
  readTargetText(t: Target): Promise<string | null>;
  openSettings(): void;
  /** Kennung des Plugins für den Schnappschuss (`file-snapshot`). */
  pluginId: string;
  accept: Omit<AcceptEnv, "settings" | "choose">;
  strings?: Partial<PromptPanelStrings>;
  /** Standard: `confirmAction` des Kits. */
  confirm?: (message: string, labels: { confirm: string; cancel: string }) => Promise<boolean>;
}

export interface PromptPanel {
  /** Station 8: Läuft ein Lauf, geschieht nichts (Lauf und Sitzung bleiben beim Halter). Sonst, bei offenen Runden, die Rückfrage Verwerfen oder Behalten; nur „Verwerfen“ verwirft, jeder andere Ausgang behält. */
  requestClose(): Promise<void>;
  /** Zeichnet die Modellzeile samt Denk-Steuerung aus dem Zustand neu (ohne Abruf). */
  refreshModelBar(): void;
  /** Wertet die Schreibwege und ihre Sperrgründe neu aus (die zuletzt aktive Notiz hat gewechselt). */
  refreshAccept(): void;
  /** Seit Welle 38: zeichnet die Bedienteile (Slot `renderControls`, Station 3) neu, wenn ihr Stand außerhalb der Sitzung gewechselt hat (etwa die Quelle mit offenen Runden). `"drawn"`: neu gezeichnet;
   *  `"busy"`: im Lauf oder beim Schreiben nicht (das Ende zeichnet ohnehin neu); `"deferred"`: ein Textfeld des Slots hat den Fokus, gezeichnet wird einmal, wenn er den Slot verlässt. Fokus siehe Kopf. */
  refreshControls(): "drawn" | "busy" | "deferred";
  /** Lädt die Modell-Liste der Zeile neu. */
  reloadModels(): void;
  /** Testnaht: wartet auf Lauf, Schreiben und eine laufende Vorschau. */
  settled(): Promise<void>;
  /** Meldet den Rahmen ab und baut ihn ab. Bricht den Lauf nicht ab. */
  destroy(): void;
}

/** Zähler für Ids: zwei Rahmen im selben Dokument haben nie dieselbe id. */
let frameSeq = 0;

/** Was die klebende Fußzeile (Station 7) vom Blatt übernimmt, auf dem das Fenster wirklich liegt (Welle 38, Teil A). Alle Längen in px.
 *  - `background`: die Hintergrundfarbe des nächsten deckenden Vorfahren (Schublade am Telefon, Seitenleiste, Tab), `null` ohne deckenden Vorfahren (dann gilt die Vorgabe `--background-primary`).
 *  - `left`, `right`: der Abstand des Fensters zum Innenrand des rollenden Bereichs; die Fußzeile reicht um so viel nach außen (kein Inhalt scheint links und rechts vorbei).
 *  - `bottom`: der untere Innenabstand des rollenden Bereichs ohne die Tastaturhöhe; um so viel rückt die klebende Fußzeile nach unten bis an seinen Rand (kein Inhalt scheint darunter durch).
 *  - `padBottom`: was am unteren Rand verdeckt ist (Home-Leiste, schwebende Navigationsleiste am Telefon), als Innenabstand der Fußzeile, damit ihre Knöpfe darüber stehen.
 *  - `stick`: am Telefon `false`, wenn die Fußzeile mehr als ein Fünftel des rollenden Bereichs nähme; dann steht sie am Ende des Inhalts statt zu kleben. */
export interface EndFit { background: string | null; left: number; right: number; bottom: number; padBottom: number; stick: boolean }

/** Was `measureEndFit` von der Umgebung liest (im Rahmen: `getComputedStyle`, `elementFromPoint`, Fensterhöhe, `is-phone` am `body`; Tests geben eigene Werte). */
export interface EndFitEnv {
  style(el: Element): Pick<CSSStyleDeclaration, "backgroundColor" | "overflowY" | "paddingBottom" | "getPropertyValue">;
  /** Das oberste Element an einem Punkt des Fensters (`document.elementFromPoint`). */
  hit(x: number, y: number): Element | null;
  viewportHeight: number;
  /** Am Telefon (`is-phone`): nur dort gilt die Fünftel-Regel und die Suche nach einer Überdeckung am unteren Rand. */
  phone: boolean;
  /** Obsidians Variablen am `body`: `--keyboard-height` und `--safe-area-inset-bottom` (beide in px). */
  rootVar(name: string): string;
}

/** Anteil am rollenden Bereich, ab dem die Fußzeile am Telefon nicht mehr klebt. */
export const END_STICK_MAX_SHARE = 0.2;

const px = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Deckend heißt: eine Farbe mit Deckkraft über null (`transparent`, `rgba(…, 0)` und `… / 0)` zählen nicht). Ein halb durchsichtiger Vorfahr zählt als deckend (benannte Grenze: seine Farbe ist dann
 *  nicht genau, was man sieht; gemessen sind nur deckende Themes). */
function opaque(color: string): boolean {
  const c = color.trim();
  if (c === "" || c === "transparent") return false;
  return !/(,|\/)\s*0(\.0+)?\s*\)$/.test(c);
}

/** Misst, was die klebende Fußzeile `endEl` des Fensters `panelEl` braucht (siehe `EndFit`). Ohne rollenden Vorfahren klebt nichts: die Ränder bleiben 0. Nur der Rahmen ruft das, bei jedem Zeichnen, bei
 *  geänderter Größe und bei einem Themenwechsel; exportiert für die Tests. */
export function measureEndFit(panelEl: HTMLElement, endEl: HTMLElement, env: EndFitEnv): EndFit {
  let background: string | null = null;
  let scroller: HTMLElement | null = null;
  for (let a = panelEl.parentElement; a !== null; a = a.parentElement) {
    const cs = env.style(a);
    if (scroller === null && /^(auto|scroll|overlay)$/.test(cs.overflowY)) scroller = a;
    if (background === null && opaque(cs.backgroundColor)) background = cs.backgroundColor;
    if (background !== null && scroller !== null) break;
  }
  if (scroller === null) return { background, left: 0, right: 0, bottom: 0, padBottom: 0, stick: true };
  const s = scroller.getBoundingClientRect();
  const p = panelEl.getBoundingClientRect();
  const innerLeft = s.left + scroller.clientLeft;
  const innerRight = innerLeft + scroller.clientWidth;
  const innerBottom = s.top + scroller.clientTop + scroller.clientHeight;
  const keyboard = px(env.rootVar("--keyboard-height"));
  const left = Math.max(0, Math.round(p.left - innerLeft));
  const right = Math.max(0, Math.round(innerRight - p.right));
  const bottom = Math.max(0, Math.round(px(env.style(scroller).paddingBottom) - keyboard));
  // Die Fünftel-Regel misst die Fußzeile ohne den Innenabstand, den die letzte Messung gesetzt hat: sonst schaltete sie hin und her (kleben → Abstand wächst → nicht kleben → Abstand fällt → kleben).
  const base = endEl.getBoundingClientRect().height - px(env.style(endEl).getPropertyValue("--okit-prompt-panel-end-pad-bottom"));
  const stick = !env.phone || base <= END_STICK_MAX_SHARE * scroller.clientHeight;
  let padBottom = 0;
  if (stick && env.phone && keyboard === 0) {
    // Home-Leiste: nur wenn der rollende Bereich bis an den unteren Rand des Fensters reicht (Obsidian setzt die Variable bei offener Tastatur auf deren Höhe, darum nur ohne Tastatur).
    if (innerBottom >= env.viewportHeight - 1) padBottom = px(env.rootVar("--safe-area-inset-bottom"));
    // Was über dem unteren Rand liegt und nicht zum rollenden Bereich gehört (die schwebende Navigationsleiste im Hauptbereich): die untersten 160 px abtasten; der höchste verdeckte Punkt zählt. Nicht am ersten
    // freien Punkt aufhören: die Leiste schwebt, unter ihr liegt ein Streifen des Bereichs selbst (gemessen 390 x 844: Leiste 760 bis 812, Bereich bis 844).
    const x = (s.left + s.right) / 2;
    for (let d = 1; d <= 160; d += 4) {
      const el = env.hit(x, innerBottom - d);
      if (el !== null && !scroller.contains(el)) padBottom = Math.max(padBottom, d + 4);
    }
  }
  return { background, left, right, bottom, padBottom: Math.round(padBottom), stick };
}

export function buildPromptPanel<R, S extends PanelSession<R>>(root: HTMLElement, host: PanelHost<S>, deps: PromptPanelDeps, slots: PromptPanelSlots<R, S>): PromptPanel {
  const uid = ++frameSeq;
  const st = resolvePromptPanelStrings({ lang: deps.lang, ...deps.strings });
  const confirm = deps.confirm ?? ((message, labels) => confirmAction(deps.app, { message, confirmLabel: labels.confirm, cancelLabel: labels.cancel, warning: true }));
  let destroyed = false;
  /** Ohne Runde: der Text des Ziels, den die Vorschau zeigt (nur wenn `canPreviewBase` ihn zulässt); sonst `null`. */
  let baseShown: string | null = null;
  let previewTicket = 0;
  const previewWork = new Set<Promise<void>>();
  let wasRunning = host.running();
  /** `busy()` beim letzten Zeichnen: der Übergang wahr nach falsch entsperrt Prüfliste und Felder (`releaseAfterBusy`). */
  let wasBusy = host.busy();

  root.addClass("okit-prompt-panel-host");
  const panelEl = root.createDiv({ cls: "okit-prompt-panel" });
  const offChatHost = markChatHost(root);

  // ---- Station 1: Ziel ----------------------------------------------------------------------
  const top = panelEl.createDiv({ cls: "okit-prompt-panel-top" });
  const targetEl = top.createDiv({ cls: "okit-prompt-panel-target" });
  const newBtn = top.createEl("button", { cls: "okit-prompt-panel-new", text: st.newButton, attr: { type: "button" } });
  const hintEl = panelEl.createDiv({ cls: "okit-prompt-panel-hint" });

  // ---- Station 2: Modell --------------------------------------------------------------------
  const modelBar: ModelBar = buildModelBar({
    app: deps.app,
    containerEl: panelEl,
    llm: deps.llm,
    label: st.modelLabel,
    strings: { lang: deps.lang },
    // Während einer Anfrage und während Übernehmen läuft ein Modellwechsel ins Leere.
    disabled: () => host.busy(),
    onChange: () => { renderHeader(); },
    // Ein früher gemeldetes „kein Endpunkt“ gilt nicht für immer: eine erreichbare Liste nimmt es zurück.
    onRefreshed: (r) => { if (r.reachable) host.clearNoEndpoint(); renderHeader(); },
    onError: (e) => { if (!host.running()) host.setStatus("error", errorMessage(e)); },
    thinking: {
      ...deps.thinking,
      strings: {
        button: (level) => (level === "off" ? st.thinkingOff : st.thinkingOn(thinkingLevelTexts(deps.lang).level(level))),
        offNotPossible: thinkingOffTexts(deps.lang),
        ...thinkingLevelTexts(deps.lang),
        pickerLabel: st.thinkingPicker,
      },
    },
  });

  const quality = buildStatus(panelEl, "okit-prompt-panel-quality", { idleIcon: null });
  const noticesHost = panelEl.createDiv({ cls: "okit-prompt-panel-notices" });

  // Kein Eingabefeld-Ersatz ohne Endpunkt: der Leerzustand steht daneben, das Feld bleibt.
  const noEndpointEl = panelEl.createDiv({ cls: "okit-prompt-panel-empty-endpoint is-hidden" });
  noEndpointEl.createDiv({ text: st.noEndpoint });
  const noEndpointDetail = noEndpointEl.createDiv({ cls: "okit-prompt-panel-empty-detail" });
  noEndpointEl.createEl("button", { text: st.openSettings, attr: { type: "button" } }).addEventListener("click", () => { deps.openSettings(); });

  // ---- Station 3: Auftrag -------------------------------------------------------------------
  const controlsHost = panelEl.createDiv({ cls: "okit-prompt-panel-controls" });
  const examplesEl = panelEl.createDiv({ cls: "okit-prompt-panel-empty is-hidden" });
  examplesEl.createDiv({ text: st.emptyText });
  const input = panelEl.createEl("textarea", { cls: "okit-prompt-panel-input", attr: { rows: "4", "aria-label": st.promptLabel } });
  input.value = host.live().draft;
  input.addEventListener("input", () => { host.setDraft(input.value); });
  for (const text of st.examples) {
    const b = examplesEl.createEl("button", { cls: "okit-prompt-panel-example", text, attr: { type: "button" } });
    b.addEventListener("click", () => { input.value = text; host.setDraft(text); input.focus(); });
  }
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  });

  const actions = panelEl.createDiv({ cls: "okit-prompt-panel-actions" });
  const sendBtn = actions.createEl("button", { cls: "mod-cta okit-prompt-panel-send", attr: { type: "button" } });
  sendBtn.addEventListener("click", () => { send(); });
  // ---- Station 4: Lauf ----------------------------------------------------------------------
  const stopBtn = actions.createEl("button", { cls: "okit-prompt-panel-stop is-hidden", text: st.stop, attr: { type: "button" } });
  stopBtn.addEventListener("click", () => { host.abort(); });

  const area: StreamArea = buildStreamArea(panelEl, { strings: { reasoning: st.reasoning, copyReasoning: st.copyReasoning }, cls: "okit-prompt-panel-stream" });
  area.statusEl.setAttribute("aria-live", "polite");
  const status = buildStatus(area.statusEl, "okit-prompt-panel-status");

  // ---- Station 5 und 6: Ergebnis, Runden ----------------------------------------------------
  const previewWrap = panelEl.createDiv({ cls: "okit-prompt-panel-preview is-hidden" });
  const previewCaption = previewWrap.createDiv({ cls: "okit-prompt-panel-preview-caption" });
  const previewHost = previewWrap.createDiv({ cls: "okit-prompt-panel-preview-host" });
  const fieldsHost = previewWrap.createDiv({ cls: "okit-prompt-panel-fields-host" });
  const changesHost = panelEl.createDiv({ cls: "okit-prompt-panel-changes" });
  const roundsEl = panelEl.createDiv({ cls: "okit-prompt-panel-rounds" });

  // ---- Station 7: Übernehmen ----------------------------------------------------------------
  const end = panelEl.createDiv({ cls: "okit-prompt-panel-end" });
  const hintsEl = end.createDiv({ cls: "okit-prompt-panel-accept-hints" });
  const endActions = end.createDiv({ cls: "okit-prompt-panel-actions" });
  // Wege und Verwerfen stehen in EINEM Umbruch-Behälter: im schmalen Blatt teilen sie sich die Zeilen (300 px: zwei statt drei, Welle 36, k9u). Verwerfen bleibt der letzte Knopf und wird nie umgehängt;
  // die Wege werden davor eingefügt (`renderWays`).
  const waysEl = endActions.createDiv({ cls: "okit-prompt-panel-ways" });
  const discardBtn = waysEl.createEl("button", { cls: "okit-prompt-panel-discard", text: st.discard, attr: { type: "button" } });
  discardBtn.addEventListener("click", () => { void discard(); });
  newBtn.addEventListener("click", () => { void startNew(); });

  /** Die Fußzeile übernimmt Hintergrund, Ränder und unteren Abstand des Blatts (`measureEndFit`); ohne Fenster-API (Tests im Fake-DOM, nicht im Dokument) bleibt sie bei den Vorgaben der CSS.
   *  Gemessen wird bei jedem Zeichnen, bei geänderter Größe von Fenster oder rollendem Bereich (auch die Tastatur ändert dessen Innenabstand) und bei einem Themenwechsel (`css-change`). */
  function fitEnd(): void {
    if (destroyed || end.hidden || typeof getComputedStyle !== "function" || !panelEl.isConnected) return;
    const doc = panelEl.ownerDocument;
    const fit = measureEndFit(panelEl, end, {
      style: (el) => getComputedStyle(el),
      hit: (x, y) => doc.elementFromPoint(x, y),
      viewportHeight: doc.documentElement.clientHeight,
      phone: doc.body.hasClass("is-phone"),
      rootVar: (name) => getComputedStyle(doc.body).getPropertyValue(name),
    });
    end.toggleClass("is-static", !fit.stick);
    // Custom Properties: eslint-plugin-obsidianmd 0.5.0 lässt in `setCssProps` nur `--name` zu; die Regel `.okit-prompt-panel-end` liest sie. Leer entfernt die Eigenschaft (dann gilt die Vorgabe der Regel).
    end.setCssProps({
      "--okit-prompt-panel-end-bg": fit.background ?? "",
      "--okit-prompt-panel-end-left": `${String(fit.left)}px`,
      "--okit-prompt-panel-end-right": `${String(fit.right)}px`,
      "--okit-prompt-panel-end-bottom": `${String(fit.bottom)}px`,
      "--okit-prompt-panel-end-pad-bottom": `${String(fit.padBottom)}px`,
    });
  }
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => { fitEnd(); });
    resizeObserver.observe(panelEl);
    resizeObserver.observe(root);
  }
  const workspace = (deps.app as Partial<App>).workspace;
  const cssRef = workspace?.on("css-change", () => { fitEnd(); }) ?? null;

  interface WayView { way: PromptPanelWay<S>; btn: HTMLButtonElement; hint: HTMLButtonElement; hintId: string }
  let wayViews: WayView[] = [];

  // ---- Zustand ------------------------------------------------------------------------------
  const session = (): S => host.session();
  const roundCount = (): number => session().rounds.rounds.length;
  const activeRound = (): R | null => {
    const s = session();
    return s.rounds.active >= 0 ? (s.rounds.rounds[s.rounds.active] ?? null) : null;
  };
  const model = (): string => {
    const s = deps.llm.source();
    return s.sentModel || s.model;
  };
  const canSend = (): boolean => !host.busy() && session().target.kind !== "other";

  function send(): void {
    if (!canSend()) return;
    const instruction = input.value.trim();
    if (instruction === "" && slots.instructionOptional !== true) return;
    host.start(instruction);
  }

  // ---- Station 4: der Puffer des Laufs ------------------------------------------------------
  let shownAnswer = "";
  let shownReasoning = "";

  /** Bringt den Antwortbereich auf den Stand des Puffers im Halter: beim Aufbau ganz, danach nur um das, was dazukam. */
  function syncStream(): void {
    const l = host.live();
    if (l.answer === "" && l.reasoning === "") {
      if (shownAnswer !== "" || shownReasoning !== "") area.reset();
      shownAnswer = "";
      shownReasoning = "";
      return;
    }
    // Der Puffer hat neu begonnen (neuer Versuch, neuer Lauf): von vorn zeichnen.
    if (!l.reasoning.startsWith(shownReasoning)) {
      area.reset();
      shownAnswer = "";
      shownReasoning = "";
    }
    if (l.reasoning !== shownReasoning) {
      area.appendReasoning(l.reasoning.slice(shownReasoning.length));
      shownReasoning = l.reasoning;
    }
    if (l.answer !== shownAnswer) {
      if (l.answer === "") {
        // Die Runde und die Vorschau zeigen das Ergebnis; der rohe Text der Antwort schöbe die Vorschau nur nach unten. Bei Misserfolg bleibt er stehen (kein Ergebnis, der Nutzer sieht, was kam).
        area.resetContent();
        if (l.status.phase === "ok") area.setReasoningOpen(false);
      } else {
        area.setTail(l.answer);
      }
      shownAnswer = l.answer;
    }
    area.followTail();
  }

  function paintLive(): void {
    const l = host.live();
    paintStatus(status, l.status.phase, l.status.text);
    // Ohne Lauf und ohne Puffer hat der Antwortbereich nichts zu zeigen: er steht dann nur als Lesebereich (aria-live bleibt im Baum), ohne Mindesthöhe und ohne leeren Statuskreis.
    area.rootEl.toggleClass("is-idle", l.status.phase === "idle" && l.answer === "" && l.reasoning === "");
    noEndpointEl.toggleClass("is-hidden", l.noEndpoint === null);
    if (l.noEndpoint !== null) noEndpointDetail.setText(l.noEndpoint);
    // Zwei getrennte Elemente; trifft beides zu, gewinnt „kein Endpunkt“.
    renderExamples();
  }

  function renderExamples(): void {
    const l = host.live();
    examplesEl.toggleClass("is-hidden", st.examples.length === 0 || l.noEndpoint !== null || host.running() || roundCount() > 0 || session().target.kind !== "new");
  }

  // ---- Übernehmen, Verwerfen, Neu -----------------------------------------------------------
  async function acceptVia(way: PromptPanelWay<S>): Promise<void> {
    await host.accept(async (s): Promise<HostAcceptOutcome> => {
      try {
        await way.prepare?.(s);
      } catch (e) {
        return { ok: false, message: deps.accept.strings.notApplied(errorMessage(e)) };
      }
      // `beforeWrite` steht NACH dem Spread: ein mitgebrachter Haken wird überschrieben, der Schnappschuss entsteht immer.
      const spec: AcceptSpec = { ...way.spec, beforeWrite: snapshotBeforeWrite(deps.app, deps.pluginId, st.snapshotFailed) };
      const target = way.target?.(s) ?? s.target;
      const out = await acceptPanel(deps.accept, spec, target, way.kind(s), way.where);
      // Ein Weg mit eigenem, ANDEREM Ziel (neue Notiz aus einer Markierung) lässt die Sitzung auf ihrem Ziel: ohne `retarget` beginnt der Halter frisch auf dem alten. Schreibt der Weg aufs
      // Ziel der Sitzung (auch über `target`), bleibt das `retarget`: sonst behielte die Sitzung einen veralteten Fingerabdruck (Gegenlesung B2, Befund 8). Ein `where: "note"` legt immer neu an.
      const elsewhere = way.where === "note" || !sameTarget(target, s.target);
      return elsewhere && out.ok ? { ok: true, message: out.message } : out;
    });
  }

  async function confirmDiscard(message: (n: number) => string): Promise<boolean> {
    const n = roundCount();
    return n === 0 || (await confirm(message(n), { confirm: st.confirmDiscard, cancel: st.confirmKeep }));
  }

  /** Verwerfen: Runden weg; ein angebotenes (zurückgehaltenes) Ziel gilt jetzt. */
  async function discard(): Promise<void> {
    if (host.busy()) return;
    if (!(await confirmDiscard(st.discardConfirm))) return;
    host.discard();
  }

  async function startNew(): Promise<void> {
    if (host.busy()) return;
    if (!(await confirmDiscard(st.discardConfirm))) return;
    host.startNew();
  }

  // ---- Zeichnen -----------------------------------------------------------------------------
  function renderHeader(): void {
    if (destroyed) return;
    const t = session().target;
    const label = t.kind === "new" ? st.targetNew : t.label;
    targetEl.setText(host.kept() ? st.targetKept(label) : t.kind === "new" ? st.targetNew : st.targetEdit(label));
    hintEl.setText(t.kind === "other" ? st.unsupported(t.label) : "");
    const task = taskKind(session());
    const q = slots.quality(model(), task);
    paintStatus(quality, q.measured ? "idle" : "warning", q.text);
    sendBtn.setText(task === "create" ? st.create : st.refine);
    input.setAttribute("placeholder", slots.instructionOptional === true ? st.instructionOptional : task === "create" ? st.placeholderCreate : st.placeholderRefine);
    renderControls();
  }

  const lock = (el: HTMLElement, selector: string): void => {
    for (const b of Array.from(el.querySelectorAll<HTMLButtonElement>(selector))) b.disabled = true;
  };

  /** Station 3: die Bedienteile des Plugins. Sie werden bei jedem Wechsel von Lauf und Schreiben neu gezeichnet und dann gesperrt (nie von Hand aufgesperrt, das wäre Sache des Slots). */
  function renderControlsSlot(force = true): void {
    if (!force && sameKey(drawnControls, keyNow(), { busy: true })) return;
    drawnControls = keyNow();
    controlsPending = false;
    controlsHost.empty();
    slots.renderControls?.(controlsHost, changesCtx());
    if (host.busy()) lock(controlsHost, "input, button, select, textarea");
  }

  /** `refreshControls()`: aufgeschoben, solange ein Textfeld des Slots den Fokus hat. */
  let controlsPending = false;
  /** Die fokussierbaren Elemente des Slots in Dokumentreihenfolge (Tiefensuche über `children`; das Fake-DOM der Tests kennt keine Selektorlisten). */
  const focusables = (hostEl: Element): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const walk = (el: Element): void => {
      for (const c of Array.from(el.children)) {
        if (["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(c.tagName.toUpperCase()) || c.getAttribute("tabindex") !== null || c.getAttribute("contenteditable") === "true") out.push(c as HTMLElement);
        walk(c);
      }
    };
    walk(hostEl);
    return out;
  };
  /** Liegt `node` in `host` (über `parentElement`, das Fake-DOM der Tests kennt kein `contains` für Knoten). */
  const within = (hostEl: HTMLElement, node: Element | null): boolean => {
    for (let n: Element | null = node; n !== null; n = n.parentElement) if (n === hostEl) return true;
    return false;
  };
  const activeEl = (): Element | null => (root.ownerDocument as Document | undefined)?.activeElement ?? null;
  const isTextField = (el: Element): boolean => {
    const tag = el.tagName.toUpperCase();
    if (tag === "TEXTAREA") return true;
    if ((el as HTMLElement).isContentEditable || el.getAttribute("contenteditable") === "true") return true;
    if (tag !== "INPUT") return false;
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  };
  function refreshControlsNow(): "drawn" | "busy" | "deferred" {
    if (destroyed) return "drawn";
    if (host.busy()) { controlsPending = false; return "busy"; }
    const active = activeEl();
    const focused = active !== null && within(controlsHost, active) ? active : null;
    if (focused !== null && isTextField(focused)) { controlsPending = true; return "deferred"; }
    controlsPending = false;
    const index = focused === null ? -1 : focusables(controlsHost).indexOf(focused as HTMLElement);
    renderControlsSlot();
    if (index >= 0) focusables(controlsHost)[index]?.focus();
    return "drawn";
  }
  // Ein aufgeschobenes Neuzeichnen geschieht, sobald der Fokus den Slot verlässt (`relatedTarget` außerhalb oder keins).
  controlsHost.addEventListener("focusout", (e: FocusEvent) => {
    if (!controlsPending) return;
    const next = (e.relatedTarget as Element | null) ?? null;
    if (next !== null && within(controlsHost, next)) return;
    refreshControlsNow();
  });

  function renderControls(): void {
    if (destroyed) return;
    const running = host.running();
    const busy = host.busy();
    const n = roundCount();
    // Station 7 erscheint erst mit der ersten Runde, wie die Vorschau (Welle 38, Teil B): ohne Runde gäbe es nur gesperrte Knöpfe ohne Grund, und am Telefon läge die klebende Zeile über den Bedienteilen.
    // `hidden`, nicht nur eine Klasse: die Knöpfe darin sind dann auch nicht fokussierbar.
    end.hidden = n === 0;
    modelBar.update(); // die Sperre der Modellzeile folgt demselben Zustand
    sendBtn.disabled = !canSend();
    stopBtn.toggleClass("is-hidden", !running);
    for (const v of wayViews) {
      const blocked = v.way.blockedReason?.(session()) ?? null;
      v.btn.disabled = n === 0 || busy || blocked !== null;
      const hintText = blocked === null ? "" : wayViews.length === 1 ? blocked : `${v.way.label}: ${blocked}`;
      v.hint.setText(hintText);
      // Ein leerer Hinweis ist weder sichtbar noch fokussierbar (Welle 38, Teil C): `hidden` trägt die Regel der CSS, `disabled` hält auch, wenn ein Theme die Anzeige des Knopfs überschreibt.
      v.hint.hidden = hintText === "";
      v.hint.disabled = hintText === "";
      // Der Text steht voll im DOM (aria-describedby liest ihn ganz); die Fußzeile zeigt eine Zeile, der Hinweis klappt auf (Umschalter); der title ist nur Zugabe, nie der einzige Weg.
      if (hintText === "") {
        v.hint.removeAttribute("title");
        // Ein Grund, der entfällt, nimmt seinen Aufklappzustand mit: der nächste Grund beginnt eingeklappt.
        v.hint.removeClass("is-open");
        v.hint.setAttribute("aria-expanded", "false");
      } else v.hint.setAttribute("title", hintText);
      if (blocked === null) v.btn.removeAttribute("aria-describedby");
      else v.btn.setAttribute("aria-describedby", v.hintId);
    }
    discardBtn.disabled = n === 0 || busy;
    newBtn.disabled = busy;
    for (const b of Array.from(noticesHost.querySelectorAll<HTMLButtonElement>("button"))) b.disabled = busy;
    // Die Prüfliste sperrt der Kit-Baustein selbst (gesperrte Karten bleiben gesperrt): hier nur zusperren, nie aufsperren. Aufgesperrt wird durch Neuzeichnen am Ende des Laufs (`releaseAfterBusy`).
    if (busy) lock(changesHost, "button");
    // Die Zahlenfelder ebenso: Enter in einem Feld darf während eines Laufs oder Übernehmens keine zweite Änderung auslösen.
    if (busy) lock(fieldsHost, "input");
    renderExamples();
    previewWrap.toggleClass("is-hidden", n === 0 && baseShown === null);
    fitEnd();
  }

  /** Die Schreibweg-Knöpfe: bei gleicher Form der Wegliste (gleiche Anzahl, gleiche Beschriftungen in gleicher Reihenfolge) bleiben die Elemente stehen, nur `wayViews[i].way` wird auf das neue Weg-Objekt gesetzt
   *  (Sperre, Hinweis und `aria-describedby` folgen in `renderControls`). Nur eine geänderte Form baut sie neu. Grund: ein Klick auf einen Knopf aktiviert beim `mousedown` das Blatt des Fensters, das Plugin ruft dann
   *  `refreshAccept()` (`active-leaf-change`), und ein ersetzter Knopf bekäme das `mouseup` ohne `mousedown`: kein `click`, Übernehmen täte nichts, ohne Meldung (gemessen von svg-studio am Rahmen 0.98.0).
   *  Der Klick-Handler liest den Weg zur Klickzeit aus `wayViews`, nie den beim Bau gefangenen. */
  function renderWays(): void {
    const ways = slots.acceptWays(session());
    if (ways.length === wayViews.length && ways.every((w, i) => w.label === wayViews[i]?.way.label)) {
      ways.forEach((w, i) => { const v = wayViews[i]; if (v !== undefined) v.way = w; });
      return;
    }
    for (const v of wayViews) waysEl.removeChild(v.btn);
    hintsEl.empty();
    wayViews = ways.map((way, i) => {
      const hintId = `okit-prompt-panel-${String(uid)}-hint-${String(i)}`;
      const btn = waysEl.createEl("button", { cls: i === 0 ? "mod-cta okit-prompt-panel-accept" : "okit-prompt-panel-accept", text: way.label, attr: { type: "button" } });
      waysEl.insertBefore(btn, discardBtn);
      btn.addEventListener("click", () => {
        const v = wayViews[i];
        if (v !== undefined && v.btn === btn) void acceptVia(v.way);
      });
      // Der Hinweis ist ein Umschalter: eingeklappt eine Zeile mit Auslassung, aufgeklappt der volle Text. Ohne Hover (Handy) und ohne Screenreader ist das der Weg zum Rest; Tippen, Enter und Leertaste kommen vom Knopf.
      const hint = hintsEl.createEl("button", { cls: "okit-prompt-panel-accept-hint", attr: { id: hintId, type: "button", "aria-expanded": "false" } });
      hint.addEventListener("click", () => {
        const open = !hint.hasClass("is-open");
        hint.toggleClass("is-open", open);
        hint.setAttribute("aria-expanded", open ? "true" : "false");
      });
      return { way, btn, hint, hintId };
    });
  }

  function renderRounds(): void {
    if (drawnRounds === session().rounds) return;
    drawnRounds = session().rounds;
    roundsEl.empty();
    const { rounds, active } = session().rounds;
    buildVersionList(roundsEl, {
      items: rounds.map((rd, i) => ({ label: slots.roundLabel(rd, i), meta: slots.roundMeta(rd) })),
      active,
      onSelect: (i) => {
        // Im Lauf und beim Schreiben wirkungslos (`setSession` gibt dort `false`): die Anfrage baut auf der Runde, die beim Senden aktiv war.
        host.setSession({ ...session(), rounds: selectRound(session().rounds, i) });
      },
      heading: st.rounds,
    });
  }

  /** Verfolgt eine Vorschau, damit `settled()` auf sie wartet; ein Wurf des Slots wird verschluckt (die Vorschau ist Beiwerk, das Fenster darf nicht hängen). */
  function track(work: void | Promise<void>): void {
    if (work === undefined) return;
    const p: Promise<void> = work.then(() => undefined, () => undefined).then(() => { previewWork.delete(p); });
    previewWork.add(p);
  }

  /** Ein Zeichnen der Vorschau: eigenes Wurzelelement, das das nächste Zeichnen mit dem alten Inhalt abhängt. */
  function drawPreview(round: R | null, text: string | null, ticket: number): void {
    const slotEl = previewHost.createDiv({ cls: "okit-prompt-panel-preview-slot" });
    track(slots.renderPreview(slotEl, round, text, { current: () => !destroyed && ticket === previewTicket }));
  }

  function renderPreview(): void {
    const round = activeRound();
    const ticket = ++previewTicket;
    if (round === null) {
      renderBasePreview(ticket);
      return;
    }
    baseShown = null;
    previewCaption.setText(st.previewOf(session().rounds.active + 1));
    previewHost.empty();
    const text = slots.roundText(round);
    drawPreview(round, text, ticket);
    drawFields(text, false);
  }

  /** Ohne Runde zeigt die Vorschau den Stand des Ziels (lesen ist asynchron): ein Bestand, den `canPreviewBase` verneint, bleibt ohne Vorschau und zeigt die Hinweise. */
  function renderBasePreview(ticket: number): void {
    const target = session().target;
    if (slots.canPreviewBase === undefined || (target.kind !== "file" && target.kind !== "block")) {
      clearBase(ticket);
      return;
    }
    const reading = deps.readTargetText(target).then(
      (text) => {
        if (destroyed || ticket !== previewTicket) return;
        if (text === null || !slots.canPreviewBase?.(text)) {
          clearBase(ticket);
          return;
        }
        baseShown = text;
        previewCaption.setText(st.previewBase);
        previewHost.empty();
        drawPreview(null, text, ticket);
        drawFields(text, false);
        renderControls();
      },
      () => { if (!destroyed && ticket === previewTicket) clearBase(ticket); },
    );
    track(reading);
  }

  function clearBase(ticket: number): void {
    baseShown = null;
    previewCaption.setText(st.previewNone);
    previewHost.empty();
    drawFields(null, true);
    drawPreview(null, null, ticket);
    renderControls();
  }

  function changesCtx(): ChangesCtx<S> {
    return {
      busy: () => host.busy(),
      session: () => host.session(),
      setSession(next) { host.setSession(next); },
      setStatus: (phase, text) => { host.setStatus(phase, text); },
    };
  }

  function renderChanges(force = true): void {
    if (!force && sameKey(drawnChanges, keyNow(), { busy: true })) return;
    drawnChanges = keyNow();
    changesHost.empty();
    slots.renderChanges(changesHost, activeRound(), session(), changesCtx());
  }

  /** Die Felder allein, mit dem Text, den die Vorschau gerade zeigt (Runde, sonst der Stand des Ziels); ohne beides bleiben sie leer wie nach `clearBase`. Die Vorschau selbst bleibt unberührt. */
  function renderFieldsOnly(force = true): void {
    const round = activeRound();
    drawFields(round !== null ? slots.roundText(round) : baseShown, force);
  }

  /** Die Felder zeichnen; `null` leert sie wie nach `clearBase`. Wie die Hinweise nur bei geändertem Schlüssel (Sitzung, `busy`, Text), außer `force`: ein Zahlenfeld mit dem Fokus darf ein Blattwechsel nicht ersetzen. */
  function drawFields(text: string | null, force: boolean): void {
    if (!force && text !== null && sameKey(drawnFields, keyNow(text), { busy: true, text: true })) return;
    fieldsHost.empty();
    drawnFields = null;
    if (text === null) return;
    drawnFields = keyNow(text);
    slots.renderFields?.(fieldsHost, text, session(), changesCtx());
  }

  /** Beim Übergang von `busy()` wahr nach falsch zeichnen Prüfliste und Felder neu, damit ihre Slots den Zustand selbst bestimmen: gesperrt wird sonst nur zu (`renderControls`), und das Ereignis
   *  `session` kommt noch im Lauf (der Halter beendet ihn erst danach), zeichnet beide also gesperrt. Gilt für Erfolg, Abbruch, Fehler und ein fehlgeschlagenes Übernehmen. */
  function releaseAfterBusy(): void {
    const busy = host.busy();
    const released = wasBusy && !busy;
    wasBusy = busy;
    if (!released) return;
    renderChanges();
    renderFieldsOnly();
  }

  let noticeTicket = 0;
  /** Was ein Slot gezeigt hat, als er zuletzt gezeichnet wurde: Sitzung, `kept`, gehaltenes Angebot, `busy` (Sperre beim Zeichnen) und der Text, den er bekam (Felder). */
  interface DrawnKey { session: S; kept: boolean; offered: Target | null; busy: boolean; text: string | null }
  const keyNow = (text: string | null = null): DrawnKey => ({ session: host.session(), kept: host.kept(), offered: host.offered(), busy: host.busy(), text });
  const sameOffered = (a: Target | null, b: Target | null): boolean => (a === null || b === null ? a === b : sameTarget(a, b));
  /** Gleicher Schlüssel: Ziel nach `sameTarget` (Art, Pfad, Zeilen, Blockinhalt), `kept`, `offered` nach `sameTarget`, alle übrigen Felder der Sitzung (Runden, Auswahl, Felder des Plugins) per Referenz;
   *  `busy` und `text` nur, wenn der Slot sie beim Zeichnen liest (`opts`). */
  function sameKey(d: DrawnKey | null, n: DrawnKey, opts: { busy?: boolean; text?: boolean }): boolean {
    if (d === null) return false;
    if (d.kept !== n.kept || !sameOffered(d.offered, n.offered) || !sameTarget(d.session.target, n.session.target)) return false;
    if (opts.busy === true && d.busy !== n.busy) return false;
    if (opts.text === true && d.text !== n.text) return false;
    const a = d.session as unknown as Record<string, unknown>;
    const b = n.session as unknown as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k !== "target" && !Object.is(a[k], b[k])) return false;
    }
    return true;
  }
  let drawnNotices: DrawnKey | null = null;
  let drawnControls: DrawnKey | null = null;
  let drawnChanges: DrawnKey | null = null;
  let drawnFields: DrawnKey | null = null;
  let drawnRounds: unknown = null;
  function renderNotices(): void {
    if (destroyed) return;
    // Ein Blattwechsel meldet `target` und, ohne Runde, `session` mit einem neuen Sitzungsobjekt gleichen Inhalts. Zeichnet der Rahmen die Hinweise dann neu, wird ein Knopf des Plugins beim `mousedown` ersetzt und der Klick kommt nie an.
    if (slots.notices !== undefined && sameKey(drawnNotices, keyNow(), {})) return;
    noticesHost.empty();
    if (slots.notices === undefined) return;
    drawnNotices = keyNow();
    const ticket = ++noticeTicket;
    slots.notices(noticesHost, {
      current: () => !destroyed && ticket === noticeTicket,
      busy: () => host.busy(),
      session: () => host.session(),
      setSession(next) { host.setSession(next); },
      run(instruction, exec) { host.start(instruction, exec); },
      setStatus: (phase, text) => { host.setStatus(phase, text); },
    });
  }

  function renderAll(): void {
    if (destroyed) return;
    renderWays();
    renderControlsSlot(false);
    renderHeader();
    renderNotices();
    renderRounds();
    renderChanges(false);
    renderPreview();
    renderControls();
  }

  // ---- Zuhörer am Halter --------------------------------------------------------------------
  function onEvent(event: HostEvent): void {
    if (destroyed) return;
    switch (event) {
      case "live":
        syncStream();
        paintLive();
        return;
      case "session": {
        // Das Feld folgt dem Halter nur hier und nur in einem Fall: ein eigener Lauf hat ein Ergebnis gebracht, das eine Runde ist, und der Halter hat den Entwurf geleert. Dieses Ereignis kommt noch im Lauf
        // (der Halter beendet den Lauf erst danach), jedes andere Session-Ereignis (Ziel, Rundenwahl, Verwerfen) kommt außerhalb und fasst das Feld nie an.
        if (host.running() && host.live().draft === "" && input.value !== "") input.value = "";
        renderAll();
        return;
      }
      case "target":
        renderHeader();
        renderNotices();
        // Ohne Runde zeigt die Vorschau den Stand des Ziels: ein anderes Ziel zeichnet sie neu.
        if (roundCount() === 0) renderPreview();
        return;
      case "run":
        renderControlsSlot();
        releaseAfterBusy();
        renderControls();
        if (wasRunning && !host.running()) input.focus();
        wasRunning = host.running();
        return;
      case "apply":
        renderControlsSlot();
        releaseAfterBusy();
        renderControls();
        return;
    }
  }

  const unsubscribe = host.subscribe(onEvent);
  renderAll();
  syncStream();
  paintLive();

  return {
    async requestClose() {
      // Läuft ein Lauf, bleiben Lauf und Sitzung beim Halter, ohne Rückfrage.
      if (host.running()) return;
      // Schreibt Übernehmen noch, ist die Sitzung gleich eine andere (Runden leer, Ziel die neue Datei): erst abwarten, sonst merkte „Behalten“ die alten Runden.
      if (host.applying()) await host.settled();
      if (!(await confirmDiscard(st.closeConfirm))) return;
      if (roundCount() > 0) host.discard();
    },
    refreshModelBar() {
      modelBar.update();
      renderHeader();
    },
    refreshAccept() {
      renderWays();
      renderControls();
    },
    refreshControls() {
      return refreshControlsNow();
    },
    reloadModels() {
      void modelBar.refresh();
    },
    async settled() {
      let n: number;
      do {
        n = previewWork.size;
        await host.settled();
        await Promise.all(Array.from(previewWork));
      } while (previewWork.size !== n || previewWork.size > 0);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      resizeObserver?.disconnect();
      if (cssRef !== null) workspace?.offref(cssRef);
      modelBar.destroy();
      offChatHost();
      slots.dispose?.();
      panelEl.remove();
      root.removeClass("okit-prompt-panel-host");
    },
  };
}

export const PROMPT_PANEL_CSS = `
/* Auftrags-Fenster (buildPromptPanel): nur Theme-Variablen und Obsidians Größenvariablen. Die Kit-Bausteine darin (Modellzeile, Antwortbereich, Rundenliste, Status) bringen ihr Aussehen aus ihren eigenen Konstanten mit. */
/* Obsidian blendet is-hidden nicht global aus: jeder Baustein setzt die Regel selbst. */
.okit-prompt-panel .is-hidden {
  display: none;
}

/* Zahlenfeld am Handy (iPhone, gemessen 2026-11-05): Die Dezimaltastatur hat keine Fertig-Taste und Obsidian verkleinert das Blatt der Seitenleiste nicht, Übernehmen lag unter der Tastatur. Der Abstand
   unten in Höhe der Tastatur macht den Rest erreichbar (keyboard-height ist 0px, solange keine Tastatur offen ist). Vier Klassen schlagen Obsidians workspace-leaf-content view-content. */
.is-mobile .workspace-leaf-content .view-content.okit-prompt-panel-host {
  padding-bottom: max(var(--size-4-8), var(--safe-area-inset-bottom, 0px), var(--keyboard-height, 0px));
}

.okit-prompt-panel {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.okit-prompt-panel-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.okit-prompt-panel-target {
  font-weight: var(--font-semibold);
  overflow-wrap: anywhere;
}

.okit-prompt-panel-hint {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.okit-prompt-panel-hint:empty {
  display: none;
}

.okit-prompt-panel-notices {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.okit-prompt-panel-notices:empty {
  display: none;
}

.okit-prompt-panel-controls:empty {
  display: none;
}

.okit-prompt-panel-accept-hints {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.okit-prompt-panel-accept-hint {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Der Hinweis ist ein Knopf, sieht aber aus wie eine Zeile Text: Obsidians Knopfregeln (button not clickable-icon, Hover) setzen Höhe, Rand, Grund und Schatten, deshalb drei Selektorteile. Der Fokusring bleibt (Tastatur). */
.okit-prompt-panel-end button.okit-prompt-panel-accept-hint {
  display: block;
  width: 100%;
  height: auto;
  padding: 0;
  border: 0;
  box-shadow: none;
  background: transparent;
  text-align: start;
  cursor: pointer;
}

.okit-prompt-panel-end button.okit-prompt-panel-accept-hint:hover {
  background: transparent;
  color: var(--text-normal);
}

.okit-prompt-panel-end button.okit-prompt-panel-accept-hint:focus-visible {
  box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
}

.okit-prompt-panel-end button.okit-prompt-panel-accept-hint.is-open {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}

/* Ein leerer Hinweis ist weder sichtbar noch fokussierbar: dieselbe Kette wie die Regel oben (drei Selektorteile), sonst gewinnt deren display block (Welle 38, Teil C). Der Rahmen setzt zusätzlich hidden und disabled. */
.okit-prompt-panel-end button.okit-prompt-panel-accept-hint:empty,
.okit-prompt-panel-end button.okit-prompt-panel-accept-hint[hidden] {
  display: none;
}

.okit-prompt-panel-input {
  width: 100%;
  resize: vertical;
}

.okit-prompt-panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}

.okit-prompt-panel-ways {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}

.okit-prompt-panel-empty,
.okit-prompt-panel-empty-endpoint {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background: var(--background-secondary);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.okit-prompt-panel-empty-detail {
  color: var(--text-faint);
}

.okit-prompt-panel-example {
  height: auto;
  white-space: normal;
  text-align: start;
}

/* Der Antwortbereich schrumpft nicht unter sechs Zeilen: in einer Spalte mit viel Inhalt (Vorschau, Änderungen, zwei Runden) fiele er sonst auf den Streifen der Statuszeile zusammen, und deren Inhalt
   ragte über die Box (gemessen in 3d-codeblocks, Welle 23). Die Obergrenze hält ihn klein, der Rumpf des Antwortbereichs rollt selbst. */
.okit-prompt-panel-stream {
  min-height: 6em;
  max-height: 16em;
}

/* Im Leerlauf (kein Lauf, kein Puffer) steht der Antwortbereich nur noch als Lesebereich im Baum: ein Pixel, unsichtbar, ohne Platz im Fluss (clip-path ist eine Store-Warnung, deshalb Deckkraft 0). Display none liesse die Ansage beim ersten Lauf unzuverlässig aus (aria-live). */
.okit-prompt-panel-stream.is-idle {
  position: absolute;
  width: 1px;
  height: 1px;
  min-height: 0;
  max-height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  opacity: 0;
  white-space: nowrap;
}

.okit-prompt-panel-preview-caption {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  margin-bottom: var(--size-4-1);
}

/* Die Knopfzeile klebt unten: Übernehmen und Verwerfen bleiben bei langem Inhalt erreichbar, die Sperrgründe stehen mit darin, je eine Zeile (der volle Text steht im DOM und am Knopf über aria-describedby).
   Sie trägt den Hintergrund des Blatts, auf dem das Fenster liegt (Schublade am Telefon, Seitenleiste, Tab), reicht über die ganze Breite des rollenden Bereichs und bis an seinen unteren Rand: der Rahmen misst
   das am nächsten deckenden und am rollenden Vorfahren und setzt die Custom Properties (measureEndFit, Welle 38, Teil A); ohne Messung gelten die Vorgaben. */
.okit-prompt-panel-end {
  position: sticky;
  bottom: calc(-1 * var(--okit-prompt-panel-end-bottom, 0px));
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  margin-left: calc(-1 * var(--okit-prompt-panel-end-left, 0px));
  margin-right: calc(-1 * var(--okit-prompt-panel-end-right, 0px));
  padding: var(--size-4-2) var(--okit-prompt-panel-end-right, 0px) calc(var(--size-4-2) + var(--okit-prompt-panel-end-pad-bottom, 0px)) var(--okit-prompt-panel-end-left, 0px);
  background: var(--okit-prompt-panel-end-bg, var(--background-primary));
  border-top: 1px solid var(--background-modifier-border);
}

/* Ohne Runde gibt es keine Fußzeile (der Rahmen setzt hidden): die Regel oben setzt display flex und schlüge sonst das hidden des Browsers. */
.okit-prompt-panel-end[hidden] {
  display: none;
}

/* Am Telefon nähme die klebende Zeile mehr als ein Fünftel des Blatts: sie steht am Ende des Inhalts (der Rahmen setzt is-static). */
.okit-prompt-panel-end.is-static {
  position: static;
}
`;
