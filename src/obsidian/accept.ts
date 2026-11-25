/** Die Schreibwege des Panels und die Meldungen des Uebernehmens (Kit `panel-accept`). Geschrieben wird nur ueber den Rahmen: `acceptPanel` mit Schnappschuss
 *  (`snapshotBeforeWrite`, vom Rahmen gesetzt) und ueber den Editor (Strg+Z).
 *
 *  - **Notiz ersetzen** (Ziel `file`): der Body wird das Ergebnis, die Frontmatter bleibt (`noteReplacement`). Abgelehnt, wenn der Body seit dem Lauf ein anderer ist.
 *  - **Markierung ersetzen** (Ziel `selection`, Kit seit 0.111.0): die Spanne wird `lead + Ergebnis + trail` (`splitSelectionAffix`, code-kit `editor-span`); den Fingerabdruck
 *    und das Wiederfinden nach Zeilen darueber prueft der Baustein.
 *  - **Neue Notiz** (`where: "note"`, eigenes Ziel `new`): aus jeder Quelle eine neue Notiz im Ordner der Einstellung, Name `<Quelle> (getunt)`, geoeffnet in einem neuen Tab;
 *    die Sitzung bleibt auf ihrem Ziel.
 *  - **Kopieren** ist kein Schreibweg: ein Kopierknopf an der Vorschau (`view.ts`). */
import { rootInput, rootSourceName, type TuneSession } from "../core/session";
import { noteReplacement } from "../core/target";
import { activeRound } from "../vendor/kit/rounds";
import { splitSelectionAffix } from "../vendor/kit/editor-span";
import { t } from "../vendor/kit/i18n";
import type { AcceptSpec, AcceptStrings } from "../vendor/kit-obsidian/panel-accept";
import { resolveAcceptStrings } from "../vendor/kit-obsidian/panel-accept-strings";
import type { PromptPanelWay } from "../vendor/kit-obsidian/prompt-panel";

/** Die Kit-Texte (`ACCEPT_STRINGS_EN/DE`); eigen bleiben nur die Saetze, die lingotuners Sache sind (Gegenlesung K-A): Notiz statt Ziel, Strg+Z im Erfolgssatz. */
export function acceptStrings(lang: "en" | "de"): AcceptStrings {
  return resolveAcceptStrings({
    lang,
    unchanged: t("accept.unchanged"),
    cannotReplace: t("accept.cannotReplace"),
    appliedTo: (label) => t("accept.applied", label),
  });
}

type Problem = { ok: false; problem: string };

/** Der Text der aktiven Runde, wenn die Runden-Kette aus `current` begann; sonst der Grund. */
function roundFor(s: TuneSession, current: string | null): { ok: true; output: string } | Problem {
  const round = activeRound(s.rounds);
  if (round === null) return { ok: false, problem: t("run.noop") };
  if (current === null) return { ok: false, problem: t("accept.sourceGone") };
  if (rootInput(s.rounds) !== current) return { ok: false, problem: t("out.sourceChanged") };
  return { ok: true, output: round.output };
}

/** Spec fuer „Notiz ersetzen“. Liest die Sitzung zur Schreibzeit (`session()`), nicht beim Zeichnen: der Knopf bleibt stehen, die Runde kann wechseln. */
export function noteSpec(session: () => TuneSession): Omit<AcceptSpec, "beforeWrite"> {
  return {
    compute: (current) => {
      const s = session();
      const round = activeRound(s.rounds);
      if (round === null) return { ok: false, problem: t("run.noop") };
      return noteReplacement(current, rootInput(s.rounds), round.output, { gone: t("accept.sourceGone"), changed: t("out.sourceChanged") });
    },
  };
}

/** Spec fuer „Markierung ersetzen“: `current` ist der markierte Text (der Baustein hat ihn gegen die Notiz geprueft), geschrieben wird die Spanne samt ihrem Rand-Leerraum. */
export function selectionSpec(session: () => TuneSession): Omit<AcceptSpec, "beforeWrite"> {
  return {
    compute: (current) => {
      const r = roundFor(session(), current);
      if (!r.ok) return r;
      const { lead, trail } = splitSelectionAffix(current ?? "");
      return { ok: true, text: lead + r.output + trail };
    },
  };
}

export interface NewNoteDeps {
  /** Ordner aus der Einstellung (vault-relativ, `""` und `"/"` = Wurzel). */
  folder(): string;
  /** Name fuer eine Notiz ohne Quellnotiz (`LingoTuner <Datum Uhrzeit>`). */
  stamp(): string;
  /** Nach dem Anlegen: die Notiz in einem neuen Tab oeffnen. */
  open(path: string): void | Promise<void>;
}

/** Spec fuer „Neue Notiz“: Inhalt ist genau das Ergebnis der aktiven Runde, ohne Frontmatter. */
export function newNoteSpec(session: () => TuneSession, deps: NewNoteDeps): Omit<AcceptSpec, "beforeWrite"> {
  return {
    caller: "lingotuner",
    compute: () => {
      const round = activeRound(session().rounds);
      return round === null ? { ok: false, problem: t("run.noop") } : { ok: true, text: round.output };
    },
    newNote: (text) => {
      const folder = deps.folder().trim().replace(/^\/+|\/+$/g, ""); // "/" heisst Wurzel wie bisher
      const base = rootSourceName(session().rounds) ?? deps.stamp();
      return { folder, name: `${base} ${t("out.newNoteSuffix")}`, content: text };
    },
    onCreated: (path) => deps.open(path),
  };
}

export function tuneWays(s: TuneSession, session: () => TuneSession, note: NewNoteDeps): PromptPanelWay<TuneSession>[] {
  const ways: PromptPanelWay<TuneSession>[] = [];
  if (s.target.kind === "file") ways.push({ id: "replace-note", label: t("out.replaceNote"), spec: noteSpec(session), kind: () => "refine" });
  if (s.target.kind === "selection") ways.push({ id: "replace-selection", label: t("out.replaceSelection"), spec: selectionSpec(session), kind: () => "refine" });
  ways.push({ id: "new-note", label: t("out.newNote"), spec: newNoteSpec(session, note), kind: () => "create", where: "note", target: () => ({ kind: "new" }) });
  return ways;
}
