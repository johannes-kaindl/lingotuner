// vendored from obsidian-kit@0.112.0, src/obsidian/chat-host.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Der Host eines Chats auf dem Handy (seit 0.76.1 ein eigener Baustein; `buildChatWindow` benutzt ihn selbst). Für Chats, die ihr Fenster von Hand bauen (koda-agent) und deshalb weder
 *  `buildChatWindow` noch `chat-window.ts` vendoren.
 *
 *  Ein Chat im Hauptbereich steht in einem `view-content`. Dort wirken auf dem Handy zwei Dinge auf den unteren Abstand: Obsidians eigene Regel (`.workspace-leaf-content .view-content`,
 *  `padding-bottom: max(var(--safe-area-inset-bottom), …)`) und die schwebende Navigationsleiste. Bei offener Tastatur ergibt das 328 px leere Fläche (am iPhone gemessen, Welle 30), weil Obsidian
 *  `--safe-area-inset-bottom` dann auf die Tastaturhöhe setzt und zugleich den App-Container verkleinert.
 *
 *  **Baue in `contentEl`, nicht in `containerEl`.** Eine ItemView hat zwei Wurzeln: `contentEl` ist der `view-content`, `containerEl` das `workspace-leaf-content` darüber, das keinen `view-content` als Vorfahren hat.
 *  `markChatHost(this.containerEl)` tut deshalb still nichts (leere Rücknahme, keine Warnung, der Abstand am Handy greift nie; kuro-gamification baute bis Welle 30 so). Bewusst keine Warnung und kein Rückfall auf
 *  `.workspace-leaf-content` (anderes Padding-Modell, ungemessen): ein Fehler, ein Konsument; eine Warnung kommt, wenn ein zweiter Konsument denselben Fehler macht (Entscheidung Welle 33).
 *
 *  Benutzung: `const off = markChatHost(this.contentEl)` beim Aufbau, `off()` beim Abbau; `CHAT_HOST_CSS` in die `styles.css` kopieren (das Kit injiziert kein CSS). Wer `CHAT_WINDOW_CSS` kopiert, hat die Regel schon:
 *  sie steht dort wortgleich (ein Test hält beide gleich, die Konstanten sind reine Template-Literale ohne Einsetzung, `tests/kit-css-literal.test.ts` hält das für alle fest). */
const HOST_CLASS = "okit-chat-host";
/** Wie viele Fenster einen Host gerade belegen: die Klasse fällt erst, wenn das letzte geht (zwei Chats in einem `view-content`). */
const holders = new WeakMap<HTMLElement, number>();

/** Markiert den `view-content`-Vorfahren von `containerEl` (auch `containerEl` selbst, wenn es der `view-content` ist) als Chat-Host und gibt die Rücknahme zurück (idempotent). Ohne `view-content`
 *  (Modal, Popover) und im Fake-DOM der Tests, das kein `closest` kennt, geschieht nichts, und die Rücknahme ist leer. */
export function markChatHost(containerEl: HTMLElement): () => void {
  const host = (containerEl as { closest?: (sel: string) => HTMLElement | null }).closest?.(".view-content") ?? null;
  if (host === null) return () => {};
  holders.set(host, (holders.get(host) ?? 0) + 1);
  host.addClass(HOST_CLASS);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holders.get(host) ?? 1) - 1;
    if (left > 0) { holders.set(host, left); return; }
    holders.delete(host);
    host.removeClass(HOST_CLASS);
  };
}

export const CHAT_HOST_CSS = `
/* Host-Abstand im Hauptbereich auf dem Handy (0.76.0, Befund der Realprobe am iPhone: 215 px leere Fläche zwischen Senden und Tastatur). Die schwebende Navigationsleiste liegt über dem unteren Rand und braucht Platz
   (--navbar-height plus die echte Safe-Area); bei offener Tastatur verkleinert Obsidian den App-Container selbst und die Leiste ist weg, dann braucht der Host nichts. Zwei Fallen: Obsidian setzt bei offener Tastatur
   die Variable --safe-area-inset-bottom auf die Tastaturhöhe (328 px, darum env() statt der Variable: es bleibt der echte Wert), und es gibt keine Tastaturklasse, nur --keyboard-height (0px, offen die Tastaturhöhe):
   die Zehn macht daraus einen Schalter (Leiste plus Safe-Area sind unter 100 px, 10 x Tastaturhöhe weit darüber, max() fängt es bei 0 ab). Mit der Host-Klasse und vier Klassen: die Regel schlägt Obsidians
   .workspace-leaf-content .view-content (max(var(--safe-area-inset-bottom), var(--size-4-8))), die bei offener Tastatur selbst 328 px ergäbe. Nur im Hauptbereich; in einer Seitenleiste deckt die Schublade die Leiste ab.
   Ungemessen: eine angedockte (nicht schwebende) Leiste, dort bleibt Obsidians Regel. */
.is-mobile.is-floating-nav .mod-root .view-content.okit-chat-host { box-sizing: border-box; padding-bottom: max(0px, calc(var(--navbar-height) + env(safe-area-inset-bottom) - 10 * var(--keyboard-height, 0px))); }
`;
