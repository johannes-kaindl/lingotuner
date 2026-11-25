// vendored from obsidian-kit@0.111.0, src/obsidian/file-snapshot.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Herkunft: obsidian-transmute `src/obsidian/snapshot-io.ts` (`snapshotRoot`, `ensureDir`, `writeSnapshot`, `rotateSnapshots`) und `src/core/vault/snapshot.ts`
// (`snapshotDirName`), auf eine Einzeldatei zugeschnitten; REGISTRY „Rückholbarkeit für Schreibvorgänge“ führte transmute als Kit-Kandidaten, svg-studio ist
// der zweite Träger (K15, bedingt durch die Messung A4 vom 2026-11-04: Obsidians Dateiwiederherstellung erfasst nur Markdown, `.svg` und andere Dateien nicht).
// Was transmute darüber hinaus trägt (Manifest mit Regel und Hashes, Rückholentscheidung) bleibt dort: es gehört zu einem Lauf über viele Dateien, nicht zum
// Schnappschuss einer Datei.
//
// Ein Schnappschuss VOR dem Überschreiben einer Datei, die Obsidian selbst nicht sichert. Gedacht als `beforeWrite` für `acceptPanel`: scheitert der Schnappschuss,
// wird nichts geschrieben.
//
// ── Baumform (seit 0.91.0, Welle 34) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `<configDir>/plugins/<pluginId>/snapshots/by-file/<Vault-Pfad>/<Stempel><Endung>`, z. B. `…/snapshots/by-file/Grafiken/logo.svg/2026-11-14T16-20-31-123Z.svg`.
// Der Vault-Pfad der Datei ist ein Ordner, jeder Stand eine Datei darin (Stempel UTC mit Millisekunden, `stampedName` aus code-kit `rotation`; die Endung der Datei
// bleibt, damit ein Stand im Dateimanager öffnet). Gelesen wird je Ordner nur, was einen Stempel am Anfang des Namens trägt; alles andere darin (etwa ein tieferer Pfad,
// weil ein Vault-Ordner später so heißt wie die Datei) ist unbekannt und bleibt. Bis 0.89.0 lag ein Ordner je Stand direkt unter `snapshots/` (`<Stempel>/<Vault-Pfad>`).
//
// ── Aufbewahrung JE DATEI (Zusage) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Stände einer Datei werden nur gegen die Stände DIESER Datei bewertet; ein Stand einer anderen Datei ändert das Ergebnis nie. Drei Stufen, in dieser Reihenfolge:
//   1. Staffelung Großvater-Vater-Sohn (PROF-OBS-15, `selectGfsRetention`, Vorgabe `DEFAULT_GFS_POLICY`: 6 heute · 7 Tage · 4 Wochen · 6 Monate, höchstens 23 Stände;
//      `policy` ersetzt sie): von dem, was die Staffelung hält,
//   2. fällt, was älter ist als `maxAgeDays` (Vorgabe 185, vom Zeitpunkt `now` aus, nicht von der letzten Änderung der Datei),
//   3. bleiben mehr als `maxPerFile` (Vorgabe 50), fallen die ältesten.
// Stufe 2 und 3 sind Obergrenzen ÜBER der Staffelung, kein zweites Verfahren: mit der Vorgabe greifen sie nie (die Staffelung hält höchstens 23 Stände, keinen älter als
// ~6 Monate; `tests/file-snapshot.test.ts` misst, dass 185 Tage das Monatsfenster nicht anschneiden). Sie gelten erst, wenn der Träger `policy` weiter fasst.
// Stände mit einem Stempel NACH `now` (die Uhr ging zurück) bleiben in allen Stufen: unbekannt heißt behalten.
//
// ── Gesamtdeckel ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `maxTotalBytes` (Vorgabe 50 MB) über alle Stände aller Dateien dieses Plugins, das Sicherheitsnetz für den Plattenplatz. Größe aus `adapter.stat(p).size`, der eben
// geschriebene Stand aus seiner Länge in UTF-8; liefert `stat` nichts, zählt der Stand 0 und das Ergebnis meldet `unmeasured`. Wer zuerst fällt, wenn die Summe
// übersteigt: 1. Stände VERWAISTER Dateien (im Vault gelöscht oder umbenannt: `adapter.exists(<Vault-Pfad>)` ist falsch; ein Fehler von `exists` heißt „lebt“), älteste
// zuerst; 2. Stände lebender Dateien, die nicht der neueste ihrer Datei sind, älteste zuerst über alle Dateien; 3. zuletzt der jeweils neueste einer lebenden Datei.
// Reicht auch das nicht, meldet das Ergebnis `overCap: true`. **Der eben geschriebene Stand fällt in keiner Stufe und in keinem Rang**; `ok: true` meldet nie einen
// Pfad, der nach dem Aufruf nicht existiert.
//
// ── Übernahme des Altbestands (vor dem Schreiben, bei jedem Aufruf) ────────────────────────────────────────────────────────────────────────────────────────────────
// Alt ist ein Ordner DIREKT unter `snapshots/` mit vollem, lesbarem Stempelnamen. Jede Datei darin wird nach `by-file/<Vault-Pfad>/<Stempel><Endung>` überführt:
// kopieren, das Ziel zurücklesen und Byte für Byte vergleichen, erst dann die Quelle löschen. Liegt das Ziel schon da, entscheidet der Byte-Vergleich (gleich: nur die
// Quelle löschen; ungleich: `conflicts`, beide bleiben). Wiederholbar und unterbrechbar: ein Abbruch an jeder Stelle lässt höchstens eine Datei doppelt, der nächste
// Aufruf räumt sie weg. Alles andere direkt unter `snapshots/` außer `by-file` (Ordner ohne lesbaren Stempel, Dateien) bleibt liegen und zählt als `unreadable`. Die
// Übernahme ist für sich sicher: scheitert sie, wird trotzdem geschrieben und das Ergebnis nennt es (`migrationError`); scheitert das Schreiben, wird nichts gelöscht.
// Danach greift die Staffelung je Datei sofort, ein übernommener Bestand kann dabei dünner werden.
//
// ── Grenze: Umbenennen zieht nicht mit ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Wird eine Datei im Vault umbenannt oder gelöscht, bleibt ihr Ordner unter `by-file/`: ihre Stände gelten als verwaist, altern nach `maxAgeDays` aus und fallen im
// Deckel zuerst. Sie wandern nicht zum neuen Namen.
//
// Weiter:
// - **`configDir`, nie `.obsidian`:** der Ordner ist konfigurierbar (`hardcoded-config-path`).
// - **Vor dem Rotieren schreiben:** erst die neue Kopie, dann das Löschen der überzähligen; ein Schreibfehler rotiert nichts, der letzte gute Schnappschuss bleibt.
//   Ein Fehler beim Löschen macht den neuen Schnappschuss nicht ungültig (er liegt da); der Aufrufer darf schreiben.
// - **Kalender:** Vorgabe `localCalendar` (der Tag des Nutzers); `calendar` ersetzt ihn (Tests: `utcCalendar`, sonst hängt das Ergebnis von der Zeitzone ab).
// - **Nie überschreiben:** zwei Schnappschüsse derselben Datei im selben Moment bekommen verschiedene Stempel (eine Millisekunde weiter).
// - **Unsichere Eingaben vorher abgelehnt:** eine Plugin-ID, die kein sicherer Ordnername ist (`isValidPluginId`), ein Pfad mit `..`, absolut oder mit `\`, und eine
//   Grenze, die negativ oder NaN ist (`Infinity` heißt ohne Grenze).

