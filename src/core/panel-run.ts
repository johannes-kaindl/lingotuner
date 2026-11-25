/** Der Lauf des Panels (Halter-Option `run` des Kit-Rahmens): Eingabe bestimmen, `tune()` des Plugins rufen, Ergebnis als Runde.
 *
 *  Panel und Anbieter-API gehen denselben Ausfuehrungspfad: `tune` ist `LingoTunerPlugin.tune()` (Endpunkt, Overrides, Prompt, Stream, Lab, Logbuch); hier steht nur,
 *  was das Panel davor und danach tut. Sperre gegen einen zweiten Lauf, Abbruch und Handvergleich (ein spaetes Ergebnis eines abgebrochenen Laufs aendert nichts)
 *  besorgt der Halter (code-kit `panel-host`).
 *
 *  Eingabe: ohne Runde (oder mit `fromSource`) der Text des Ziels, sonst die Ausgabe der AKTIVEN Runde (Nachschaerfen baut auf ihr auf; die Rundenwahl des Rahmens
 *  setzt sie). Die Anmerkung ist der Auftrag des Rahmens (`instruction`, darf leer sein). */
import { isNoop, type Dials } from "./dials";
import { rootSourceName, type Round, type TuneSession } from "./session";
import type { TuneResult } from "./llm/client";
import { errorMessageKey } from "./llm/errors";
import type { HostRunCall, HostRunResult } from "../vendor/kit/panel-host";
import type { Target } from "../vendor/kit/panel-session";
import { pushRound } from "../vendor/kit/rounds";
import { t } from "../vendor/kit/i18n";

export interface TuneCall {
  text: string;
  dials: Dials;
  note: string;
  signal: AbortSignal;
  onToken(tk: string): void;
  onReasoning(tk: string): void;
  onContentReset(): void;
}

export interface TuneRunDeps {
  dials(): Dials;
  /** Text und Quellname des Ziels JETZT, oder warum es keinen gibt. */
  sourceOf(target: Target): Promise<{ text: string; name: string | null } | { problem: string }>;
  tune(call: TuneCall): Promise<TuneResult>;
  now?(): number;
}

export function createTuneRun(d: TuneRunDeps, opts: { fromSource?: boolean } = {}): (call: HostRunCall<TuneSession>) => Promise<HostRunResult<TuneSession>> {
  return async ({ session, instruction, signal, io, model }) => {
    const dials = d.dials();
    const note = instruction;
    // Mitte und leere Anmerkung erzeugen keine Anweisung: kein Modellaufruf, die Statuszeile sagt warum.
    if (isNoop(dials, note)) return { ok: false, kind: "error", message: t("run.noop") };
    const active = session.rounds.active;
    const basedOn = opts.fromSource === true || active < 0 ? null : active;
    let input: string;
    let sourceName: string | null;
    if (basedOn !== null) {
      const from = session.rounds.rounds[basedOn];
      if (from === undefined) return { ok: false, kind: "error", message: t("run.noop") };
      input = from.output;
      // Die Kette hat genau eine Quelle: beim Nachschaerfen der Name der Wurzel.
      sourceName = rootSourceName(session.rounds);
    } else {
      const src = await d.sourceOf(session.target);
      if (signal.aborted) return { ok: false, kind: "aborted" };
      if ("problem" in src) return { ok: false, kind: "error", message: src.problem };
      input = src.text;
      sourceName = src.name;
    }

    io.start();
    const result = await d.tune({
      text: input, dials, note, signal,
      onToken: (tk) => { io.onToken(tk); },
      onReasoning: (tk) => { io.onReasoning(tk); },
      onContentReset: () => { io.onContentReset(); },
    });
    if (signal.aborted) return { ok: false, kind: "aborted" };
    if (!result.ok) {
      if (result.error.kind === "aborted") return { ok: false, kind: "aborted" };
      const { key, args } = errorMessageKey(result.error);
      return { ok: false, kind: "error", message: t(key, ...args) };
    }
    const round: Round = {
      dials: { ...dials }, note, input, output: result.text, model: result.model || model, at: (d.now ?? Date.now)(),
      basedOn, sourceName, truncated: result.truncated,
    };
    return {
      ok: true,
      session: { ...session, rounds: pushRound(session.rounds, round) },
      message: t(result.truncated ? "status.truncated" : "status.done"),
    };
  };
}
