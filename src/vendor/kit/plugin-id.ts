// vendored from obsidian-kit@0.110.0, src/pure/plugin-id.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Höchstlänge einer Plugin-ID. Keine Obsidian-Regel, sondern eine Schranke für Ordnernamen,
 *  Meldungen und Oberflächenzeilen: gemessen 2026-10-14 an der Store-Liste (8912 IDs) ist die längste ID
 *  55 Zeichen lang, 128 lässt reichlich Luft und weist trotzdem einen Megabyte-String aus einer
 *  handgeschriebenen `data.json` ab, bevor er in einen Pfad wandert. */
export const PLUGIN_ID_MAX_LENGTH = 128;

const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Gerätenamen von Windows: `con`, `con.txt`, `CON.x` sind dort kein Ordner. Die Store-Liste enthält gemessen keinen (2026-10-14, 8912 IDs),
 *  anysource-sideloader installiert aber aus beliebigen Katalogen. */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Ist `id` eine Plugin-ID, die als Ordnername unter `<configDir>/plugins/` sicher ist? Das ist die
 *  Pfadsicherheits-Prüfung beider Träger (anysource-sideloader `pluginDir`, settings-assistant
 *  `targetPath`), keine Aussage darüber, ob das Plugin existiert.
 *
 *  Grammatik: ASCII-Buchstaben und -Ziffern, dazu `-`, `_`, `.` ab dem zweiten Zeichen; höchstens
 *  `PLUGIN_ID_MAX_LENGTH` Zeichen; kein `..`; kein Punkt am Ende.
 *
 *  Warum diese und nicht die strengere von anysource-sideloader (`[a-z0-9][a-z0-9\-_]{0,63}`): deren Dokumentation
 *  nennt die Strenge eine Einschränkung („stricter than Obsidian's“), einen Grund nennt weder Code noch Doku, und
 *  sie verwirft gemessen fünf von 8912 Store-Plugins (`ObsidianAnkiSync`, `OA-file-hider`, `scrybble.ink` …)
 *  — ein Unterschied ohne Grund ist Drift. Die von settings-assistant (`[A-Za-z0-9][A-Za-z0-9._-]*` ohne `..`)
 *  verwirft keine der 8912.
 *
 *  Zwei Zusätze gegenüber beiden Trägern, beide aus dem Ziel „sicherer Ordnername“: die Längenschranke und
 *  der Punkt am Ende (Windows streift ihn ab, `foo.` und `foo` wären derselbe Ordner). Beide verwerfen keine
 *  der 8912 Store-IDs.
 *
 *  Dazu die reservierten Gerätenamen von Windows (`con`, `nul`, `com1` …, mit und ohne Endung): als Ordnername unbrauchbar.
 *
 *  **Die Prüfung faltet keine Groß-/Kleinschreibung, `samePluginId` tut es.** APFS und NTFS unterscheiden sie nicht, `Foo` und `foo`
 *  sind dort derselbe Ordner. anysource-sideloader bekam die Kleinschreibung bisher unbeabsichtigt mit seiner Grammatik; wer fragt „liegt dieser
 *  Ordner schon da?“ (schon installiert? gebunden an? eigene ID?), nimmt `samePluginId`, nicht `===`. Wer fragt „ist das noch dieselbe ID?“
 *  (ein Wechsel soll auffallen), vergleicht mit `===` — Begründung an `samePluginId`.
 *
 *  Die Funktion nimmt auch Nicht-Strings entgegen und lehnt sie ab (die Aufrufer lesen die ID aus fremdem JSON). */
export function isValidPluginId(id: string): boolean {
  return typeof id === "string" && id.length <= PLUGIN_ID_MAX_LENGTH && PLUGIN_ID_RE.test(id)
    && !id.includes("..") && !id.endsWith(".") && !WINDOWS_RESERVED_RE.test(id);
}

/** Dieselbe Plugin-ID, wie das Dateisystem sie sieht: ohne Rücksicht auf Groß-/Kleinschreibung (APFS, NTFS).
 *
 *  **Falten nur für „ist das schon da?“ (liegt dort schon ein Ordner, ist das schon installiert, woran ist es gebunden), nie für „ist das noch
 *  dasselbe?“.** Ein Guard, der einen ID-**Wechsel** erkennen soll (`expectedId` in einem Update, `applyUpdate`), vergleicht mit `===`: mit
 *  `samePluginId` ging in anysource-sideloader ein Release durch, das die ID nur in der Schreibweise änderte (`Demo` statt `demo`) —
 *  für das Dateisystem derselbe Ordner, für Obsidian (`manifest.id`, `enabledPlugins`) eine andere ID (Sicherheitsreview an `dd49d3d`,
 *  Welle 22). Merkregel: Frage nach dem **Ort** → `samePluginId`; Frage nach der **Identität** → `===`. */
export function samePluginId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