import type { App, DataAdapter } from "obsidian";
import { isValidPluginId } from "../kit/plugin-id";
import { errorMessage } from "../kit/error-message";
import { type GfsCalendar, type GfsPolicy, selectGfsRetention, stampedName, timeFromStampedName } from "../kit/rotation";
import { ensureDir } from "../kit/ensure-dir";
import { bytesEqual } from "../kit/bytes-equal";

export interface SnapshotLimits {
  /** Höchstens so viele Stände je Datei (nach der Staffelung). Vorgabe 50; `Infinity` ohne Grenze. */
  maxPerFile?: number;
  /** Kein Stand älter als so viele Tage vor `now` (nach der Staffelung). Vorgabe 185; `Infinity` ohne Grenze. */
  maxAgeDays?: number;
  /** Höchstens so viele Bytes über alle Stände des Plugins. Vorgabe 50 MiB; `Infinity` ohne Grenze. */
  maxTotalBytes?: number;
}

export type SnapshotResult =
  | {
      ok: true;
      snapshotPath: string;
      /** Gelöschte Stände (Staffelung, Alter, Anzahl, Deckel), nur wenn mindestens einer. */
      dropped?: number;
      /** Stände, deren Größe `stat` nicht lieferte (zählten 0 im Deckel). */
      unmeasured?: number;
      /** Auch nach dem Löschen aller erlaubten Stände über `maxTotalBytes`. */
      overCap?: true;
      /** In den neuen Baum überführte Dateien aus dem Altbestand. */
      migrated?: number;
      /** Quellpfade des Altbestands, deren Ziel schon mit ANDEREM Inhalt da war: beide bleiben liegen. */
      conflicts?: string[];
      /** Einträge direkt unter `snapshots/`, die weder `by-file` noch ein lesbarer Stempelordner sind (bleiben unberührt), und unsichere Pfade im Altbestand. */
      unreadable?: number;
      /** Der erste Fehler der Übernahme; geschrieben wurde trotzdem. */
      migrationError?: string;
    }
  | { ok: false; message: string };

