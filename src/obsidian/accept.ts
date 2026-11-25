/** Die Schreibwege des Panels und die Meldungen des Uebernehmens (Kit `panel-accept`). Geschrieben wird nur ueber den Rahmen: `acceptPanel` mit Schnappschuss
 *  (`snapshotBeforeWrite`, vom Rahmen gesetzt) und `swapNote` ueber den Editor (Strg+Z).
 *
 *  - **Notiz ersetzen** (Ziel `file`): der Body wird das Ergebnis, die Frontmatter bleibt (`noteReplacement`). Abgelehnt, wenn der Body seit dem Lauf ein anderer ist.
 *  - **Markierung ersetzen** (Ziel `block`, vorlaeufig): gesperrt mit Grund, bis das Kit die Ziel-Art `selection` mit Schreibweg liefert (Bestellung B1, Welle 37).
 *  - **Neue Notiz**: gesperrt mit Grund, bis das Kit den Weg „neue Notiz“ und ein Ziel je Weg liefert (Bestellung B2, Welle 37).
 *  - **Kopieren** ist kein Schreibweg: ein Kopierknopf an der Vorschau (`view.ts`). */
import { rootInput, type TuneSession } from "../core/session";
import { noteReplacement } from "../core/target";
import { activeRound } from "../vendor/kit/rounds";
import { t } from "../vendor/kit/i18n";
import type { AcceptSpec, AcceptStrings } from "../vendor/kit-obsidian/panel-accept";
import type { PromptPanelWay } from "../vendor/kit-obsidian/prompt-panel";

export function acceptStrings(): AcceptStrings {
  return {
    unsupported: (label) => label,
    notApplied: (problem) => t("accept.notApplied", problem.replace(/[.\s]+$/, "")),
    unchanged: t("accept.unchanged"),
    cannotReplace: t("accept.cannotReplace"),
    blockMoved: t("accept.blockMoved"),
    blockChanged: t("accept.blockChanged"),
    noteChanged: t("accept.noteChanged"),
    closesFence: t("accept.closesFence"),
    cancelled: t("accept.cancelled"),
    noNoteOpen: t("accept.noNoteOpen"),
    noteInReadingView: t("accept.readingView"),
    appliedTo: (label) => t("accept.applied", label),
    appliedAsBlock: () => t("accept.inserted"),
    appendedToNote: t("accept.appended"),
    fileGone: (path) => t("accept.fileGone", path),
    fileExists: (path) => t("accept.fileExists", path),
    couldNotCreate: (path, reason) => t("accept.couldNotCreate", path, reason),
    savedFileWithReference: (path) => t("accept.saved", path),
    savedFileNoReference: (path) => t("accept.saved", path),
    savedFileAppended: (path) => t("accept.saved", path),
    savedFileReferenceFailed: (path, reason) => t("accept.savedRefFailed", path, reason),
    unclosedFence: () => t("accept.unclosed"),
    couldNotApply: (reason) => t("accept.couldNotApply", reason),
  };
}

/** Spec fuer „Notiz ersetzen“. Liest die Sitzung zur Schreibzeit (`session()`), nicht beim Zeichnen: der Knopf bleibt stehen, die Runde kann wechseln. */
export function noteSpec(session: () => TuneSession): Omit<AcceptSpec, "beforeWrite"> {
  return {
    fenceLang: "",
    wrap: (text) => text,
    compute: (current) => {
      const s = session();
      const round = activeRound(s.rounds);
      if (round === null) return { ok: false, problem: t("run.noop") };
      return noteReplacement(current, rootInput(s.rounds), round.output, { gone: t("accept.sourceGone"), changed: t("out.sourceChanged") });
    },
  };
}

/** Ein Weg, den es in dieser Version noch nicht gibt: Knopf sichtbar, gesperrt, Grund daneben. Er schreibt nie (der Rahmen ruft `acceptPanel` nur mit freiem Knopf). */
function pendingWay(id: string, label: string, reason: string): PromptPanelWay<TuneSession> {
  return {
    id, label,
    blockedReason: () => reason,
    spec: { fenceLang: "", wrap: (x) => x, compute: () => ({ ok: false, problem: reason }) },
    kind: () => "refine",
  };
}

export function tuneWays(s: TuneSession, session: () => TuneSession): PromptPanelWay<TuneSession>[] {
  const ways: PromptPanelWay<TuneSession>[] = [];
  if (s.target.kind === "file") ways.push({ id: "replace-note", label: t("out.replaceNote"), spec: noteSpec(session), kind: () => "refine" });
  if (s.target.kind === "block") ways.push(pendingWay("replace-selection", t("out.replaceSelection"), t("out.selectionPending")));
  ways.push(pendingWay("new-note", t("out.newNote"), t("out.newNotePending")));
  return ways;
}
