// vendored from obsidian-kit@0.110.0, src/obsidian/prompt-panel-host.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Verdrahtung des Halters eines Auftrags-Fensters (K9, Welle 36): der Halter-Kern aus code-kit (`createPanelHost`, vendort aus `panel-host`) plus das, was ein Plugin im Obsidian-Raum
// dazu braucht, wenn das Fenster zu ist: ein Eintrag in der Statusleiste und eine Meldung am Ende des Laufs. Der Kern bleibt ohne `obsidian`; hier hängt es dran.
//
// ## Was die Verdrahtung tut (Spec § 7.3)
//
// - Sie umhüllt `subscribe` des Kerns und zählt die Anmeldungen über die Hülle als Rahmen (`frames`). Ihr eigener Zuhörer am Kern zählt nicht, sonst wäre `listeners()` nie 0; `listeners()` meldet deshalb
//   die Rahmen.
// - **Statusleiste:** der Eintrag steht genau dann, wenn der Schalter an ist (`statusBar()` beim Bauen, danach `setStatusBarVisible`), es kein Handy ist, kein Rahmen angemeldet ist und entweder ein Lauf
//   läuft („{Name}: läuft“) oder ein Lauf ohne Rahmen mit einem Ergebnis geendet hat („{Name}: Ergebnis wartet“). Meldet sich ein Rahmen an, verschwindet der Eintrag. Ein Klick (und Enter/Leertaste)
//   öffnet das Fenster (`open()`).
// - **Meldung (`Notice`)** am Ende eines Laufs ohne Rahmen: bei einem Ergebnis `noticeDone(name)`, bei `error` und `no-endpoint` der Statustext, bei einem Abbruch keine (der Abbruch kam vom
//   Nutzer). „Ergebnis wartet“ gibt es nur bei einem Ergebnis, weil sonst keine Runde wartet. Am Handy gibt es keine Statusleiste, die Meldung bleibt; ist der Schalter aus, bleibt sie auch.
// - Sie schreibt nie: das Ergebnis eines Laufs ohne Rahmen wartet als Runde der Sitzung (Kern), bis ein Rahmen es zeigt und ein Mensch auf Übernehmen drückt.
// - `destroy()` hängt den Eintrag ab und zerstört den Kern (Lauf abbrechen, Sitzung verwerfen, `onunload`).
//
// Einstellungszeile: `buildStatusBarSetting` (Kit) ruft in `onChange` `host.setStatusBarVisible(v)` und speichert.

import { Notice, Platform, type Plugin } from "obsidian";
import { createPanelHost, type HostEvent, type PanelHost, type PanelHostOptions } from "../kit/panel-host";
import type { PanelSession } from "../kit/panel-session";
import { resolvePromptPanelStrings, type PromptPanelStrings } from "./prompt-panel-strings";
import { createStatusBarItem } from "./status-bar-item";

/** `strings` des Kerns (running, aborted, noEndpoint) leitet die Verdrahtung aus `PromptPanelStrings` ab; deshalb `Omit`. */
export type PromptPanelHostOptions<S> = Omit<PanelHostOptions<S>, "strings"> & {
  plugin: Plugin;
  /** Name des Fensters in Eintrag und Meldung („SVG Studio“). */
  name: string;
  /** Öffnet das Fenster (Klick auf den Eintrag). */
  open(): void;
  /** Der Schalter „Statusleiste“ der Einstellungen beim Bauen. */
  statusBar(): boolean;
  lang: "en" | "de";
  strings?: Partial<PromptPanelStrings>;
};

export interface PromptPanelHost<S extends PanelSession<unknown>> extends PanelHost<S> {
  /** Der Schalter „Statusleiste“ wurde umgelegt: legt den Eintrag an oder hängt ihn ab (der gemerkte Text steht beim Einschalten wieder da). */
  setStatusBarVisible(on: boolean): void;
}

export function createPromptPanelHost<S extends PanelSession<unknown>>(o: PromptPanelHostOptions<S>, initial?: S): PromptPanelHost<S> {
  const st = resolvePromptPanelStrings({ lang: o.lang, ...o.strings });
  const core = createPanelHost<S>(
    { fresh: o.fresh, run: o.run, model: o.model, strings: { running: st.running, aborted: st.aborted, noEndpoint: st.noEndpoint } },
    initial,
  );
  let frames = 0;
  let waiting = false;
  let wasRunning = false;
  let destroyed = false;
  let switchOn = o.statusBar();

  const open = (): void => { o.open(); };
  // Am Handy gibt es keine Statusleiste: kein Eintrag, die Meldung bleibt.
  const item = Platform.isMobile
    ? null
    : createStatusBarItem({
      plugin: o.plugin,
      visible: switchOn,
      text: null,
      cls: ["okit-prompt-panel-statusbar", "mod-clickable"],
      onCreate: (el) => {
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.addEventListener("click", open);
        el.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });
      },
    });

  /** Was der Eintrag jetzt sagt; `null` blendet ihn aus (mit Rahmen, ohne Anlass). */
  function entryText(): string | null {
    if (frames > 0) return null;
    if (core.running()) return st.statusRunning(o.name);
    if (waiting && core.session().rounds.rounds.length > 0) return st.statusWaiting(o.name);
    return null;
  }

  function refresh(): void {
    item?.set(entryText());
  }

  /** Das Ende eines Laufs, den kein Rahmen begleitet hat: Meldung nach Ausgang, bei einem Ergebnis wartet die Runde. */
  function runEnded(): void {
    const status = core.live().status;
    if (status.phase === "ok") {
      waiting = true;
      new Notice(st.noticeDone(o.name));
    } else if (status.phase === "error") {
      new Notice(status.text);
    }
    // Abbruch (Status „idle“): der Abbruch kam vom Nutzer, keine Meldung.
  }

  core.subscribe((event: HostEvent) => {
    if (destroyed) return;
    if (event === "run") {
      const running = core.running();
      if (running && !wasRunning) waiting = false; // ein neuer Lauf nimmt „Ergebnis wartet“ zurück
      if (wasRunning && !running && frames === 0) runEnded();
      wasRunning = running;
    }
    refresh();
  });

  const host: PromptPanelHost<S> = {
    ...core,
    subscribe(listener) {
      if (destroyed) return () => undefined;
      const off = core.subscribe(listener);
      frames++;
      if (frames === 1) waiting = false; // ein Rahmen zeigt die wartende Runde: der Eintrag hat seinen Zweck erfüllt
      refresh();
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        off();
        frames--;
        refresh();
      };
    },
    listeners: () => frames,
    setStatusBarVisible(on) {
      if (destroyed) return;
      switchOn = on;
      item?.setVisible(on);
      refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      item?.destroy();
      core.destroy();
    },
  };
  return host;
}