export const DEFAULT_MAX_PER_FILE = 50;
/** 185 statt der 183 Tage des Monatsfensters (6 Monate): das längste Monatsfenster ist 183 Tage und einen Tag lang, dazu eine Stunde Sommerzeit; 185 schneidet die Vorgabe nie an. */
export const DEFAULT_MAX_AGE_DAYS = 185;
export const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const DAY_MS = 86_400_000;
const FULL_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const LEAF_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(\..*)?$/;
const STAT_BATCH = 32;

/** Ein Vault-Pfad, der sicher unter den Schnappschuss-Ordner passt: relativ, mit `/`, ohne leere, `.`- oder `..`-Teile. */
function isSafeVaultPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function isValidLimit(n: unknown): boolean {
  return typeof n === "number" && !Number.isNaN(n) && n >= 0;
}

/** Die Endung des letzten Pfadteils mit Punkt (`logo.svg` → `.svg`); ein Name ohne Endung oder nur mit führendem Punkt (`.gitignore`) hat keine. */
function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** Legt `path` samt aller fehlenden Elternordner an. Seit Welle 37 (kw37c, Teil B) die code-kit-Fassung (`pure/ensure-dir`, aus dieser Datei gehoben), hier weiter ausgeliefert, weil `device-files` sie unter diesem Namen holt; `DataAdapter` erfüllt `DirStore`. */
export { ensureDir };

/** Alle Dateien unter `dir` (rekursiv), als volle Pfade. */
async function listFilesDeep(adapter: DataAdapter, dir: string): Promise<string[]> {
  const listing = await adapter.list(dir);
  const out = [...listing.files];
  for (const f of listing.folders) out.push(...(await listFilesDeep(adapter, f)));
  return out;
}

/** Zwei Puffer tragen dieselben Bytes (code-kit `bytesEqual` über Sichten, keine Kopie). */
function sameBuffers(a: ArrayBuffer, b: ArrayBuffer): boolean {
  return bytesEqual(new Uint8Array(a), new Uint8Array(b));
}

interface MigrationReport { migrated: number; conflicts: string[]; unreadable: number; error?: string }

/** Überführt den Altbestand (`snapshots/<Stempel>/<Vault-Pfad>`) in den neuen Baum. Wirft nie. */
async function migrateLegacy(adapter: DataAdapter, root: string, tree: string): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: 0, conflicts: [], unreadable: 0 };
  let top: { files: string[]; folders: string[] };
  try {
    // Der allererste Aufruf eines Plugins: `snapshots/` gibt es noch nicht, und `adapter.list` wirft auf einem fehlenden Ordner (gelesen an Obsidian 1.15.1: `FileSystemAdapter.list` ruft `readdir` ohne Fang). Kein Ordner heißt kein Altbestand, nicht „Übernahme gescheitert“.
    if (!(await adapter.exists(root))) return report;
    top = await adapter.list(root);
  } catch (error) { report.error = errorMessage(error); return report; }
  const legacy: string[] = [];
  for (const f of top.folders) {
    const name = f.slice(root.length + 1);
    if (name === "by-file") continue;
    if (FULL_STAMP_RE.test(name) && timeFromStampedName(name) !== null) legacy.push(name);
    else report.unreadable++;
  }
  report.unreadable += top.files.length;
  legacy.sort();
  for (const stamp of legacy) {
    const oldDir = `${root}/${stamp}`;
    try {
      for (const source of await listFilesDeep(adapter, oldDir)) {
        const rel = source.slice(oldDir.length + 1);
        if (!isSafeVaultPath(rel)) { report.unreadable++; continue; }
        try {
          const target = `${tree}/${rel}/${stamp}${extOf(rel)}`;
          if (await adapter.exists(target)) {
            if (sameBuffers(await adapter.readBinary(source), await adapter.readBinary(target))) await adapter.remove(source);
            else report.conflicts.push(source);
            continue;
          }
          await ensureDir(adapter, target.slice(0, target.lastIndexOf("/")));
          await adapter.writeBinary(target, await adapter.readBinary(source));
          if (!sameBuffers(await adapter.readBinary(source), await adapter.readBinary(target))) {
            await adapter.remove(target).catch(() => undefined);
            report.error ??= `copy of ${source} did not read back identically`;
            continue;
          }
          await adapter.remove(source);
          report.migrated++;
        } catch (error) {
          report.error ??= `${source}: ${errorMessage(error)}`;
        }
      }
      if ((await listFilesDeep(adapter, oldDir)).length === 0) await adapter.rmdir(oldDir, true);
    } catch (error) {
      report.error ??= `${oldDir}: ${errorMessage(error)}`;
    }
  }
  return report;
}

/** Die Normalform, in der Pfade verglichen werden. `adapter.list` liefert Namen und Präfix auf dem iPhone immer in NFC, auch bei einem NFD-Ordner (gemessen 2026-11-15); ein Pfad, den der Aufrufer in NFD übergibt, wäre mit `===` nie gleich.
 *  Geschrieben und gelöscht wird weiter unter dem Pfad, wie er vorliegt (keine Umbenennung bestehender Stände); NFC ist nur der Schlüssel zum Vergleichen und Gruppieren. */
const nfc = (p: string): string => p.normalize("NFC");

/** `dir` ist der Ordner, wie die Platte ihn führt (so, wie `list` ihn nannte): für `exists` und `remove`. `group` ist derselbe Ordner in NFC: der Schlüssel der Datei. */
interface Stand { name: string; path: string; time: number; group: string; dir: string; size: number }

/** Alle Stände unter `tree`, nach Datei-Ordner gruppiert (Schlüssel: der Ordnerpfad, dessen Rest hinter `tree/` der Vault-Pfad ist). */
async function readGroups(adapter: DataAdapter, tree: string): Promise<Map<string, Stand[]>> {
  const groups = new Map<string, Stand[]>();
  for (const path of await listFilesDeep(adapter, tree)) {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    if (!LEAF_STAMP_RE.test(name)) continue;
    const time = timeFromStampedName(name);
    if (time === null) continue;
    const dir = path.slice(0, slash);
    const group = nfc(dir);   // NFC und NFD desselben Ordners sind dieselbe Datei
    const list = groups.get(group) ?? [];
    list.push({ name, path, time, group, dir, size: 0 });
    groups.set(group, list);
  }
  return groups;
}

/** Sichert `content` (den Stand VOR dem Überschreiben) von `path` und bewahrt die Stände je Datei auf (Staffelung, `maxAgeDays`, `maxPerFile`) mit Gesamtdeckel `maxTotalBytes`; überführt vorher den Altbestand. Wirft nie. */
export async function snapshotFile(
  app: App,
  o: { pluginId: string; path: string; content: string; policy?: GfsPolicy; calendar?: GfsCalendar; now?: Date } & SnapshotLimits,
): Promise<SnapshotResult> {
  if (!isValidPluginId(o.pluginId)) return { ok: false, message: `not a safe plugin id: ${JSON.stringify(o.pluginId)}` };
  if (!isSafeVaultPath(o.path)) return { ok: false, message: `not a safe vault path: ${JSON.stringify(o.path)}` };
  const maxPerFile = o.maxPerFile ?? DEFAULT_MAX_PER_FILE;
  const maxAgeDays = o.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const maxTotalBytes = o.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  for (const [name, value] of [["maxPerFile", maxPerFile], ["maxAgeDays", maxAgeDays], ["maxTotalBytes", maxTotalBytes]] as const) {
    if (!isValidLimit(value)) return { ok: false, message: `not a valid limit ${name}: ${String(value)}` };
  }
  const adapter = app.vault.adapter;
  const root = `${app.vault.configDir}/plugins/${o.pluginId}/snapshots`;
  const tree = `${root}/by-file`;

  // 1. Altbestand überführen: für sich sicher, scheitert er, wird trotzdem geschrieben.
  const migration = await migrateLegacy(adapter, root, tree);

  // 2. Schreiben; scheitert es, wird nichts gelöscht.
  let snapshotPath = "";
  let ownName = "";
  let ownTime = 0;
  const ext = extOf(o.path);
  const fileDir = `${tree}/${o.path}`;
  const ownGroup = nfc(fileDir);   // der Schlüssel der eigenen Datei in `readGroups`
  try {
    let time = (o.now ?? new Date()).getTime();
    ownName = stampedName(time, { suffix: ext });
    snapshotPath = `${fileDir}/${ownName}`;
    // Derselbe Moment, dieselbe Datei: eine Millisekunde weiter, nie überschreiben.
    for (let tries = 0; tries < 1000 && (await adapter.exists(snapshotPath)); tries++) {
      time += 1;
      ownName = stampedName(time, { suffix: ext });
      snapshotPath = `${fileDir}/${ownName}`;
    }
    await ensureDir(adapter, fileDir);
    await adapter.write(snapshotPath, o.content);
    ownTime = time;
  } catch (error) {
    return { ok: false, message: `could not write the snapshot${snapshotPath ? ` ${snapshotPath}` : ""}: ${errorMessage(error)}` };
  }

  const isOwnStand = (path: string): boolean => nfc(path) === nfc(snapshotPath);

  // 3. Aufbewahrung je Datei und Gesamtdeckel. Ein Fehler hier macht den Schnappschuss nicht ungültig (er liegt da); überzählige räumt der nächste Aufruf.
  let dropped = 0;
  let unmeasured = 0;
  let overCap = false;
  try {
    const groups = await readGroups(adapter, tree);
    const doomed = new Set<string>();   // Pfade, die fallen
    const kept = new Map<string, Stand[]>();   // je Gruppe, was nach den drei Stufen bleibt (ohne die Zukunft)
    const future = new Map<string, Stand[]>();
    for (const [group, stands] of groups) {
      const isOwn = group === ownGroup;
      const sel = selectGfsRetention(stands.map((s) => ({ name: s.name, time: s.time })), ownTime, {
        policy: o.policy, calendar: o.calendar, protect: isOwn ? [ownName] : [],
      });
      const dropByStaffel = new Set(sel.drop);
      const byName = new Map(stands.map((s) => [s.name, s]));
      for (const name of dropByStaffel) { const s = byName.get(name); if (s) doomed.add(s.path); }
      const survivors: Stand[] = [];
      const later: Stand[] = [];
      for (const k of sel.keep) {
        const s = byName.get(k.name);
        if (!s) continue;
        if (k.bucket === "future") later.push(s); else survivors.push(s);
      }
      // Stufe 2: Alter, vom Zeitpunkt now aus. Der eben geschriebene Stand hat das Alter 0 und fällt hier nie (maxAgeDays ist nicht negativ).
      const ageMs = maxAgeDays * DAY_MS;
      const young: Stand[] = [];
      for (const s of survivors) {
        if (ownTime - s.time > ageMs) doomed.add(s.path); else young.push(s);
      }
      // Stufe 3: Anzahl, die ältesten zuerst. Der eben geschriebene Stand zählt mit, fällt aber nie (er bleibt in `rest`, damit der Deckel ihn mitzählt).
      young.sort((a, b) => a.time - b.time || (a.name < b.name ? -1 : 1));
      let over = young.length - maxPerFile;
      const rest: Stand[] = [];
      for (const s of young) {
        if (over > 0 && !isOwnStand(s.path)) { doomed.add(s.path); over--; } else rest.push(s);
      }
      kept.set(group, rest);
      future.set(group, later);
    }

    // Gesamtdeckel über das, was nach den drei Stufen bleibt.
    if (Number.isFinite(maxTotalBytes)) {
      const all: Stand[] = [];
      for (const [group, rest] of kept) all.push(...rest, ...(future.get(group) ?? []));
      const ownBytes = new TextEncoder().encode(o.content).length;
      const toMeasure = all.filter((s) => !isOwnStand(s.path));
      for (let i = 0; i < toMeasure.length; i += STAT_BATCH) {
        await Promise.all(toMeasure.slice(i, i + STAT_BATCH).map(async (s) => {
          try {
            const st = await adapter.stat(s.path);
            if (st && typeof st.size === "number") s.size = st.size; else unmeasured++;
          } catch { unmeasured++; }
        }));
      }
      for (const s of all) if (isOwnStand(s.path)) s.size = ownBytes;
      let total = all.reduce((sum, s) => sum + s.size, 0);
      if (total > maxTotalBytes) {
        // Rang 1: verwaiste Dateien; Rang 2: nicht der neueste einer lebenden Datei; Rang 3: der neueste einer lebenden Datei. Der eigene Stand nie, die Zukunft nicht.
        const orphan = new Map<string, boolean>();
        for (const group of kept.keys()) {
          if (group === ownGroup) { orphan.set(group, false); continue; }
          let exists = true;
          // Unter dem Namen fragen, wie die Platte den Ordner führt (`dir`), nicht unter dem NFC-Schlüssel: eine Platte, die die Normalformen unterscheidet, kennt die Datei nur unter ihrer eigenen.
          const dir = kept.get(group)?.[0]?.dir ?? future.get(group)?.[0]?.dir ?? group;
          try { exists = await adapter.exists(dir.slice(tree.length + 1)); } catch { exists = true; }
          orphan.set(group, !exists);
        }
        const ranked: { s: Stand; rank: number }[] = [];
        for (const [group, rest] of kept) {
          const newest = rest.reduce((m, s) => Math.max(m, s.time), -Infinity);
          for (const s of rest) {
            if (isOwnStand(s.path)) continue;
            const rank = orphan.get(group) ? 1 : s.time < newest ? 2 : 3;
            ranked.push({ s, rank });
          }
        }
        ranked.sort((a, b) => a.rank - b.rank || a.s.time - b.s.time || (a.s.path < b.s.path ? -1 : 1));
        for (const { s } of ranked) {
          if (total <= maxTotalBytes) break;
          doomed.add(s.path);
          total -= s.size;
        }
        if (total > maxTotalBytes) overCap = true;
      }
    }

    // Löschen: zuerst die Dateien, dann leere Ordner.
    const emptied = new Set<string>();
    for (const path of doomed) {
      try { await adapter.remove(path); dropped++; emptied.add(path.slice(0, path.lastIndexOf("/"))); } catch { /* der nächste Aufruf räumt */ }
    }
    for (let dir of emptied) {
      while (dir.length > tree.length) {
        try {
          const l = await adapter.list(dir);
          if (l.files.length > 0 || l.folders.length > 0) break;
          await adapter.rmdir(dir, false);
        } catch { break; }
        dir = dir.slice(0, dir.lastIndexOf("/"));
      }
    }
  } catch {
    // Der Schnappschuss liegt da; überzählige Ordner räumt der nächste Lauf.
  }

  const result: SnapshotResult = { ok: true, snapshotPath };
  if (dropped > 0) result.dropped = dropped;
  if (unmeasured > 0) result.unmeasured = unmeasured;
  if (overCap) result.overCap = true;
  if (migration.migrated > 0) result.migrated = migration.migrated;
  if (migration.conflicts.length > 0) result.conflicts = migration.conflicts;
  if (migration.unreadable > 0) result.unreadable = migration.unreadable;
  if (migration.error !== undefined) result.migrationError = migration.error;
  return result;
}
