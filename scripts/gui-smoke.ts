/**
 * GUI-Smoke — faehrt die Pruefpunkte aus docs/SMOKE.md gegen ein LAUFENDES Obsidian (CORE-TEST-02 b).
 *
 * Der Lauf misst zwei Haelften: A/B ohne Modell (Panel, Quellen, Guards) und C mit Modell
 * (Stream + Ausgaenge). C wird UEBERSPRUNGEN und benannt, wenn auf :1234 kein Endpunkt
 * antwortet — nie still gruen (CORE-TEST-19).
 *
 * ## Zweitinstanz (der richtige Ort fuer diesen Lauf — eigenes Profil, eigener Port)
 *
 *   echo "$STAGING_VAULTS_DIR"                                         # muss gesetzt sein (~/.zshenv)
 *   npm run build && npm run smoke:gui -- --setup                      # Vault aus fixtures/vault/
 *   UD=/tmp/obs-test-lingotuner; mkdir -p "$UD"
 *   lsof -nP -iTCP:9341 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"
 *   # Vault registrieren (Obsidian liest obsidian.json nur beim Start):
 *   node -e 'const p=process.env.STAGING_VAULTS_DIR+"/lingotuner";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{lingotuner:{path:p,ts:Date.now(),open:true}}}))' "$UD"
 *   cp ~/Library/Application\ Support/obsidian/obsidian-1.14.0.asar "$UD"/   # aktuelle Version statt gebuendelter
 *   /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9341 &
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label lingotuner --intent "GUI-Smoke Zweitinstanz :9341" --exclusive focus --ttl 300
 *   npm run smoke:gui -- --port 9341
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 *
 * Der `cp` der `.asar` ist keine Kuer: ein frisches Profil startet mit der GEBUENDELTEN
 * Obsidian-Version, und die Versionsnummer im Dateinamen ist der Stand des REGULAEREN
 * Profils — sie gehoert vor dem Kopieren nachgesehen (`ls ~/Library/Application\ Support/obsidian/*.asar`),
 * sonst laeuft ein `|| true` still ins Leere.
 *
 * Der Lock ist die Eintrittskarte des Guards (auch fuer die Zweitinstanz); `release` gehoert
 * direkt hinter den Lauf. Die regulaere Instanz auf 9222 wird nicht angefasst — beendet wird
 * die Zweitinstanz ueber ihre PID, nie ueber `pkill`/`killall`/`quit app`.
 *
 * Gemessen wird im eigenen Staging-Vault (`$STAGING_VAULTS_DIR/lingotuner`, aufgeloest ueber
 * `stagingVaultDir()`), nie im Arbeits-Vault. Wo dieses Verzeichnis liegt, sagt die Umgebung —
 * hier steht nur die Variable, nie ihr Wert (CORE-META-14; ein Beispielwert in der Doku ist ein
 * zweiter Ort und gabelt die Konvention). Der Ort selbst: obsidian-plugins/AGENTS.md
 * § Staging-Vaults.
 *
 * Typen: `tsconfig.scripts.json` (im `gate` ueber `npm run typecheck:scripts`).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { cwd } from "node:process";

import { Cdp, attachTo, clickReal, closeExtraLeaves, notices, pollUntil, requireVisible, setPluginSetting } from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "lingotuner";
const PLUGIN_ID = "lingotuner";
const VIEW_TYPE = "lingotuner-panel";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "fixtures/vault");
const NOTE = "Mail-Entwurf.md";
const ENDPOINT = "http://127.0.0.1:1234";
const LOGBOOK_FOLDER = "LingoTuner";
// Task 5 (Pilot LLM Endpoint Manager): der Manager-Abschnitt (M1-M3) ist optional und
// braucht weder das echte Manager-Plugin noch einen echten LLM-Server — Muster aus
// llm-endpoint-manager/scripts/gui-smoke.ts (Fake-HTTP-Server, koda-agent-Herkunft) und
// obsidian-kit/src/pure/endpoint-source.ts (LlmEndpointManagerApi-Form).
const MANAGER_PLUGIN_ID = "llm-endpoint-manager";
const LAB_PLUGIN_ID = "llm-lab";
const MANAGER_DEFAULT_MODEL = "smoke-manager-model";
// M3-Nacharbeit (Fix-Runde, 2026-09-15): der lokale Fallback-Teil von M3 braucht einen ZWEITEN
// Fake-Server, unabhaengig vom Manager-Fake — sonst haengt M3 an einem echten LM-Studio-Server
// auf :1234 (Umgebungssache, siehe C1) und ist bei fehlendem Modell dort "uebersprungen" statt
// tatsaechlich geprueft. Eigener Modellname, damit ein Log eindeutig zeigt, welcher der beiden
// Fake-Server eine Anfrage sah.
const LOCAL_FALLBACK_MODEL = "smoke-local-model";

type Zustand = "gruen" | "rot" | "uebersprungen";
interface Check { name: string; zustand: Zustand; detail: string }
const checks: Check[] = [];
function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, zustand: passed ? "gruen" : "rot", detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name} — ${detail}`);
}
function skipped(name: string, reason: string): void {
  checks.push({ name, zustand: "uebersprungen", detail: reason });
  console.log(`  · ${name} — übersprungen: ${reason}`);
}

const q = (s: string): string => JSON.stringify(s);

/** Vorwert der Regler, damit main() ihn im finally zurueckschreibt — der Lauf soll die
 *  Einstellungen des Wirts nicht behalten. `null` = noch nicht gelesen. */
let vorherigeDials: unknown = null;

/** Ergebnisse immer als Objekt: CDP kann null nicht von undefined unterscheiden. */
async function count(cdp: Cdp, selector: string): Promise<number> {
  return (await cdp.evaluate<{ n: number }>(`return { n: document.querySelectorAll(${q(selector)}).length };`)).n;
}
async function text(cdp: Cdp, selector: string): Promise<string | null> {
  return (await cdp.evaluate<{ t: string | null }>(`const el = document.querySelector(${q(selector)}); return { t: el ? el.textContent.trim() : null };`)).t;
}
async function disabled(cdp: Cdp, selector: string): Promise<boolean | null> {
  return (await cdp.evaluate<{ d: boolean | null }>(`const el = document.querySelector(${q(selector)}); return { d: el ? el.disabled : null };`)).d;
}
async function hasClass(cdp: Cdp, selector: string, cls: string): Promise<boolean> {
  return (await cdp.evaluate<{ h: boolean }>(`const el = document.querySelector(${q(selector)}); return { h: !!el && el.classList.contains(${q(cls)}) };`)).h;
}

function setupVault(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Staging-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
  // `buildVault` entfernt data.json absichtlich (Auslieferungszustand). Der Lauf soll aber
  // gegen einen BENANNTEN Endpunkt fahren und nicht gegen einen Default, der sich aendern
  // kann — deshalb wird die Fixture-Fassung danach hineingelegt.
  const quelle = join(FIXTURE_DIR, "plugin-data.json");
  if (existsSync(quelle)) {
    copyFileSync(quelle, join(vaultDir, ".obsidian", "plugins", PLUGIN_ID, "data.json"));
    console.log("  · Plugin-Einstellungen aus fixtures/vault/plugin-data.json gesetzt");
  }
  deployLab(vaultDir);
  console.log("\nDen Vault in der Zweitinstanz registrieren (Rezept im Dateikopf) und dann:");
  console.log("  npm run smoke:gui -- --port 9341");
}

/** Optional: llm-lab (Geschwister-Repo im Dach) in den Staging-Vault legen, damit Abschnitt L die
 *  Aufzeichnung messen kann. Fehlt ../llm-lab/main.js, bleibt L "uebersprungen" — nie still gruen. */
function deployLab(vaultDir: string): void {
  const quelle = join(REPO_ROOT, "..", "llm-lab");
  if (!existsSync(join(quelle, "main.js"))) { console.log("  · llm-lab nicht gebaut (../llm-lab/main.js fehlt) — Abschnitt L wird uebersprungen"); return; }
  const ziel = join(vaultDir, ".obsidian", "plugins", LAB_PLUGIN_ID);
  mkdirSync(ziel, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) if (existsSync(join(quelle, f))) copyFileSync(join(quelle, f), join(ziel, f));
  const listeDatei = join(vaultDir, ".obsidian", "community-plugins.json");
  const liste = existsSync(listeDatei) ? (JSON.parse(readFileSync(listeDatei, "utf8")) as string[]) : [];
  if (!liste.includes(LAB_PLUGIN_ID)) liste.push(LAB_PLUGIN_ID);
  writeFileSync(listeDatei, JSON.stringify(liste, null, 2));
  console.log("  · llm-lab als zweites Plugin deployt (Abschnitt L)");
}

async function endpointReachable(): Promise<boolean> {
  return (await modelle()).length > 0;
}

/** Die Modell-Ids des Endpunkts. Leer = nicht erreichbar oder keine geladen. */
async function modelle(): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${ENDPOINT}/v1/models`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: Array<{ id?: string }> };
    return (j.data ?? []).map((m) => m.id ?? "").filter((id) => id !== "");
  } catch { return []; }
}

/** Einen Quellen-Chip waehlen und BELEGEN, dass er aktiv wurde.
 *
 *  Der erste Klick nach dem Oeffnen des Panels geht regelmaessig ins Leere: `clickReal`
 *  misst die Bildschirmkoordinate vor dem Klick, und die rechte Sidebar bewegt sich zu
 *  diesem Zeitpunkt noch (revealLeaf animiert). Der Klick landet dann neben dem Chip, die
 *  Quelle bleibt auf "Markierung" stehen — und der nachfolgende Pruefpunkt liest das als
 *  „Zeile bleibt blockiert", also als Plugin-Defekt. Gemessen 2026-09-07 im ersten Lauf
 *  gegen die Zweitinstanz: B4 und B6 rot, unmittelbar danach aus gesetztem Layout gruen.
 *
 *  Wiederholt wird deshalb die MUTATION, nicht die Aussage: gelingt der Klick auch nach
 *  drei Versuchen nicht, ist das ein Befund und wird als solcher gemeldet. Die Zahl der
 *  Versuche steht im Detailtext, damit ein „ging erst beim dritten Mal" nicht unsichtbar
 *  bleibt. */
async function waehleQuelle(cdp: Cdp, index: number): Promise<string> {
  for (let versuch = 1; versuch <= 3; versuch += 1) {
    await clickReal(cdp, `document.querySelectorAll(".lt-source-chip")[${index}]`);
    const aktiv = await pollUntil<{ ok: boolean }>(
      cdp,
      `const b = document.querySelectorAll(".lt-source-chip")[${index}]; return b && b.classList.contains("is-active") ? { ok: true } : null;`,
      2000,
      200,
    );
    if (aktiv !== null) return versuch === 1 ? "" : ` (Chip erst im ${versuch}. Anlauf aktiv)`;
  }
  return " (Chip wurde nach 3 Klicks NICHT aktiv)";
}

/** Ausgangszustand herstellen: Layout leer, Regler neutral.
 *
 *  Beides ueberlebt sonst den Lauf. `lastDials` wird bei jeder Reglerbewegung nach
 *  data.json gespeichert — B5 („alle Regler 0 sperren Tunen") misst beim ZWEITEN Lauf
 *  also den Rest des ersten und ist rot, ohne dass sich am Plugin etwas geaendert haette.
 *  Das Fixture setzt den Startwert, aber nur beim `--setup`; eine laufende Instanz haelt
 *  ihre Einstellungen im Speicher und schreibt sie darueber. Rueckgabe ist der Vorwert,
 *  den main() im finally zurueckschreibt. */
async function setzeAusgangszustand(cdp: Cdp): Promise<unknown> {
  const vorher = await cdp.evaluate<unknown>(`return { d: app.plugins.plugins[${q(PLUGIN_ID)}].settings.lastDials };`);
  await cdp.evaluate(`
    app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
    app.workspace.detachLeavesOfType("markdown");
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  `);
  await setPluginSetting(cdp, PLUGIN_ID, "lastDials", { directness: 0, context: 0, social: 0, semantics: 0 });
  return (vorher as { d: unknown }).d;
}

async function pruefeGrundlage(cdp: Cdp, vaultName: string): Promise<void> {
  console.log("\nA · Grundlage");
  let geladen = (await cdp.evaluate<{ g: boolean }>(`return { g: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]) };`)).g;
  let frei = "";
  if (!geladen && vaultName === REPO_NAME) {
    // Frisches Profil = Restricted Mode: jede Einzelpruefung gibt Entwarnung, nur plugins ist leer.
    frei = (await cdp.evaluate<{ s: string }>(`
      try {
        if (app.plugins.setEnable) await app.plugins.setEnable(true);
        await app.plugins.enablePluginAndSave(${q(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 1200));
        return { s: app.plugins.plugins[${q(PLUGIN_ID)}] ? "freigeschaltet" : "Aufruf ohne Wirkung" };
      } catch (e) { return { s: "Fehler: " + (e && e.message ? e.message : String(e)) }; }
    `)).s;
    geladen = (await cdp.evaluate<{ g: boolean }>(`return { g: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]) };`)).g;
  }
  record("A1 Plugin geladen", geladen, geladen ? `Vault ${vaultName}${frei ? ` (${frei})` : ""}` : `app.plugins.plugins.${PLUGIN_ID} fehlt — ${frei || "kein Freischaltversuch (fremder Vault)"}`);
  if (!geladen) throw new Error("Ohne geladenes Plugin ist jeder weitere Punkt gegenstandslos.");

  const cmds = (await cdp.evaluate<{ c: string[] }>(`return { c: ["open-panel","tune-selection"].filter((id) => Boolean(app.commands.commands[${q(PLUGIN_ID)} + ":" + id])) };`)).c;
  record("A2 Befehle registriert", cmds.length === 2, cmds.join(", ") || "keiner");

  vorherigeDials = await setzeAusgangszustand(cdp);
  await cdp.evaluate(`app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-panel`)}); return { ok: true };`);
  const panel = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".lt-panel") ? { ok: true } : null;`, 10_000, 300);
  record("A3 Panel oeffnet", panel !== null, panel !== null ? "Leaf mit .lt-panel" : `kein .lt-panel; Leaves: ${(await cdp.evaluate<{ n: number }>(`return { n: app.workspace.getLeavesOfType(${q(VIEW_TYPE)}).length };`)).n}`);
}

/** B10, Schritt 1: die MUTATION. Fokus setzen, tippen, den Ausloeser feuern — mehr nicht.
 *  Getrennt von der Messung, weil im selben `evaluate` vor dem Redraw gemessen wuerde
 *  (Debounce 150 ms in `main.ts`). Form aus dem Skill `gui-smoke-setup` § 3a (a). */
async function tippeInsTextfeld(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const el = document.querySelector(".lt-freetext");
    if (!el) return { ok: false };
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.setSelectionRange(0, 0);
    document.execCommand("insertText", false, "abc");
    // Der Ausloeser aus dem Anlassfall — im Wirt feuert ihn jede Cursorbewegung selbst.
    document.dispatchEvent(new Event("selectionchange"));
    return { ok: true };
  `);
}

/** B10, Schritt 2: die WARTEPHASE auf der Node-Seite.
 *
 *  ⚠️ Gepollt wird auf den NEGATIVEN Zustand, nicht auf den positiven — und das ist der
 *  Unterschied zwischen einem Pruefpunkt und einer Behauptung. Ein `pollUntil` auf
 *  „Fokus liegt im Feld" kehrt beim ERSTEN Versuch zurueck, also vor dem Debounce; es
 *  waere auch gegen die kaputte Fassung gruen, weil der Fokus dort erst nach ~150 ms
 *  wegfaellt. Gemessen wird deshalb ein FENSTER: faellt der Fokus in 1200 ms nicht weg,
 *  hat er den Anstrich ueberlebt. `null` = ueberlebt. */
async function messeFokus(cdp: Cdp): Promise<[boolean, string]> {
  const verloren = await pollUntil<{ aktiv: string }>(cdp, `
    const a = document.activeElement;
    if (a && a.matches(".lt-freetext")) return null;
    return { aktiv: a ? (a.className || a.tagName) : "(null)" };
  `, 1200, 100);
  const stand = await cdp.evaluate<{ wert: string; aktiv: string }>(`
    const el = document.querySelector(".lt-freetext");
    const a = document.activeElement;
    return { wert: el ? el.value : "(keine Textarea)", aktiv: a ? (a.className || a.tagName) : "(null)" };
  `);
  const gehalten = verloren === null && stand.aktiv.split(" ").includes("lt-freetext");
  const detail = gehalten
    ? `value=${JSON.stringify(stand.wert)}, Fokus blieb 1200 ms in .lt-freetext`
    : `value=${JSON.stringify(stand.wert)}, Fokus fiel auf ${JSON.stringify((verloren?.aktiv ?? stand.aktiv).slice(0, 60))}`;
  return [gehalten && stand.wert === "abc", detail];
}

async function pruefePanel(cdp: Cdp): Promise<void> {
  console.log("\nB · Panel ohne Modell");
  record("B1 drei Quellen-Chips", (await count(cdp, ".lt-source-chip")) === 3, `${await count(cdp, ".lt-source-chip")} Chips`);
  record("B2 vier Regler", (await count(cdp, ".lt-dial-input")) === 4, `${await count(cdp, ".lt-dial-input")} range-Inputs`);
  record("B3 vier Preset-Chips", (await count(cdp, ".lt-preset-chip")) === 4, `${await count(cdp, ".lt-preset-chip")} Chips`);

  // Notiz oeffnen, Quelle "Aktive Notiz" waehlen → Bereitschaftszeile traegt die Zeichenzahl.
  await cdp.evaluate(`await app.workspace.getLeaf(true).openFile(app.vault.getAbstractFileByPath(${q(NOTE)})); return { ok: true };`);
  await cdp.evaluate(`app.workspace.trigger("active-leaf-change"); return { ok: true };`);
  const klick4 = await waehleQuelle(cdp, 1);
  const line = await pollUntil<{ t: string }>(cdp, `const el = document.querySelector(".lt-source-line"); return el && !el.classList.contains("is-blocked") ? { t: el.textContent } : null;`, 5000, 250);
  record("B4 Notiz als Quelle erkannt", line !== null && /\d+/.test(line.t), `${line?.t ?? "Zeile bleibt blockiert"}${klick4}`);

  // Noop: alle Regler 0 + keine Anmerkung → Tunen aus; Regler bewegen → an.
  record("B5 Noop sperrt Tunen", (await disabled(cdp, ".lt-run")) === true, `disabled=${await disabled(cdp, ".lt-run")}`);
  await cdp.evaluate(`const i = document.querySelectorAll(".lt-dial-input")[2]; i.value = "2"; i.dispatchEvent(new Event("input", { bubbles: true })); return { ok: true };`);
  const enabled = await pollUntil<{ ok: boolean }>(cdp, `const b = document.querySelector(".lt-run"); return b && !b.disabled ? { ok: true } : null;`, 3000, 200);
  record("B6 Regler gibt Tunen frei", enabled !== null, enabled !== null ? "social=+2 → Tunen aktiv" : "Knopf bleibt aus");
  // Gemessen wird der TEXT, nicht die Existenz: der Marker ist seit dem Fokus-Fix ein fester
  // Platzhalter im DOM (ein Reglerzug schaltet ihn um, ohne die Zeile neu zu bauen — sonst
  // zoege er den gegriffenen Regler unter dem Zeiger weg). Eine Zaehlung waere seitdem immer 1
  // und damit ein Pruefpunkt, der nichts mehr misst.
  const marker = (await text(cdp, ".lt-preset-custom")) ?? "";
  record("B7 Preset zeigt (angepasst)", (await count(cdp, ".lt-preset-custom")) === 1 && marker !== "", `Marker-Text ${JSON.stringify(marker)}`);

  const klick8 = await waehleQuelle(cdp, 2);
  const ta = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".lt-freetext") ? { ok: true } : null;`, 3000, 200);
  record("B8 Textfeld-Quelle zeigt Textarea", ta !== null, `${ta !== null ? ".lt-freetext da" : "fehlt"}${klick8}`);

  // B10 — Pflicht-Punkt (a) aus dem Skill `gui-smoke-setup` § 3a, Anlassfall war genau
  // dieses Plugin: ein `selectionchange`-Handler loeste ein Voll-Neuzeichnen aus, die
  // Textarea wurde als DOM-Knoten ersetzt, der Fokus fiel auf `<body>` — der Nutzer verlor
  // bei jedem Tastendruck den Cursor.
  if (ta === null) {
    skipped("B10 Tippen ins Textfeld behaelt den Fokus", "ohne .lt-freetext (B8 rot) ist der Punkt gegenstandslos");
  } else {
    await tippeInsTextfeld(cdp);
    record("B10 Tippen ins Textfeld behaelt den Fokus", ...(await messeFokus(cdp)));
    await cdp.evaluate(`
      const ta = document.querySelector(".lt-freetext");
      if (ta) { ta.value = ""; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.blur(); }
      return { ok: true };
    `);
  }

  // Lesemodus blockiert Markierung/Notiz.
  await waehleQuelle(cdp, 1);
  await cdp.evaluate(`const v = app.workspace.getLeavesOfType("markdown")[0].view; await v.setState({ ...v.getState(), mode: "preview" }, { history: false }); app.workspace.trigger("active-leaf-change"); return { ok: true };`);
  const blocked = await pollUntil<{ ok: boolean }>(cdp, `const el = document.querySelector(".lt-source-line"); return el && el.classList.contains("is-blocked") ? { ok: true } : null;`, 5000, 250);
  record("B9 Lesemodus blockiert die Quelle", blocked !== null, blocked !== null ? "is-blocked gesetzt" : (await text(cdp, ".lt-source-line")) ?? "keine Zeile");
  await cdp.evaluate(`const v = app.workspace.getLeavesOfType("markdown")[0].view; await v.setState({ ...v.getState(), mode: "source" }, { history: false }); app.workspace.trigger("active-leaf-change"); return { ok: true };`);
}

/** C11 — folgt das PANEL dem Strom?
 *
 *  Seit 2026-09-11 rollt nicht mehr der Antwort-Body, sondern das Panel als Ganzes; das Kit
 *  scrollt ueber `scrollEl` nach, aber nur, wenn der Leser ohnehin unten steht (Schwelle
 *  `followThreshold`, Default 40 px). Die Schwelle misst den Abstand der SCROLL-KANTE, und
 *  unter dem Stream-Bereich stehen jetzt noch Verlauf und Ausgangsknoepfe — der Verdacht war,
 *  dass ihre Hoehe die Schwelle regelmaessig ueberschreitet und das Folgen deshalb ausbleibt.
 *
 *  Gemessen wird waehrend eines echten Laufs, alle 300 ms: steht der untere Rand des
 *  laufenden Absatzes noch im Sichtfenster des Panels, und wie gross ist dabei `rest`
 *  (`scrollHeight - scrollTop - clientHeight`)? Die Zahlen gehen in den Bericht; die
 *  Kit-Session leitet daraus ab, ob `followTail` kuenftig gegen `rootEl` messen soll. */
interface FolgeMessung {
  fertig: boolean; werte: number[]; sichtbar: number; gesamt: number; unten: number;
  /** Scroll-Stand NACH einem kuenstlichen Hochscrollen mitten im Strom (C11b). Leer, wenn
   *  der Lauf vorher endete — dann ist die zweite Haelfte schlicht nicht gemessen. */
  nachStoerung: number[];
}

/** Messtakt von C11/C11b. 300 ms waren zu grob: die Antwort auf die Fixture-Notiz ist unter
 *  einer Sekunde fertig, C11b fiel deshalb zweimal als „nicht messbar" aus. Der Takt bestimmt
 *  die Aufloesung, nicht die Aussage. */
const TAKT_MS = 150;

/** `stoereBei` ist die Zahl der Messungen VOR dem kuenstlichen Hochscrollen. Sie stand auf 3,
 *  und am 2026-09-11 fiel C11b deshalb aus: die Antwort war nach drei Messungen fertig, die
 *  Stoerung kam nie. 2 misst frueher, nicht anders — mehr Spielraum gibt ein Lauf von unter
 *  zwei Sekunden nicht her. */
async function laufeMitFolgeMessung(cdp: Cdp, maxMs: number, stoereBei = 2): Promise<FolgeMessung> {
  const werte: number[] = [];
  const nachStoerung: number[] = [];
  let sichtbar = 0;
  let gesamt = 0;
  let unten = 0;
  let gestoert = false;
  const bis = Date.now() + maxMs;
  for (;;) {
    const m = await cdp.evaluate<{ fertig: boolean; hat: boolean; rest: number; tailSichtbar: boolean; unten: number; scrollTop: number }>(`
      const s = document.querySelector(".lt-status");
      const p = document.querySelector(".lt-panel");
      const area = document.querySelector(".okit-stream");
      const tail = document.querySelector(".okit-stream-tail");
      const fertig = !!s && (s.classList.contains("is-ok") || s.classList.contains("is-error"));
      if (!p || !tail || !area) return { fertig, hat: false, rest: 0, tailSichtbar: false, unten: 0, scrollTop: 0 };
      const pr = p.getBoundingClientRect();
      const tr = tail.getBoundingClientRect();
      const ar = area.getBoundingClientRect();
      // Alles, was im Panel HINTER dem Stream-Bereich steht (Verlauf, Ausgangsknoepfe) —
      // genau der Betrag, um den die Scroll-Kante weiter weg ist als das Textende.
      const unten = Math.max(0, Math.round(p.scrollHeight - (ar.bottom - pr.top + p.scrollTop)));
      return {
        fertig,
        hat: tr.height > 0 || tail.textContent.length > 0,
        rest: Math.round(p.scrollHeight - p.scrollTop - p.clientHeight),
        tailSichtbar: tr.bottom <= pr.bottom + 1,
        unten,
        scrollTop: Math.round(p.scrollTop),
      };
    `);
    if (m.hat) {
      gesamt += 1;
      unten = m.unten;
      if (gestoert) nachStoerung.push(m.scrollTop);
      else {
        werte.push(m.rest);
        if (m.tailSichtbar) sichtbar += 1;
      }
    }
    if (m.fertig) return { fertig: true, werte, sichtbar, gesamt, unten, nachStoerung };
    if (Date.now() > bis) return { fertig: false, werte, sichtbar, gesamt, unten, nachStoerung };
    // Die HAND DES NUTZERS, kuenstlich: mitten im Strom nach oben scrollen. Das Kit darf
    // danach nicht mehr nachziehen — sonst reisst es jeden zurueck, der den Anfang liest.
    if (!gestoert && gesamt >= stoereBei) {
      await cdp.evaluate(`const p = document.querySelector(".lt-panel"); if (p) p.scrollTop = 0; return { ok: true };`);
      gestoert = true;
    }
    await new Promise((r) => setTimeout(r, TAKT_MS));
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Einen Tune-Lauf ausloesen und auf seinen Endzustand warten. `false` = nicht gruen geworden. */
async function laufeTune(cdp: Cdp, waehrendDesLaufs?: () => Promise<void>): Promise<boolean> {
  await clickReal(cdp, `document.querySelector(".lt-run")`);
  if (waehrendDesLaufs) await waehrendDesLaufs();
  const done = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 120_000, 1000);
  return done !== null && (await hasClass(cdp, ".lt-status", "is-ok"));
}

/** C8 — der gemeldete Fehler 3: erscheint der Gedanken-Block WAEHREND des Streams oder erst
 *  danach?
 *
 *  Ein eigener, absichtlich ABGEBROCHENER Lauf. Der erste Entwurf hat die Messung in den
 *  zweiten Lauf gefaltet, um Zeit zu sparen — das ging schief und ist der Grund, warum es
 *  hier steht: mit eingeschaltetem Denken ueberschritt derselbe Lauf die 120-s-Grenze,
 *  `laufeTune` gab auf, und C3/C4 klickten danach auf Knoepfe, die waehrend eines laufenden
 *  Streams gesperrt sind. Zwei rote und ein uebersprungener Punkt aus einer Zeitersparnis.
 *  Sobald der Block steht, ist die Frage beantwortet — der Rest des Laufs kostet nur noch
 *  Minuten, deshalb der Abbruch. */
async function pruefeGedanken(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`app.workspace.trigger("active-leaf-change"); return { ok: true };`);
  const bereit = await pollUntil<{ ok: boolean }>(cdp, `const b = document.querySelector(".lt-run"); return b && !b.disabled ? { ok: true } : null;`, 5000, 250);
  if (bereit === null) {
    skipped("C8 Gedanken-Block waehrend des Streams", `Vorbedingung fehlt: .lt-run ist nicht bedienbar (Quelle: ${(await text(cdp, ".lt-source-line")) ?? "?"})`);
    return;
  }
  await setPluginSetting(cdp, PLUGIN_ID, "suppressThinking", false);
  await clickReal(cdp, `document.querySelector(".lt-run")`);
  const beob = await pollUntil<{ block: boolean; laenge: number }>(cdp, `
    const s = document.querySelector(".lt-status");
    const d = document.querySelector(".okit-stream-reasoning");
    if (d && s && s.classList.contains("is-checking")) return { block: true, laenge: (d.querySelector("pre") || { textContent: "" }).textContent.length };
    if (s && !s.classList.contains("is-checking")) return { block: false, laenge: 0 };
    return null;
  `, 60_000, 250);
  // Abbrechen: waehrend des Streams TRAEGT `.lt-run` die Abbrechen-Rolle.
  if (await hasClass(cdp, ".lt-status", "is-checking")) {
    await clickReal(cdp, `document.querySelector(".lt-run")`);
    await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && !s.classList.contains("is-checking") ? { ok: true } : null;`, 20_000, 500);
  }
  const danach = (await count(cdp, ".okit-stream-reasoning")) > 0;
  if (beob?.block === true) {
    record("C8 Gedanken-Block waehrend des Streams", true, `.okit-stream-reasoning stand mit ${beob.laenge} Zeichen da, waehrend .lt-status auf is-checking stand`);
  } else if (!danach) {
    // Zwei sehr verschiedene Gruende landen sonst unter derselben Ueberschrift: „das Modell
    // denkt nicht" und „der Lauf ist gescheitert, bevor ein Gedanke kommen konnte" (Netzfehler,
    // 400, Timeout). Der Beobachtungs-Poll gibt in beiden Faellen `{block:false}` zurueck.
    // Eine Modelleigenschaft zu melden, wo ein Endpunktfehler vorlag, ist genau die Sorte
    // Skip-Grund, gegen die CORE-TEST-19 steht.
    if (await hasClass(cdp, ".lt-status", "is-error")) {
      skipped("C8 Gedanken-Block waehrend des Streams", `Lauf gescheitert, bevor ein Gedanke kam: ${(await text(cdp, ".lt-status-label")) ?? "?"}`);
    } else {
      skipped("C8 Gedanken-Block waehrend des Streams", "das gewaehlte Modell lieferte keinen Gedankenstrom (kein reasoning_content) — ohne einen ist der Punkt nicht messbar");
    }
  } else {
    record("C8 Gedanken-Block waehrend des Streams", false, ".okit-stream-reasoning erschien ERST nach dem Lauf — das ist der gemeldete Fehler 3");
  }
}

/** Die Punkte, die ein Ergebnis VORAUSSETZEN — eine Liste, zwei Verwendungen (kein
 *  Endpunkt / kein Ergebnis). Zwei getrennte Listen liefen beim naechsten neuen Punkt
 *  auseinander, und ein vergessener Name faellt nirgends auf: er waere schlicht nicht im
 *  Protokoll, und „nicht gemessen" saehe aus wie „nicht noetig". */
const C_AUSGAENGE = [
  "C2 Kopieren freigegeben", "C3 Notiz ersetzen schreibt Body", "C4 Neue Notiz entsteht",
  "C6 Logbuch anlegen und anhaengen", "C7 Ersetzen-Ziel sperrt bei geaenderter Quelle",
  "C8 Gedanken-Block waehrend des Streams",
  "C9 jedes Bedienelement ist erreichbar (natuerliche Hoehe)",
  "C9b jedes Bedienelement ist erreichbar (kurzes Panel, 420 px)",
  "C9c Gegenprobe: ohne Rollbalken wird etwas unerreichbar",
  "C9d Quell-Textfeld und Regler erreichbar (Quelle Textfeld)",
  "C10 Zuruecksetzen fragt nach und raeumt",
];
// B11 haengt am ERSTEN Lauf, nicht an dessen Ergebnis: er wird gemessen, sobald der Lauf
// endet — auch wenn er scheitert, denn der Schluss-Draw laeuft in beiden Faellen. Er gehoert
// deshalb NICHT in C_AUSGAENGE (dort wuerde er zusaetzlich als uebersprungen gefuehrt und
// stuende doppelt im Protokoll), wohl aber in C_NAMEN: ohne Endpunkt gibt es keinen Lauf.
const C_NAMEN = ["C5 is-checking animiert", "C11 Panel folgt dem Strom", "C11b Hochscrollen im Strom wird respektiert", "C1 Stream liefert Ergebnis", "B11 Tippen ueberlebt das Ende eines Laufs", "B11b Tippen im Quelltextfeld ueberlebt das Ende eines Laufs", ...C_AUSGAENGE];

/** C9 — Pflicht-Punkt (b) aus dem Skill `gui-smoke-setup` § 3a, seit 2026-09-11 mit neuer
 *  Frage: **ist jedes Bedienelement ERREICHBAR?**
 *
 *  Bis dahin lautete sie „wird etwas verdeckt?", weil das Panel seine Hoehe aufteilte und
 *  nur die Vorschau rollte — ein Knopf konnte unter einem ueberlaufenden Bereich
 *  verschwinden. Das Panel ist jetzt EIN Rollbereich: nichts wird mehr verdeckt oder
 *  abgeschnitten, dafuer steht vieles ausserhalb des Sichtfensters. „Nicht sichtbar" ist
 *  damit kein Fehler mehr — „nicht erreichbar" schon. Gemessen wird deshalb je Element:
 *  hinscrollen (`scrollIntoView`), dann `elementFromPoint` auf seine Mitte. Trifft es sich
 *  selbst, ist es bedienbar.
 *
 *  Geprueft werden nicht nur die Knoepfe: auch das Quell-Textfeld (`.lt-freetext`, nur bei
 *  Quelle „Textfeld" im DOM) und der erste Regler — die waren es, die in der alten
 *  Aufteilung bei 420 px Panelhoehe unerreichbar wurden.
 *
 *  ⚠️ Der Punkt ist wertlos, solange das Panel nicht UEBERLAEUFT (CORE-TEST-01).
 *  Das Ergebnis eines Smoke-Laufs ist dafuer zu kurz — deshalb wird der Bereich vorher
 *  aufgefuellt und die Vorbedingung im Detailtext mitgemeldet, damit sichtbar bleibt, ob
 *  der Punkt ueberhaupt haette rot werden koennen.
 *
 *  Gemessen wird in ZWEI Lagen: natuerliche Panelhoehe (C9) und kuenstlich auf 420 px
 *  gedrueckte Leaf-Hoehe (C9b). Eine einzelne Hoehe misst nur den Rechner, auf dem sie
 *  lief; die zweite Lage kostet vier Zeilen und deckt den geteilten Seitenbereich ab.
 *  Ein Element ohne Flaeche zaehlt als unerreichbar.
 *
 *  ⚠️ Zwei Fallen im Renderer-Ausdruck, beide hier hineingelaufen: `cdp.evaluate` schickt
 *  ihn als STRING, und er steht im Treiber in einem Template-Literal. Ein echtes Newline
 *  darin (etwa aus einem `join`) bricht drueben das String-Literal auf, ein Backtick im
 *  KOMMENTAR beendet das Template-Literal schon hier. Das erste kostet den ganzen Lauf
 *  („ABBRUCH: Renderer: Uncaught", alles danach ungemessen), das zweite faellt wenigstens
 *  im Typecheck auf. Deshalb: Zeilen als eigene Elemente, keine Backticks in Kommentaren
 *  innerhalb eines Renderer-Ausdrucks. */
async function pruefeUeberdeckung(cdp: Cdp): Promise<void> {
  // Fuellen: einmal fuer beide Lagen.
  const gefuellt = await cdp.evaluate<{ scrollH: number; clientH: number }>(`
    const p = document.querySelector(".lt-panel");
    const body = document.querySelector(".okit-stream-body");
    if (!p || !body) return { scrollH: 0, clientH: 0 };
    // Je Zeile ein eigenes div, nicht ein Textblock mit Zeilenumbruechen: siehe den
    // Kommentar am Kopf dieser Funktion.
    const f = body.createDiv({ cls: "lt-smoke-fueller" });
    for (let i = 0; i < 150; i += 1) f.createDiv({ text: "Fuellzeile " + i + " fuer die Erreichbarkeitsprobe." });
    return { scrollH: p.scrollHeight, clientH: p.clientHeight };
  `);
  if (gefuellt.scrollH <= gefuellt.clientH + 8) {
    skipped("C9 jedes Bedienelement ist erreichbar (natuerliche Hoehe)", `Vorbedingung fehlt: das Panel laeuft nicht ueber (scrollHeight ${gefuellt.scrollH} <= clientHeight ${gefuellt.clientH})`);
    skipped("C9b jedes Bedienelement ist erreichbar (kurzes Panel, 420 px)", "ohne ueberlaufendes Panel gegenstandslos");
  } else {
    await messeErreichbarkeit(cdp, "C9 jedes Bedienelement ist erreichbar (natuerliche Hoehe)", gefuellt);

    // --- Zweite Lage: kurzes Panel ------------------------------------------------
    // Ein geteilter rechter Seitenbereich (zwei gestapelte Panels) ist der Normalfall,
    // nicht die Verrenkung — deshalb ist das eine Pflichtlage und keine Kuer. In der alten
    // Aufteilung war genau hier der Schaden: bei 420 px blieben dem Bedienblock null Pixel,
    // die Regler waren unerreichbar, und der Ueberstand wurde ersatzlos abgeschnitten.
    const kurz = await cdp.evaluate<{ ok: boolean; vorher: string; hoehe: number }>(`
      const leaf = document.querySelector(".lt-panel").closest(".workspace-leaf");
      if (!leaf) return { ok: false, vorher: "", hoehe: 0 };
      const vorher = leaf.style.height || "";
      leaf.style.height = "420px";
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, vorher, hoehe: Math.round(document.querySelector(".lt-panel").getBoundingClientRect().height) };
    `);
    if (!kurz.ok) {
      skipped("C9b jedes Bedienelement ist erreichbar (kurzes Panel, 420 px)", "kein .workspace-leaf ueber dem Panel gefunden");
    } else {
      const masse = await cdp.evaluate<{ scrollH: number; clientH: number }>(`
        const p = document.querySelector(".lt-panel");
        return { scrollH: p.scrollHeight, clientH: p.clientHeight };
      `);
      try {
        await messeErreichbarkeit(cdp, "C9b jedes Bedienelement ist erreichbar (kurzes Panel, 420 px)", masse, ` · Panel ${kurz.hoehe} px`);
        await gegenprobeErreichbarkeit(cdp);
      } finally {
        // Die Leaf-Hoehe ist Zustand der Zweitinstanz, nicht des Pruefpunkts: sie wird auch
        // dann zurueckgesetzt, wenn die Messung wirft — sonst misst jeder folgende Punkt
        // ein 420-px-Panel und meldet es als Eigenschaft des Plugins (CORE-TEST-21).
        await cdp.evaluate(`
          const leaf = document.querySelector(".lt-panel").closest(".workspace-leaf");
          if (leaf) leaf.style.height = ${q(kurz.vorher)};
          await new Promise((r) => setTimeout(r, 300));
          return { ok: true };
        `);
      }
    }
  }
  await cdp.evaluate(`
    for (const f of document.querySelectorAll(".lt-smoke-fueller")) f.remove();
    return { ok: true };
  `);
}

/** Der Renderer-Ausdruck der Erreichbarkeitsprobe — einmal geschrieben, dreimal gebraucht
 *  (natuerliche Hoehe, kurzes Panel, Gegenprobe). Zwei Fassungen liefen beim naechsten neuen
 *  Bedienelement auseinander, und die Gegenprobe maesse dann eine andere Menge als der Punkt,
 *  den sie absichern soll — genau das war am 2026-09-11 der Fall (Review M2).
 *
 *  `scrollen` ist der EINZIGE Unterschied zwischen Punkt und Gegenprobe: ohne Rollbereich
 *  gibt es nichts hinzuscrollen, und `scrollIntoView` bei `overflow: hidden` hat den Lauf
 *  einmal mit „Zeitueberschreitung: Runtime.evaluate" gerissen.
 *
 *  `gesamt` zaehlt VOR der Flaechenpruefung: ein Element, das gleich darauf in `schlecht`
 *  landet, wuerde sonst doppelt gezaehlt, und der Nenner im Protokoll waere zu gross
 *  („6 von 17" statt „6 von 11", Review I3). */
function erreichbarAusdruck(ziele: string[], scrollen: boolean): string {
  return `
  const ziele = ${JSON.stringify(ziele)};
  const schlecht = [];
  const fehlend = [];
  let gesamt = 0;
  let geprueft = 0;
  for (const sel of ziele) {
    const treffer = Array.from(document.querySelectorAll(sel));
    // Vom Regler nur der erste: vier Reglerzeilen stehen unmittelbar untereinander, und was
    // fuer die erste gilt, gilt fuer die anderen.
    const menge = sel === ".lt-dial-input" ? treffer.slice(0, 1) : treffer;
    if (menge.length === 0) { fehlend.push(sel); continue; }
    for (const b of menge) {
      gesamt += 1;
      // Hinscrollen ist Teil der Frage: im Ein-Rollbereich-Panel ist „steht ausserhalb des
      // Sichtfensters" kein Fehler, „laesst sich auch nach dem Rollen nicht treffen" schon.
      if (${String(scrollen)}) {
        b.scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 60));
      }
      const box = b.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) { schlecht.push({ cls: b.className, deckt: "(keine Flaeche)" }); continue; }
      geprueft += 1;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!(b === hit || b.contains(hit))) schlecht.push({ cls: b.className, deckt: hit ? String(hit.className || hit.tagName) : "(nichts)" });
    }
  }
  return { gesamt, geprueft, schlecht, fehlend };
`;
}

/** Die Bedienelemente des Panels — eine Liste, drei Verwendungen (C9, C9b, C9c). */
const BEDIENELEMENTE = [".lt-run", ".lt-refine", ".lt-reset", ".lt-out", ".lt-freetext", ".lt-dial-input"];
const ERREICHBAR_AUSDRUCK = erreichbarAusdruck(BEDIENELEMENTE, true);

interface Erreichbarkeit { gesamt: number; geprueft: number; schlecht: Array<{ cls: string; deckt: string }>; fehlend: string[] }

/** Die eigentliche Messung, zweimal gebraucht (natuerliche und kurze Panelhoehe). */
async function messeErreichbarkeit(cdp: Cdp, name: string, masse: { scrollH: number; clientH: number }, zusatz = ""): Promise<void> {
  const r = await cdp.evaluate<Erreichbarkeit>(ERREICHBAR_AUSDRUCK);
  // Nicht vorhandene Selektoren sind kein Befund, aber auch keine Fussnote: `.lt-freetext`
  // gibt es nur bei der Quelle „Textfeld", und wer das nicht mitliest, haelt einen Punkt fuer
  // gemessen, der es nicht war (CORE-TEST-19).
  const nicht = r.fehlend.length === 0 ? "" : ` · nicht im Panel: ${r.fehlend.join(", ")}`;
  const detail = r.schlecht.length === 0
    ? `${r.geprueft} von ${r.gesamt} Bedienelementen treffen sich selbst nach scrollIntoView (Panel ${masse.scrollH} px in ${masse.clientH} px)${zusatz}${nicht}`
    : `${r.schlecht.map((x) => `${x.cls} → ${x.deckt}`).join(" · ")}${zusatz}${nicht}`;
  record(name, r.schlecht.length === 0 && r.geprueft > 0, detail);
}

/** Gegenprobe zu C9/C9b: nimmt man dem Panel seinen Rollbalken, MUSS mindestens ein Element
 *  unerreichbar werden. Ohne sie waere ein gruener Punkt auch dann gruen, wenn die Messung
 *  gar nichts sehen kann — das ist die Gattung Fehler, an der ein Pruefpunkt still stirbt.
 *  Gemessen wird zuerst, ob die Manipulation die Geometrie ueberhaupt veraendert hat.
 *
 *  ⚠️ Hier wird NICHT `scrollIntoView` benutzt, anders als in C9/C9b — und das ist kein
 *  Versehen, sondern zweimal begruendet. Sachlich: ohne Rollbereich gibt es nichts
 *  hinzuscrollen; die Frage der Gegenprobe ist genau, was dann passiert. Gemessen: mit
 *  `scrollIntoView` bei `overflow: hidden` sucht Chromium den naechsten rollbaren Vorfahren
 *  und Obsidian antwortet mit einem Layout-Sturm — der erste Lauf am 2026-09-11 starb mit
 *  „Zeitueberschreitung: Runtime.evaluate" (30 s) und riss den restlichen Lauf mit. */
async function gegenprobeErreichbarkeit(cdp: Cdp): Promise<void> {
  const name = "C9c Gegenprobe: ohne Rollbalken wird etwas unerreichbar";
  let gesetzt = false;
  try {
    const vorher = await cdp.evaluate<{ h: number; scrollH: number; scrollTop: number }>(`
      const p = document.querySelector(".lt-panel");
      if (!p) return { h: 0, scrollH: 0, scrollTop: 0 };
      return { h: Math.round(p.getBoundingClientRect().height), scrollH: p.scrollHeight, scrollTop: Math.round(p.scrollTop) };
    `);
    gesetzt = (await cdp.evaluate<{ ok: boolean }>(`
      const p = document.querySelector(".lt-panel");
      if (!p) return { ok: false };
      p.scrollTop = 0;
      p.style.overflow = "hidden";
      return { ok: true };
    `)).ok;
    if (!gesetzt) { skipped(name, "kein .lt-panel im DOM"); return; }
    await new Promise((r) => setTimeout(r, 300));
    // DIESELBE Menge wie C9/C9b, nur ohne Scrollen — sonst sichert die Gegenprobe einen
    // Punkt ab, den sie gar nicht misst.
    const r = await cdp.evaluate<Erreichbarkeit>(erreichbarAusdruck(BEDIENELEMENTE, false));
    const masse = await cdp.evaluate<{ h: number; scrollH: number }>(`
      const p = document.querySelector(".lt-panel");
      return { h: Math.round(p.getBoundingClientRect().height), scrollH: p.scrollHeight };
    `);
    const wirksam = masse.scrollH > masse.h + 8;
    const namen = r.schlecht.slice(0, 4).map((x) => x.cls.split(" ")[0]);
    record(name, wirksam && r.schlecht.length > 0,
      !wirksam
        ? `die Manipulation hat nichts veraendert (${masse.scrollH} px in ${masse.h} px, vorher ${vorher.scrollH}/${vorher.h}) — ohne Wirkung ist die Gegenprobe wertlos`
        : r.schlecht.length > 0
          ? `overflow:hidden → ${r.schlecht.length} von ${r.gesamt} Elementen unerreichbar (${namen.join(", ")}), Panel ${masse.scrollH} px in ${masse.h} px`
          : `overflow:hidden, aber alle ${r.gesamt} Elemente weiter erreichbar — die Probe misst nichts`);
  } catch (e) {
    record(name, false, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    if (gesetzt) {
      await cdp.evaluate(`
        const p = document.querySelector(".lt-panel");
        if (p) p.style.overflow = "";
        return { ok: true };
      `).catch(() => null);
    }
  }
}

/** B11 — Fehler 1 in seinem schmaleren Fenster: der Voll-Draw am ENDE eines Laufs.
 *
 *  Die Anmerkung ist waehrend eines Streams absichtlich NICHT gesperrt; der Nutzer tippt dort
 *  die naechste Runde, waehrend er auf das Ergebnis wartet. `run()` schliesst mit einem
 *  bedingungslosen `draw()` ab, und das ersetzte bis 2026-09-08 das Feld unter dem Cursor.
 *  Einmal je Lauf statt bei jedem Tastendruck — und in dem Moment, in dem niemand hinsieht.
 *
 *  Gemessen in der B10-Form: Mutation getrennt, danach ein Fenster auf den NEGATIVEN Zustand.
 *  Die Mutation laeuft WAEHREND des Streams, gemessen wird NACH seinem Ende. Nummer nach
 *  Fehlerbild (B10s Zwilling), Ort nach Abhaengigkeit — ohne echten Lauf ist er nicht messbar.
 *  Der Rueckgabewert sagt, ob gemessen werden konnte.
 *
 *  `.lt-freetext` (Quelle „Textfeld") durchlaeuft denselben `render()`/`sourceRow()`-Codepfad
 *  wie `.lt-note` (0.1.1-Nachlese, Review-Punkt: „derselbe Codepfad, kein eigener Pruefpunkt").
 *  Selektor und Anzeigename sind deshalb Parameter statt zweiter Kopie — B11b (unten) ruft
 *  dieselben zwei Funktionen mit `.lt-freetext` auf. */
async function tippeWaehrendDesLaufs(cdp: Cdp, selector = ".lt-note"): Promise<boolean> {
  return (await cdp.evaluate<{ ok: boolean }>(`
    const el = document.querySelector(${q(selector)});
    if (!el) return { ok: false };
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    document.execCommand("insertText", false, "abc");
    document.dispatchEvent(new Event("selectionchange"));
    return { ok: true };
  `)).ok;
}

async function messeB11(cdp: Cdp, selector = ".lt-note", name = "B11 Tippen ueberlebt das Ende eines Laufs"): Promise<void> {
  const verloren = await pollUntil<{ aktiv: string }>(cdp, `
    const a = document.activeElement;
    if (a && a.matches(${q(selector)})) return null;
    return { aktiv: a ? (a.className || a.tagName) : "(null)" };
  `, 1200, 100);
  const stand = await cdp.evaluate<{ wert: string; aktiv: string }>(`
    const el = document.querySelector(${q(selector)});
    const a = document.activeElement;
    return { wert: el ? el.value : "(keine Textarea)", aktiv: a ? (a.className || a.tagName) : "(null)" };
  `);
  const klasse = selector.replace(/^\./, "");
  const gehalten = verloren === null && stand.aktiv.split(" ").includes(klasse);
  record(name, gehalten && stand.wert === "abc",
    gehalten ? `value=${JSON.stringify(stand.wert)}, Fokus blieb nach dem Schluss-Draw in ${selector}`
             : `value=${JSON.stringify(stand.wert)}, Fokus fiel auf ${JSON.stringify((verloren?.aktiv ?? stand.aktiv).slice(0, 60))}`);
  await cdp.evaluate(`
    const el = document.querySelector(${q(selector)});
    if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); el.blur(); }
    return { ok: true };
  `);
}

/** B11b — dieselbe Frage wie B11, fuer die Quelle „Textfeld" (`.lt-freetext`) statt „Aktive
 *  Notiz" (`.lt-note`): derselbe render()/sourceRow()-Codepfad, 0.1.1-Nachlese-Review-Punkt
 *  „derselbe Codepfad, kein eigener Pruefpunkt".
 *
 *  EIGENER dritter Lauf, nicht in C6 (zweiter Lauf) gefaltet: C3/C4 direkt nach C6 brauchen,
 *  dass die Session-Runde von C6 zur LEBENDEN Notiz passt (`canReplaceNote` vergleicht
 *  `cap.text` mit dem Text, der tatsaechlich getunt wurde) — ein C6-Lauf mit Quelle „Textfeld"
 *  verletzt das und macht `.lt-out-replace-note` disabled, WEIL sourceText (Platzhaltertext)
 *  nie zur Notiz passt. Erster Entwurf (2026-09-17) faltete B11b in C6 und riss dabei C3 rot
 *  („Notiz ersetzen schreibt Body" — Datei blieb unveraendert, weil der Knopf gesperrt war).
 *  Deshalb hier, NACH C3/C4/C8/C9d: nichts danach haengt mehr an einer Notiz-Quelle passenden
 *  Session-Runde — C10 setzt die Sitzung ohnehin komplett zurueck. */
async function pruefeB11bFreetext(cdp: Cdp): Promise<void> {
  const name = "B11b Tippen im Quelltextfeld ueberlebt das Ende eines Laufs";
  const klick = await waehleQuelle(cdp, 2);
  const da = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".lt-freetext") ? { ok: true } : null;`, 3000, 200);
  if (da === null) {
    skipped(name, `Quelle „Textfeld" liess sich nicht waehlen${klick}`);
    await waehleQuelle(cdp, 1).catch(() => "");
    return;
  }
  await cdp.evaluate(`
    const ta = document.querySelector(".lt-freetext");
    ta.value = "Quelltext fuer B11b, damit die Quelle bereit ist.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  `);
  let getippt = false;
  // Ergebnis des Laufs ist hier egal (wie bei B11 auf .lt-note): der Schluss-Draw laeuft
  // sowohl bei Erfolg als auch bei einem Fehler.
  await laufeTune(cdp, async () => { getippt = await tippeWaehrendDesLaufs(cdp, ".lt-freetext"); });
  if (getippt) await messeB11(cdp, ".lt-freetext", name);
  else skipped(name, "Tippen waehrend des Laufs schlug fehl — .lt-freetext war beim Klick nicht im DOM");
  await waehleQuelle(cdp, 1).catch(() => "");
}

/** C9d — das Quell-Textfeld, und zwar wirklich gemessen.
 *
 *  C9/C9b laufen mitten in Teil C, wo die Quelle auf „Aktive Notiz" steht; `.lt-freetext`
 *  existiert dann gar nicht und wird dort nur als „nicht im Panel" protokolliert. Ausgerechnet
 *  dieses Feld war am 2026-09-07 der erste gemeldete Schaden (mit `rows="6"` angefordert, auf
 *  eine halbe Zeile eingedampft) — ein Pruefpunkt, der es nie beruehrt, deckt den Anlassfall
 *  nicht ab (Review M9).
 *
 *  Deshalb ein EIGENER kleiner Punkt am Ende von Teil C: Quelle auf „Textfeld", fuellen,
 *  Textfeld und ersten Regler messen, Quelle im `finally` zurueck. Am Ende, weil der
 *  Quellenwechsel C3/C7 die Vorbedingung naehme. */
async function pruefeTextfeldErreichbar(cdp: Cdp): Promise<void> {
  const name = "C9d Quell-Textfeld und Regler erreichbar (Quelle Textfeld)";
  let gewechselt = false;
  try {
    const klick = await waehleQuelle(cdp, 2);
    const ta = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".lt-freetext") ? { ok: true } : null;`, 3000, 200);
    if (ta === null) { skipped(name, `Quelle „Textfeld" liess sich nicht waehlen${klick}`); return; }
    gewechselt = true;
    const masse = await cdp.evaluate<{ scrollH: number; clientH: number }>(`
      const p = document.querySelector(".lt-panel");
      const body = document.querySelector(".okit-stream-body");
      if (body) {
        const f = body.createDiv({ cls: "lt-smoke-fueller" });
        for (let i = 0; i < 150; i += 1) f.createDiv({ text: "Fuellzeile " + i + " fuer die Erreichbarkeitsprobe." });
      }
      await new Promise((r) => setTimeout(r, 200));
      // Ohne Panel kein Wurf, sondern 0/0 — die Vorbedingung unten meldet das dann als
      // uebersprungen, statt dass ein Wurf hier den ganzen Lauf reisst (Muster aus C9c).
      if (!p) return { scrollH: 0, clientH: 0 };
      return { scrollH: p.scrollHeight, clientH: p.clientHeight };
    `);
    if (masse.scrollH <= masse.clientH + 8) {
      skipped(name, `Vorbedingung fehlt: das Panel laeuft nicht ueber (${masse.scrollH} <= ${masse.clientH} + 8)`);
      return;
    }
    const r = await cdp.evaluate<Erreichbarkeit>(erreichbarAusdruck([".lt-freetext", ".lt-dial-input"], true));
    const detail = r.schlecht.length === 0
      ? `${r.geprueft} von ${r.gesamt} (Textfeld + erster Regler) treffen sich selbst nach scrollIntoView, Panel ${masse.scrollH} px in ${masse.clientH} px`
      : r.schlecht.map((x) => `${x.cls} → ${x.deckt}`).join(" · ");
    record(name, r.schlecht.length === 0 && r.geprueft === 2, detail);
  } finally {
    await cdp.evaluate(`
      for (const f of document.querySelectorAll(".lt-smoke-fueller")) f.remove();
      return { ok: true };
    `).catch(() => null);
    // Die Quelle ist Zustand des Wirts, nicht des Pruefpunkts: sie geht auch dann zurueck,
    // wenn die Messung wirft.
    if (gewechselt) await waehleQuelle(cdp, 1).catch(() => "");
  }
}

/** C10 — Zuruecksetzen fragt nach, wenn Runden existieren, und raeumt danach wirklich. */
async function pruefeZuruecksetzen(cdp: Cdp): Promise<void> {
  const vor = await cdp.evaluate<{ reset: number; runden: number; vorschau: number }>(`
    return {
      reset: document.querySelectorAll(".lt-reset").length,
      runden: app.workspace.getLeavesOfType(${q(VIEW_TYPE)})[0].view.session.rounds.length,
      vorschau: (document.querySelector(".lt-preview") || { textContent: "" }).textContent.trim().length,
    };
  `);
  if (vor.reset !== 1 || vor.runden === 0) {
    skipped("C10 Zuruecksetzen fragt nach und raeumt", `Vorbedingung fehlt: .lt-reset=${vor.reset}, Runden=${vor.runden} — ohne Runde gibt es keine Rueckfrage zu messen`);
    return;
  }
  await clickReal(cdp, `document.querySelector(".lt-reset")`);
  const modal = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".modal-button-container") ? { ok: true } : null;`, 5000, 200);
  if (modal === null) {
    record("C10 Zuruecksetzen fragt nach und raeumt", false, `kein Bestaetigungsdialog nach dem Klick — ${vor.runden} Runden waeren ungefragt weg gewesen`);
    return;
  }
  await clickReal(cdp, `Array.from(document.querySelectorAll(".modal-button-container button")).at(-1)`);
  const leer = await pollUntil<{ reset: number; runden: number; leerzustand: number }>(cdp, `
    const v = app.workspace.getLeavesOfType(${q(VIEW_TYPE)})[0].view;
    if (v.session.rounds.length !== 0) return null;
    return {
      reset: document.querySelectorAll(".lt-reset").length,
      runden: v.session.rounds.length,
      leerzustand: document.querySelectorAll(".lt-empty").length,
    };
  `, 5000, 250);
  record("C10 Zuruecksetzen fragt nach und raeumt", leer !== null && leer.reset === 0 && leer.leerzustand === 1,
    leer === null ? `Dialog bestaetigt, aber die Sitzung steht noch (${vor.runden} Runden)`
                  : `Rueckfrage kam, danach 0 Runden, .lt-reset weg, Leerzustand da (vorher ${vor.runden} Runden, ${vor.vorschau} Zeichen)`);
}

async function pruefeLauf(cdp: Cdp): Promise<void> {
  console.log("\nC · Lauf mit Modell");
  if (!(await endpointReachable())) {
    for (const n of C_NAMEN) skipped(n, `kein Endpunkt auf ${ENDPOINT}`);
    return;
  }
  const vorher = (await cdp.evaluate<{ t: string }>(`return { t: await app.vault.read(app.vault.getAbstractFileByPath(${q(NOTE)})) };`)).t;
  let logbuchAn = false;
  let denkenAn = false;
  let modellGeaendert = false;
  let modellVorwert = "";
  try {
    // Das Fixture ueberlaesst die Modellwahl dem Server („Server waehlt das Modell", model: "").
    // Das traegt nur, solange dort GENAU EIN Modell geladen ist. Gemessen 2026-09-07, 23:2x:
    // bei mehreren geladenen Modellen antwortet LM Studio mit 400 — auf `model: ""` mit
    // „Invalid model identifier", auf ein FEHLENDES Feld mit „Multiple models are loaded".
    // Das ist eine Eigenschaft des Endpunkts, kein Plugin-Defekt (beide Nutzlast-Formen per
    // curl gegengeprueft). Der Treiber waehlt deshalb selbst eines — aus der Liste des
    // Servers, nie hart verdrahtet: ein Modellname im Repo waere die Modell-Bibliothek eines
    // bestimmten Rechners.
    const konfiguriert = (await cdp.evaluate<{ m: string }>(`return { m: app.plugins.plugins[${q(PLUGIN_ID)}].settings.model };`)).m;
    if (konfiguriert === "") {
      const ids = await modelle();
      const gewaehlt = ids[0];
      if (gewaehlt !== undefined) {
        modellGeaendert = true;
        modellVorwert = konfiguriert;
        await setPluginSetting(cdp, PLUGIN_ID, "model", gewaehlt);
        console.log(`  · Modell fuer diesen Lauf gesetzt: ${gewaehlt} (Einstellung war „Server waehlt", ${ids.length} Modelle geladen)`);
      }
    }
    // C6 braucht das Logbuch VOR dem ersten Lauf — es schreibt beim Abschluss eines Laufs.
    await cdp.evaluate(`
      const f = app.vault.getAbstractFileByPath(${q(LOGBOOK_FOLDER)});
      if (f) await app.vault.delete(f, true);
      return { ok: true };
    `);
    await setPluginSetting(cdp, PLUGIN_ID, "logbookEnabled", true);
    logbuchAn = true;

    // --- Lauf 1: Stream, Animation, Ausgaenge -------------------------------------
    await clickReal(cdp, `document.querySelector(".lt-run")`);
    // C5 waehrend des Streams messen: danach steht die Klasse auf is-ok und die Frage ist weg.
    const anim = await pollUntil<{ a: string; reduced: boolean }>(cdp, `
      const s = document.querySelector(".lt-status");
      if (!s || !s.classList.contains("is-checking")) return null;
      const svg = document.querySelector(".lt-status-icon svg");
      if (!svg) return null;
      return { a: getComputedStyle(svg).animationName, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
    `, 15_000, 150);
    // C5 wird waehrend des Streams gemessen und deshalb auch hier protokolliert — vor C1,
    // damit die Reihenfolge im Protokoll die Reihenfolge der Messung ist.
    if (anim === null) {
      skipped("C5 is-checking animiert", "der Zustand is-checking war in 15 s nie zusammen mit einem .lt-status-icon svg zu sehen");
    } else if (anim.reduced) {
      skipped("C5 is-checking animiert", `System steht auf prefers-reduced-motion: reduce — styles.css schaltet die Animation dort absichtlich ab (animationName=${anim.a})`);
    } else {
      record("C5 is-checking animiert", anim.a === "lt-spin", `animationName=${anim.a}`);
    }

    // B11: WAEHREND des Streams in die Anmerkung tippen — gemessen wird nach dem Schluss-Draw.
    const getippt = await tippeWaehrendDesLaufs(cdp);

    // Der Endzustands-Poll misst zugleich C11 — ein zweiter Lauf nur fuers Scrollverhalten
    // kostete Minuten und saehe dasselbe.
    const folge = await laufeMitFolgeMessung(cdp, 120_000);
    const done = folge.fertig ? { ok: true } : null;
    if (folge.werte.length === 0) {
      skipped("C11 Panel folgt dem Strom", "waehrend des Laufs stand nie ein laufender Absatz im DOM — ohne Tail ist die Frage nicht messbar");
      skipped("C11b Hochscrollen im Strom wird respektiert", "ohne messbaren Strom gegenstandslos");
    } else {
      const anteil = folge.sichtbar / folge.werte.length;
      record("C11 Panel folgt dem Strom", anteil >= 0.8,
        `Tail sichtbar in ${folge.sichtbar}/${folge.werte.length} Messungen à ${TAKT_MS} ms (${Math.round(anteil * 100)} %) · rest median ${median(folge.werte)} px, min ${Math.min(...folge.werte)}, max ${Math.max(...folge.werte)} · unter dem Stream-Bereich ${folge.unten} px`);
      // Die andere Haelfte derselben Schwelle: wer hochscrollt, will lesen, nicht folgen.
      if (folge.nachStoerung.length === 0) {
        skipped("C11b Hochscrollen im Strom wird respektiert", `der Lauf endete vor der Stoerung (nur ${folge.werte.length} Messungen à ${TAKT_MS} ms) — nicht messbar`);
      } else {
        const max = Math.max(...folge.nachStoerung);
        record("C11b Hochscrollen im Strom wird respektiert", max < 40,
          `nach kuenstlichem scrollTop=0: ${folge.nachStoerung.length} Messungen, groesster Stand ${max} px`);
      }
    }
    if (getippt) await messeB11(cdp);
    else skipped("B11 Tippen ueberlebt das Ende eines Laufs", "keine .lt-note im Panel — ohne Eingabefeld ist der Punkt gegenstandslos");
    const ok = done !== null && (await hasClass(cdp, ".lt-status", "is-ok"));
    const preview = (await text(cdp, ".lt-preview")) ?? "";
    record("C1 Stream liefert Ergebnis", ok && preview.length > 0, ok ? `${preview.length} Zeichen` : `Status: ${(await text(cdp, ".lt-status")) ?? "?"}`);

    if (!ok) {
      for (const n of C_AUSGAENGE) skipped(n, "Lauf 1 lieferte kein Ergebnis — die Ausgaenge sind ohne eines gegenstandslos");
      return;
    }
    record("C2 Kopieren freigegeben", (await disabled(cdp, ".lt-out-copy")) === false, `disabled=${await disabled(cdp, ".lt-out-copy")}`);

    // C9 hier, nicht spaeter: ein Ergebnis steht, die Ausgangsknoepfe sind frei, und C3/C4
    // veraendern danach Quelle und aktiven Tab.
    await pruefeUeberdeckung(cdp);

    // --- C7 VOR C3/C4: beide veraendern die Quelle bzw. wechseln den aktiven Tab ---
    const vorGuard = await disabled(cdp, ".lt-out-replace-note");
    if (vorGuard !== false) {
      skipped("C7 Ersetzen-Ziel sperrt bei geaenderter Quelle", `Vorbedingung fehlt: .lt-out-replace-note war schon vor der Aenderung disabled=${vorGuard}`);
    } else {
      await cdp.evaluate(`
        const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
        leaf.view.editor.replaceRange("X", { line: 0, ch: 0 });
        app.workspace.trigger("active-leaf-change");
        return { ok: true };
      `);
      const gesperrt = await pollUntil<{ ok: boolean }>(cdp, `const b = document.querySelector(".lt-out-replace-note"); return b && b.disabled ? { ok: true } : null;`, 5000, 250);
      record("C7 Ersetzen-Ziel sperrt bei geaenderter Quelle", gesperrt !== null, gesperrt !== null ? "Quelle geaendert → .lt-out-replace-note disabled" : `disabled=${await disabled(cdp, ".lt-out-replace-note")}`);
      await cdp.evaluate(`
        const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
        leaf.view.editor.replaceRange("", { line: 0, ch: 0 }, { line: 0, ch: 1 });
        app.workspace.trigger("active-leaf-change");
        return { ok: true };
      `);
      await pollUntil<{ ok: boolean }>(cdp, `const b = document.querySelector(".lt-out-replace-note"); return b && !b.disabled ? { ok: true } : null;`, 5000, 250);
    }

    // --- C6: zweiter Lauf, danach traegt das Logbuch zwei Eintraege ---------------
    const ok2 = await laufeTune(cdp);
    const logbuch = await pollUntil<{ text: string; path: string }>(cdp, `
      const f = app.vault.getMarkdownFiles().find((x) => x.path.startsWith(${q(`${LOGBOOK_FOLDER}/LingoTuner `)}));
      if (!f) return null;
      const t = await app.vault.read(f);
      return (t.match(/^## /gm) || []).length >= 2 ? { text: t, path: f.path } : null;
    `, 15_000, 500);
    if (!ok2) {
      skipped("C6 Logbuch anlegen und anhaengen", `der zweite Lauf lieferte kein Ergebnis (Status: ${(await text(cdp, ".lt-status")) ?? "?"}) — ohne zwei fertige Laeufe ist der Punkt nicht messbar`);
    } else {
      const kopf = logbuch !== null && logbuch.text.startsWith("---\ntype: lingotuner-log\n---\n");
      const n = logbuch === null ? 0 : (logbuch.text.match(/^## /gm) ?? []).length;
      record("C6 Logbuch anlegen und anhaengen", logbuch !== null && kopf, logbuch === null ? `keine Datei ${LOGBOOK_FOLDER}/LingoTuner YYYY-MM.md mit zwei Eintraegen` : `${logbuch.path}: Frontmatter type: lingotuner-log, ${n} Eintraege`);
    }

    // --- C3/C4: die schreibenden Ausgaenge ----------------------------------------
    const stand = (await cdp.evaluate<{ t: string }>(`return { t: await app.vault.read(app.vault.getAbstractFileByPath(${q(NOTE)})) };`)).t;
    await clickReal(cdp, `document.querySelector(".lt-out-replace-note")`);
    // Kit-Confirm: Bestaetigen-Knopf ist der rechte im modal-button-container.
    await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".modal-button-container") ? { ok: true } : null;`, 5000, 200);
    await clickReal(cdp, `Array.from(document.querySelectorAll(".modal-button-container button")).at(-1)`);
    const changed = await pollUntil<{ t: string }>(cdp, `const t = await app.vault.read(app.vault.getAbstractFileByPath(${q(NOTE)})); return t !== ${q(stand)} ? { t } : null;`, 10_000, 500);
    record("C3 Notiz ersetzen schreibt Body", changed !== null && changed.t.startsWith("---\ntype: draft\n---"), changed !== null ? "Body ersetzt, Frontmatter steht" : `Datei unveraendert; Notices: ${await notices(cdp).catch(() => "?")}`);

    await clickReal(cdp, `document.querySelector(".lt-out-new-note")`);
    const neu = await pollUntil<{ p: string }>(cdp, `const f = app.vault.getMarkdownFiles().find((x) => x.basename.includes("(tuned)") || x.basename.includes("(getunt)")); return f ? { p: f.path } : null;`, 10_000, 500);
    record("C4 Neue Notiz entsteht", neu !== null, neu?.p ?? "keine Datei mit (tuned)/(getunt)");
    if (neu !== null) await cdp.evaluate(`await app.vault.delete(app.vault.getAbstractFileByPath(${q(neu.p)})); return { ok: true };`);

    // --- C8: der Lauf wird abgebrochen und hinterlaesst eine Teilrunde -----------
    denkenAn = true;
    await pruefeGedanken(cdp);

    // --- C9d vor C10: er wechselt die Quelle und braucht ein Panel mit Inhalt ---
    await pruefeTextfeldErreichbar(cdp);

    // --- B11b nach C3/C4/C8/C9d, vor C10: eigener dritter Lauf mit Quelle "Textfeld" — ab
    // hier haengt nichts Nachfolgendes mehr an einer zur Notiz passenden Session-Runde.
    await pruefeB11bFreetext(cdp);

    // --- C10 ganz zuletzt: er raeumt die Sitzung, alles danach saehe eine leere ---
    await pruefeZuruecksetzen(cdp);
  } finally {
    // Der Lauf hinterlaesst nichts im Vault: Notiz zurueck, Logbuch weg, Einstellung zurueck.
    await cdp.evaluate(`await app.vault.modify(app.vault.getAbstractFileByPath(${q(NOTE)}), ${q(vorher)}); return { ok: true };`).catch(() => null);
    await cdp.evaluate(`
      const f = app.vault.getAbstractFileByPath(${q(LOGBOOK_FOLDER)});
      if (f) await app.vault.delete(f, true);
      return { ok: true };
    `).catch(() => null);
    if (logbuchAn) await setPluginSetting(cdp, PLUGIN_ID, "logbookEnabled", false).catch(() => null);
    if (denkenAn) await setPluginSetting(cdp, PLUGIN_ID, "suppressThinking", true).catch(() => null);
    if (modellGeaendert) await setPluginSetting(cdp, PLUGIN_ID, "model", modellVorwert).catch(() => null);
  }
}

// --- M · LLM Endpoint Manager (optionale Fremd-Quelle, Task 5 Pilot) -------------------

/** Eigener Mini-HTTP-Server statt eines echten LLM-Servers oder des echten Manager-Plugins:
 *  M1-M3 pruefen die KONSUMENTEN-Seite (resolveEndpointSource/findEndpointManager in
 *  main.ts + settings-tab.ts), nicht den Manager selbst — der hat sein eigenes GUI-Smoke
 *  in llm-endpoint-manager/scripts/gui-smoke.ts (`startFakeEndpoint`, dort B1-B3). Diese
 *  Fassung beantwortet zusaetzlich POST /v1/chat/completions mit einem minimalen SSE-Strom,
 *  weil M2 einen echten Lauf braucht, nicht nur eine Erreichbarkeits-Probe.
 *
 *  Zweimal gebraucht (Fix-Runde M3-Nacharbeit, 2026-09-15): einmal als Manager-Endpunkt
 *  (M1/M2), einmal als lokaler Fallback-Endpunkt (M3) — deshalb `modelId` als Parameter statt
 *  fest verdrahtet, sonst waere ein Log-Eintrag nicht zuzuordnen, WELCHER Fake-Server eine
 *  Anfrage sah.
 *
 *  `lastModel()` (Review-Fund I5, Fix-Runde 3): bis dahin prueften M2/M3 nur `chatCalls() > 0`
 *  und DRUCKTEN einen erwarteten Modellnamen, ohne ihn wirklich zu pruefen — der Server hatte
 *  den Request-Body in der Hand und warf ihn weg. Der Body wird jetzt VOLLSTAENDIG eingesammelt
 *  (`req.on("data"/"end")`), BEVOR geantwortet wird — nicht nebenlaeufig dazu, sonst waere
 *  `lastModel()` ein Race gegen die eigene Antwort. */
interface FakeChatEndpoint { url: string; close: () => Promise<void>; chatCalls: () => number; lastModel: () => string | null }
async function startFakeChatEndpoint(modelId: string): Promise<FakeChatEndpoint> {
  let chatCalls = 0;
  let lastModel: string | null = null;
  const server: Server = createServer((req, res) => {
    // Der Renderer laeuft unter der Origin app://obsidian.md — ohne CORS-Header blockt der
    // Browser den Preflight (OPTIONS) und die eigentliche Anfrage sieht der Server nie.
    // Gemessen 2026-09-15: ohne diesen Block blieb chatCalls() bei 0, obwohl der Server lief.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.url?.includes("/v1/models") === true) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: modelId, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/v1/chat/completions") === true) {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      req.on("end", () => {
        chatCalls += 1;
        try { lastModel = (JSON.parse(body) as { model?: unknown }).model as string ?? null; } catch { lastModel = null; }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }], model: modelId })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], model: modelId })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
    chatCalls: () => chatCalls,
    lastModel: () => lastModel,
  };
}

/** Injiziert eine FAKE `llm-endpoint-manager`-API in den Renderer — der Brief erlaubt
 *  ausdruecklich „Fake-API oder echtes Manager-Plugin" fuer M1. `findEndpointManager()`
 *  prueft nur die FORM (version===1 + alle Methoden als Funktion), keine Herkunft; ein
 *  echtes Manager-Plugin-Repo muesste dafuer nicht gebaut und deployt werden.
 *
 *  `config.model` (Review-Fund I5/C1, Fix-Runde 3): der ECHTE Manager setzt in
 *  `ResolvedEndpoint.config.model` zusaetzlich zu `defaultModel` denselben Wert
 *  (`llm-endpoint-manager/src/core/reachability.ts:39-40`) — das war genau das Feld, das
 *  `main.ts:220` vor dem C1-Fix eine vom Nutzer getroffene Modellwahl ueberschreiben liess.
 *  Ohne dieses Feld haette der Fake den Fehler nicht reproduziert und M2b waere ohne Wirkung
 *  gruen gewesen.
 *
 *  Vorherigen Registry-Eintrag sichern statt loeschen (Review-Fund I6): ein `app.plugins.
 *  plugins[MANAGER_PLUGIN_ID]`-Objekt kann Methoden/Klasseninstanzen tragen, die eine
 *  CDP-Rundreise ueber Node nicht ueberlebt (JSON.stringify wirft Funktionen weg) — deshalb
 *  wird NICHT nach Node zurueckgereicht, sondern im Renderer selbst auf `window` geparkt und
 *  von `removeFakeManager()` dort wieder eingesetzt. Heute (Staging-Vault ohne echten
 *  Manager) folgenlos; sobald der echte Manager in diesem Vault deployt wird, verhindert das
 *  einen Smoke-Lauf, der dessen Registrierung fuer den Rest der Sitzung zerstoert. */
async function installFakeManager(cdp: Cdp, url: string): Promise<void> {
  await cdp.evaluate(`
    // Nur EINMAL sichern: ein zweiter installFakeManager()-Aufruf ohne removeFakeManager()
    // dazwischen (kommt hier nicht vor, aber die Invariante soll nicht stillschweigend
    // brechen) wuerde sonst die eigene Fake-Instanz als "vorher" ueberschreiben.
    if (!("__smokeVorherManager" in window)) {
      window.__smokeVorherManager = app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}] ?? null;
    }
    const ep = { id: "fake-mgr-ep", label: "Fake Manager Endpoint", url: ${q(url)}, provider: "openai", capabilities: ["chat"], defaultModel: ${q(MANAGER_DEFAULT_MODEL)}, enabled: true, hasSecret: false };
    const api = {
      version: 1,
      list: (filter) => [ep],
      get: (id) => (id === ep.id ? ep : null),
      resolve: async (capability, opts) => ({ id: ep.id, label: ep.label, config: { url: ${q(url)}, model: ${q(MANAGER_DEFAULT_MODEL)} }, defaultModel: ${q(MANAGER_DEFAULT_MODEL)} }),
      materialize: async (id, opts) => (id === ep.id ? { id: ep.id, label: ep.label, config: { url: ${q(url)}, model: ${q(MANAGER_DEFAULT_MODEL)} }, defaultModel: ${q(MANAGER_DEFAULT_MODEL)} } : { error: "not-found" }),
      models: async (id) => (id === ep.id ? [${q(MANAGER_DEFAULT_MODEL)}] : { error: "not-found" }),
      importEndpoints: async (eps, capability) => ({ added: [], merged: [], skipped: eps.map((e) => e.url) }),
      on: (event, cb) => (() => {}),
    };
    app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}] = { api };
    return { ok: true };
  `);
}

/** Entfernt die Fake-API — Analog zu `app.plugins.disablePlugin()` (der Brief nennt beides
 *  als gleichwertig fuer M3). `findEndpointManager()` liest bei JEDEM Aufruf frisch aus
 *  `app.plugins.plugins`, ein `changed`-Ereignis ist fuer die Abwesenheit nicht noetig — der
 *  naechste `resolveEndpoint()`/Settings-Rebuild sieht sie ohnehin sofort.
 *
 *  Stellt den VOR `installFakeManager()` vorgefundenen Eintrag wieder her (Review-Fund I6),
 *  statt ihn zu loeschen — s. Kommentar dort. Idempotent: ein Aufruf ohne vorheriges
 *  `installFakeManager()` (z. B. im `finally`-Pfad nach einem fruehen Abbruch) findet
 *  `"__smokeVorherManager" in window` als `false` und loescht dann einfach, wie zuvor. */
async function removeFakeManager(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    if ("__smokeVorherManager" in window) {
      const vorher = window.__smokeVorherManager;
      if (vorher === null) delete app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}];
      else app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}] = vorher;
      delete window.__smokeVorherManager;
    } else {
      delete app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}];
    }
    return { ok: true };
  `);
}

/** Settings-Stelle: Modal (< 1.13) oder eigenes Fenster (>= 1.13) — uebernommen aus
 *  llm-endpoint-manager/scripts/gui-smoke.ts (dortige Herkunft: anysource-sideloader,
 *  2026-09-15). Obsidian 1.13 macht aus den Einstellungen ein eigenes Fenster ohne
 *  `window.app`; DOM-Pruefungen laufen deshalb ueber `stelle`, Zustands-Pruefungen (Plugin-
 *  Settings) immer ueber die Workspace-Verbindung `cdp`. */
interface SettingsStelle { cdp: Cdp; eigenesFenster: boolean; el: (ausdruck: string) => string }
async function settingsStelle(cdp: Cdp, port: number): Promise<SettingsStelle | null> {
  const alsModal = await cdp.evaluate<boolean>(`return Boolean(document.querySelector(".modal.mod-settings"));`);
  if (alsModal) {
    return {
      cdp,
      eigenesFenster: false,
      el: (ausdruck) => `(() => { const root = document.querySelector(".modal.mod-settings"); if (!root) return null; return (${ausdruck}) ?? null; })()`,
    };
  }
  const fenster = await attachTo("settings", port, REPO_NAME);
  if (!fenster) return null;
  return {
    cdp: fenster,
    eigenesFenster: true,
    // NICHT `document` als root: `Node.textContent` liefert fuer ein Document-Node per Spec
    // IMMER `null` (nur Element-/Text-Nodes tragen es) — ein `root.textContent`-Ausdruck waere
    // damit strukturell blind, egal wie lange gewartet wird. Gemessen 2026-09-15 an M1/M3:
    // `document.querySelectorAll(...)` fand die echten Elemente (stelleCount stimmte), aber
    // `document.textContent` blieb "" (bodyLen 0) selbst bei vollstaendig gerendertem Tab —
    // der vermutete Timing-Flake war keiner. `document.body` traegt textContent wie erwartet.
    el: (ausdruck) => `(() => { const root = document.body; return (${ausdruck}) ?? null; })()`,
  };
}

/** Ein NOCH offenes Einstellungen-Fenster (>=1.13) aus einem vorherigen `openSettings()`
 *  ist derselbe CDP-Ziel-Eintrag wie ein frisches — `attachTo("settings", …)` kann dann das
 *  ALTE (schon geschlossene, inhaltslose) Fenster treffen statt des neuen. Gemessen
 *  2026-09-15: `app.setting.close()` schliesst zwar das Fenster, aber `/json/list` fuehrt es
 *  noch kurz weiter — deshalb wird hier auf sein Verschwinden GEWARTET, bevor neu geoeffnet
 *  wird, statt sich auf einen festen Sleep zu verlassen. Das Ziel traegt die URL "about:blank"
 *  (kein `app://obsidian.md/...` wie die Workspace-Seite).
 */
async function warteAufGeschlosseneSettings(port: number, timeoutMs = 3000): Promise<void> {
  const bis = Date.now() + timeoutMs;
  for (;;) {
    try {
      const liste = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as Array<{ type: string; url: string; title: string }>;
      const offen = liste.some((t) => t.type === "page" && t.url === "about:blank" && t.title.includes(REPO_NAME));
      if (!offen) return;
    } catch { return; }
    if (Date.now() > bis) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function openSettings(cdp: Cdp, port: number): Promise<SettingsStelle> {
  // Defensiv IMMER erst schliessen (auch wenn nichts offen war — dann no-op): der Grund
  // steht im Kommentar von warteAufGeschlosseneSettings.
  await cdp.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
  await warteAufGeschlosseneSettings(port);
  await cdp.evaluate(`
    app.setting.open();
    await new Promise((r) => setTimeout(r, 500));
    app.setting.openTabById(${q(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1000));
    return { ok: true };
  `);
  const stelle = await settingsStelle(cdp, port);
  if (!stelle) throw new Error("Kein Einstellungen-Fenster/Modal gefunden.");
  if (stelle.eigenesFenster) await requireVisible(stelle.cdp).catch(() => undefined);
  // Wartet zusaetzlich auf den Plugin-Namen im Tab-Body statt sich auf den festen Sleep oben
  // zu verlassen — billige Absicherung, seit der eigentliche Fehler (`document.textContent`
  // ist per Spec IMMER null, s. `settingsStelle`) behoben ist, kein Flake mehr bekannt.
  await pollUntil<{ ok: boolean }>(
    stelle.cdp,
    `return ${stelle.el(`root.textContent && root.textContent.includes(${q(t_pluginName())}) ? { ok: true } : null`)};`,
    5000,
    200,
  );
  return stelle;
}
/** "LingoTuner" — der Ueberschriften-Text der eigenen Settings-Gruppe, ohne den i18n-Import
 *  im Treiber zu ziehen (der laeuft im Renderer, nicht in Node). Fest verdrahtet, weil er
 *  hier nur als Existenz-Marker dient, nicht als gepruefter String. */
function t_pluginName(): string { return "LingoTuner"; }

function closeSettings(cdp: Cdp, stelle: SettingsStelle): void {
  if (stelle.eigenesFenster) stelle.cdp.close();
  else void cdp.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
}

async function stelleCount(stelle: SettingsStelle, selector: string): Promise<number> {
  const r = await stelle.cdp.evaluate<{ n: number | null }>(`return { n: ${stelle.el(`root.querySelectorAll(${q(selector)}).length`)} };`);
  return r.n ?? 0;
}

async function stelleText(stelle: SettingsStelle): Promise<string> {
  const r = await stelle.cdp.evaluate<{ t: string | null }>(`return { t: ${stelle.el(`root.textContent || ""`)} };`);
  return r.t ?? "";
}

const MANAGED_TEXT = ["Endpunkte kommen vom LLM Endpoint Manager", "Endpoints come from the LLM Endpoint Manager"];

/** M1-M3 (Task-5-Brief): Manager an → Settings zeigen den Baustein statt der lokalen Liste,
 *  ein Lauf geht an den Manager-Endpunkt; Manager aus → beides faellt auf lokal zurueck.
 *  M2/M3-Laeufe nutzen `laufeTune` (bereits fuer Teil C vorhanden) — dieselbe Mutation
 *  (`.lt-run` klicken, auf `.lt-status` is-ok/is-error warten), nur mit anderer Quelle
 *  darunter. Kein eigener try/finally je Punkt: alles haengt an DERSELBEN Fake-Instanz
 *  (Server + injizierte API), ein einziger auesserer try/finally raeumt beides auf. */
async function pruefeManager(cdp: Cdp, port: number): Promise<void> {
  console.log("\nM · LLM Endpoint Manager (optionale Fremd-Quelle)");
  let fake: FakeChatEndpoint | null = null;
  let localFake: FakeChatEndpoint | null = null;
  let stelle: SettingsStelle | null = null;
  // Muss zurueckgeschrieben werden, falls M3 die lokale Liste testweise umbiegt — main()
  // fuehrt nach pruefeManager() nur noch einen Skip-Marker und das Aufraeumen aus (Stand
  // 2026-09-15 in main() geprueft), aber ein Treiber, der die Vault-Settings anders verlaesst
  // als er sie vorfand, ist ein Rueckstand fuer den naechsten Lauf.
  let vorherEndpoints: unknown = null;
  const REST = [
    "M1 Settings zeigen den Manager statt der lokalen Liste",
    "M2 Lauf nutzt den Manager-Endpunkt und das Default-Modell",
    "M2b Manager-Lauf nutzt gewaehltes Modell, nicht den Endpunkt-Default (C1)",
    "M3 Manager aus → lokale Liste in Settings und im Lauf",
  ];
  try {
    fake = await startFakeChatEndpoint(MANAGER_DEFAULT_MODEL);
    console.log(`  Fake-Manager-Endpunkt: ${fake.url}`);
    await installFakeManager(cdp, fake.url);

    // M1 — Settings zeigen den Manager-Baustein (Text + Import-Knopf), kein .okit-ep-row
    // (der Marker des lokalen Listen-Editors, siehe vendor/kit-obsidian/endpoint-list.ts).
    stelle = await openSettings(cdp, port);
    const body = await stelleText(stelle);
    const managed = MANAGED_TEXT.some((s) => body.includes(s));
    const localRows = await stelleCount(stelle, ".okit-ep-row");
    record(REST[0]!, managed && localRows === 0, `managed-Text ${managed ? "da" : "fehlt"}, ${localRows} lokale Endpunkt-Zeilen`);
    closeSettings(cdp, stelle);
    stelle = null;

    // M2 — ein Lauf nutzt den Manager-Endpunkt (Fake-Server sieht POST /v1/chat/completions)
    // und das Default-Modell (kein choice.model gesetzt → modelOf() faellt auf defaultModel).
    // Review-Fund I5: geprueft wird jetzt das TATSAECHLICH empfangene Modell (`lastModel()`),
    // nicht nur die Aufrufzahl — vorher haette C1 (ep.model ueberschreibt activeModel) hier
    // still durchgehen koennen, weil der Fake den Body warf.
    const okM2 = await laufeTune(cdp);
    const calls = fake.chatCalls();
    const modellM2 = fake.lastModel();
    record(REST[1]!, okM2 && calls > 0 && modellM2 === MANAGER_DEFAULT_MODEL,
      okM2 ? `Fake-Server sah ${calls} POST /v1/chat/completions, Modell ${JSON.stringify(modellM2)} (erwartet ${JSON.stringify(MANAGER_DEFAULT_MODEL)})`
           : `Lauf lieferte kein Ergebnis (Status: ${(await text(cdp, ".lt-status")) ?? "?"}), Fake-Server-Aufrufe: ${calls}`);

    // M2b — Review-Fund C1: `ep.model` (im echten Manager == `defaultModel`, s.
    // `installFakeManager`-Kommentar) darf eine vom Nutzer im `choice.model` getroffene Wahl
    // NICHT ueberschreiben. Setzt `choice.model` auf einen Wert, der sich vom Default
    // unterscheidet, und prueft, dass GENAU DIESER beim Fake-Server ankommt — das ist der
    // eigentliche Beweis fuer den Fix, nicht nur "ein Lauf war gruen".
    const gewaehltesModell = `${MANAGER_DEFAULT_MODEL}-CHOICE`;
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.choice = { ...p.settings.choice, model: ${q(gewaehltesModell)} };
      await p.saveSettings();
      await p.resolveEndpoint();
      return { ok: true };
    `);
    const okM2b = await laufeTune(cdp);
    const modellM2b = fake.lastModel();
    record(REST[2]!, okM2b && modellM2b === gewaehltesModell,
      okM2b ? `Fake-Server sah Modell ${JSON.stringify(modellM2b)}, erwartet ${JSON.stringify(gewaehltesModell)}`
            : `Lauf lieferte kein Ergebnis (Status: ${(await text(cdp, ".lt-status")) ?? "?"})`);
    // choice zuruecksetzen: sonst liest M3s LOKALER Lauf denselben choice.model (modelOf()
    // prueft choice VOR localModel, unabhaengig vom Manager) und sein lastModel()-Check faellt
    // auf ein falsches "erwartet" herein, das gar nicht der Grund waere.
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.choice = {};
      await p.saveSettings();
      return { ok: true };
    `);

    // M3 — Manager "deaktivieren" (Analog zu disablePlugin, s. removeFakeManager) → Settings
    // fallen auf die lokale Liste zurueck, ein Lauf nutzt wieder den lokalen Endpunkt.
    //
    // Der lokale Lauf haengt NICHT am echten LM-Studio-Server auf ENDPOINT (:1234) — das ist
    // dieselbe Umgebungssache, die C1 rot macht (Modelle gelistet, Chat-Aufruf trotzdem
    // abgelehnt), und ein M3 mit dieser Abhaengigkeit ist "nichts gemessen", nicht "geprueft"
    // (Review-Fund, Fix-Runde M3-Nacharbeit 2026-09-15). Stattdessen ein ZWEITER Fake-Server
    // (dieselbe Bauart wie fuer M1/M2, eigener Modellname) — die lokale Endpunkt-Liste zeigt
    // waehrend der Messung testweise auf ihn und wird danach zurueckgeschrieben, statt die
    // Vault-Fixture dauerhaft zu aendern.
    await removeFakeManager(cdp);
    stelle = await openSettings(cdp, port);
    const bodyNach = await stelleText(stelle);
    const managedNach = MANAGED_TEXT.some((s) => bodyNach.includes(s));
    const localRowsNach = await stelleCount(stelle, ".okit-ep-row");
    closeSettings(cdp, stelle);
    stelle = null;
    const settingsZurueck = !managedNach && localRowsNach > 0;

    localFake = await startFakeChatEndpoint(LOCAL_FALLBACK_MODEL);
    console.log(`  Fake-Lokal-Endpunkt: ${localFake.url}`);
    vorherEndpoints = (await cdp.evaluate<{ eps: unknown }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints };`)).eps;
    // model auf dem Endpunkt-Eintrag selbst (nicht settings.model): das ist die lokale
    // Pro-Endpunkt-Ueberschreibung, die C1s Fix fuer den lokalen Pfad ausdruecklich WEITER
    // gewinnen laesst (\`this.endpointSource === "local" && ep.model ? ep.model : ...\`) —
    // ohne sie waere settings.model ("" im Fixture, "Server waehlt") das einzig Erwartbare,
    // und der Modell-Check unten haette nichts Sinnvolles zu pruefen.
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(localFake.url)}, model: ${q(LOCAL_FALLBACK_MODEL)} }];
      await p.saveSettings();
      // invalidateEndpointCache(): resolveEndpoint() cacht den lokalen Pfad (Ersatz fuer den
      // entfernten EndpointResolver) — ohne die Invalidierung wuerde der naechste Lauf den
      // laengst gecachten ECHTEN :1234-Endpunkt aus dem allerersten onload() weiterverwenden,
      // die neue Liste bliebe wirkungslos.
      p.invalidateEndpointCache();
      await p.resolveEndpoint();
      return { ok: true };
    `);
    const okLokal = await laufeTune(cdp);
    const lokaleCalls = localFake.chatCalls();
    const modellLokal = localFake.lastModel();
    record(REST[3]!, settingsZurueck && okLokal && lokaleCalls > 0 && modellLokal === LOCAL_FALLBACK_MODEL,
      `managed-Text ${managedNach ? "noch da" : "weg"}, ${localRowsNach} lokale Zeilen, lokaler Lauf gegen Fake-Server ${okLokal ? "ok" : "fehlgeschlagen"} (${lokaleCalls} POST /v1/chat/completions, Modell ${JSON.stringify(modellLokal)}, erwartet ${JSON.stringify(LOCAL_FALLBACK_MODEL)})`);
  } catch (e) {
    for (const n of REST) {
      if (!checks.some((c) => c.name === n)) skipped(n, `Messung abgebrochen: ${(e as Error).message}`);
    }
  } finally {
    if (stelle) closeSettings(cdp, stelle);
    await removeFakeManager(cdp).catch(() => null);
    if (vorherEndpoints !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        if (!p) return { ok: false };
        p.settings.endpoints = ${JSON.stringify(vorherEndpoints)};
        await p.saveSettings();
        p.invalidateEndpointCache();
        await p.resolveEndpoint();
        return { ok: true };
      `).catch(() => null);
    }
    if (fake) await fake.close().catch(() => undefined);
    if (localFake) await localFake.close().catch(() => undefined);
  }
}

/** N1-N4 (Sampling-Profile-Welle, Teil D, Rezept 8): der neue Abschnitt „Anfrage" in den
 *  Settings und die Denk-Steuerung im Panel (`buildThinkingControl`). Kein echter LLM-Server
 *  noetig — alles hier ist DOM-Zustand nach einer Einstellungs-Aenderung. */
/** L — llm-lab bekommt Aufzeichnungen. Der Punkt, den der Smoke bis 2026-09-25 nicht hatte: der Client
 *  pruefte apiVersion 3, das Lab lieferte 4, `readLabApi` gab still null zurueck und NICHTS wurde
 *  aufgezeichnet — kein Fehler, kein rotes Zeichen. Gemessen wird deshalb die Wirkung: eine neue
 *  Zeile in der Trace-Datei des Labs, mit turnId. Ohne geladenes llm-lab: uebersprungen und benannt. */
async function pruefeLab(cdp: Cdp): Promise<void> {
  console.log("\nL · llm-lab-Aufzeichnung (optionale Fremd-Quelle)");
  const NAME = "L1 Ein Tunen erzeugt eine Lab-Aufzeichnung mit turnId (apiVersion 4)";
  const info = await cdp.evaluate<{ da: boolean; version: number | null }>(`const l = app.plugins.plugins[${q(LAB_PLUGIN_ID)}]; return { da: !!l?.api, version: l?.api?.apiVersion ?? null };`);
  if (!info.da) { skipped(NAME, `llm-lab nicht geladen — 'npm run smoke:gui -- --setup' deployt es aus ../llm-lab (gebaut), danach die Zweitinstanz neu starten`); return; }
  let fake: FakeChatEndpoint | null = null;
  const zeilen = `
    const dir = ".obsidian/plugins/${LAB_PLUGIN_ID}/traces";
    const out = [];
    if (await app.vault.adapter.exists(dir)) {
      for (const f of (await app.vault.adapter.list(dir)).files) {
        for (const z of (await app.vault.adapter.read(f)).split("\\n")) { if (!z) continue; try { const r = JSON.parse(z); if (r.plugin === "lingotuner") out.push(r); } catch { /* halbe Zeile */ } }
      }
    }
    return { zeilen: out };`;
  try {
    fake = await startFakeChatEndpoint(MANAGER_DEFAULT_MODEL);
    await installFakeManager(cdp, fake.url);
    const vorher = (await cdp.evaluate<{ zeilen: unknown[] }>(zeilen)).zeilen.length;
    const ok = await laufeTune(cdp);
    const nach = await pollUntil<{ zeilen: Array<{ turnId?: string }> }>(cdp, zeilen.replace("return { zeilen: out };", `return out.length > ${vorher} ? { zeilen: out } : null;`), 5000, 250);
    const letzte = nach?.zeilen[nach.zeilen.length - 1];
    record(NAME, ok && nach !== null && typeof letzte?.turnId === "string" && letzte.turnId.length > 0,
      ok ? `Lab apiVersion ${String(info.version)}, Zeilen von lingotuner ${vorher} → ${nach?.zeilen.length ?? vorher}, turnId ${JSON.stringify(letzte?.turnId ?? null)}`
         : `Lauf lieferte kein Ergebnis (Status: ${(await text(cdp, ".lt-status")) ?? "?"})`);
  } finally {
    await removeFakeManager(cdp).catch(() => null);
    if (fake) await fake.close();
  }
}

async function pruefeAnfrage(cdp: Cdp, port: number): Promise<void> {
  console.log('\nN · Abschnitt "Anfrage" (Sampling-Profile)');
  let stelle: SettingsStelle | null = null;
  const NAMEN = [
    "N1 Abschnitt Anfrage laesst sich aufklappen",
    "N2 Eigener Wert wird gesetzt und wieder zurueckgesetzt",
    "N3 Denk-Knopf im Panel schaltet um",
    "N4 Stufenwahl im Chat zeigt ein Dropdown",
  ];
  try {
    stelle = await openSettings(cdp, port);
    // N1 — Header per Titeltext finden (De/En, je nach Sprache des Vaults), klicken, Body
    // verliert is-collapsed.
    const geklappt = await stelle.cdp.evaluate<{ textDa: boolean; ok: boolean }>(`return ${stelle.el(`(() => {
      const header = [...root.querySelectorAll(".okit-collapsible-header")].find((h) => /Anfrage|Request/.test(h.textContent || ""));
      if (!header) return { textDa: false, ok: false };
      header.click();
      const body = header.closest(".okit-collapsible").querySelector(".okit-collapsible-body");
      return { textDa: true, ok: !!body && !body.classList.contains("is-collapsed") };
    })()`)};`);
    record(NAMEN[0]!, geklappt.textDa && geklappt.ok,
      geklappt.textDa ? `aufgeklappt=${geklappt.ok}` : "kein .okit-collapsible-header mit 'Anfrage'/'Request' gefunden");

    if (geklappt.textDa && geklappt.ok) {
      // N2 — Temperatur-Feld ueberschreiben (blur loest das Speichern aus), pruefen, dass es
      // als eigener Wert markiert ist, dann per Zuruecksetzen-Knopf (Extra-Button) aufheben.
      const gesetzt = await stelle.cdp.evaluate<{ own: boolean; zurueck: boolean }>(`return ${stelle.el(`(async () => {
        const input = root.querySelector('input[data-field="temperature"]');
        if (!input) return { own: false, zurueck: false };
        input.value = "0.9";
        input.dispatchEvent(new Event("blur"));
        await new Promise((r) => setTimeout(r, 300));
        const nachInput = root.querySelector('input[data-field="temperature"]');
        const own = !!nachInput && nachInput.classList.contains("okit-request-own");
        const item = nachInput ? nachInput.closest(".setting-item") : null;
        const resetBtn = item ? item.querySelector(".clickable-icon") : null;
        if (resetBtn) resetBtn.click();
        await new Promise((r) => setTimeout(r, 300));
        const nachReset = root.querySelector('input[data-field="temperature"]');
        const zurueck = !!nachReset && !nachReset.classList.contains("okit-request-own");
        return { own, zurueck };
      })()`)};`);
      record(NAMEN[1]!, gesetzt.own && gesetzt.zurueck, `eigener Wert gesetzt=${gesetzt.own}, zurueckgesetzt=${gesetzt.zurueck}`);
    } else {
      skipped(NAMEN[1]!, "Abschnitt liess sich nicht aufklappen — ohne ihn ist kein Feld erreichbar");
    }
    closeSettings(cdp, stelle);
    stelle = null;

    // N3 — Denk-Knopf im Panel: ein Klick schaltet is-off um.
    const vor = await hasClass(cdp, ".okit-thinking-toggle", "is-off");
    await clickReal(cdp, `document.querySelector(".okit-thinking-toggle")`).catch(() => undefined);
    await new Promise((r) => { setTimeout(r, 300); });
    const nach = await hasClass(cdp, ".okit-thinking-toggle", "is-off");
    record(NAMEN[2]!, vor !== nach, `is-off vorher=${vor}, nachher=${nach}`);
    if (vor !== nach) await clickReal(cdp, `document.querySelector(".okit-thinking-toggle")`).catch(() => undefined); // zurueck

    // N4 — "Stufenwahl im Chat" einschalten (direkt in den Settings, kein Umweg ueber einen
    // zweiten Settings-Aufruf) und das Panel selbst neu zeichnen lassen (`refresh()`, das
    // Kit-Muster fuer Aenderungen von aussen) — danach steht ein <select> statt des Knopfs.
    const dropdown = await cdp.evaluate<{ vorher: boolean; nachher: boolean }>(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      const vorher = !!document.querySelector(".okit-thinking-control select");
      p.settings.request.levelPickerInChat = true;
      await p.saveSettings();
      const leaf = app.workspace.getLeavesOfType(${q(VIEW_TYPE)})[0];
      if (leaf && leaf.view && leaf.view.refresh) leaf.view.refresh();
      await new Promise((r) => setTimeout(r, 300));
      const nachher = !!document.querySelector(".okit-thinking-control select");
      return { vorher, nachher };
    `);
    record(NAMEN[3]!, !dropdown.vorher && dropdown.nachher, `Dropdown vorher=${dropdown.vorher}, nachher=${dropdown.nachher}`);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.request.levelPickerInChat = false;
      await p.saveSettings();
      const leaf = app.workspace.getLeavesOfType(${q(VIEW_TYPE)})[0];
      if (leaf && leaf.view && leaf.view.refresh) leaf.view.refresh();
      return { ok: true };
    `).catch(() => undefined);
  } catch (e) {
    for (const n of NAMEN) {
      if (!checks.some((c) => c.name === n)) skipped(n, `Messung abgebrochen: ${(e as Error).message}`);
    }
  } finally {
    if (stelle) closeSettings(cdp, stelle);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--setup")) { setupVault(); return; }
  const portArg = argv.indexOf("--port");
  const port = portArg >= 0 ? Number(argv[portArg + 1]) : 9222;
  const vaultArg = argv.indexOf("--vault");
  const vaultFilter = vaultArg >= 0 ? argv[vaultArg + 1] : REPO_NAME;

  const cdp = await attachTo("workspace", port, vaultFilter);
  if (!cdp) throw new Error(`Kein Obsidian-Fenster fuer Vault "${vaultFilter}" auf Port ${port}.`);
  const warnungen: string[] = [];
  try {
    await cdp.mitschnitt((z) => { if (/error|exception/i.test(z)) warnungen.push(`Renderer: ${z}`); });
    await requireVisible(cdp);
    const v = (await cdp.evaluate<{ name: string; basePath: string; configDir: string }>(`return { name: app.vault.getName(), basePath: app.vault.adapter.basePath, configDir: app.vault.configDir };`));
    console.log(`Vault: ${v.name} (${v.basePath})`);
    requireEigenerBuild(join(v.basePath, v.configDir, "plugins", PLUGIN_ID, "main.js"), join(REPO_ROOT, "main.js"), (m) => warnungen.push(m));

    await pruefeGrundlage(cdp, v.name);
    await pruefePanel(cdp);
    await pruefeLauf(cdp);
    await pruefeManager(cdp, port);
    await pruefeLab(cdp);
    await pruefeAnfrage(cdp, port);
    skipped("Markierung ersetzen (Rand-Whitespace)", "Editor-Selektion per CDP ist im Unit-Test abgedeckt (editor-io.test.ts); im Smoke muesste sie ueber CodeMirror gesetzt werden — Handarbeit");
  } finally {
    if (vorherigeDials !== null) {
      await setPluginSetting(cdp, PLUGIN_ID, "lastDials", vorherigeDials).catch(() => null);
    }
    const n = await closeExtraLeaves(cdp).catch(() => 0);
    console.log(`\nAufgeraeumt: ${n} zusaetzliche Leaves geschlossen. Notices: ${await notices(cdp).catch(() => "?")}`);
    cdp.close();
  }
  const gruen = checks.filter((c) => c.zustand === "gruen").length;
  const rot = checks.filter((c) => c.zustand === "rot");
  const ueb = checks.filter((c) => c.zustand === "uebersprungen").length;
  console.log(`\n${gruen} gruen · ${rot.length} rot · ${ueb} uebersprungen · von ${checks.length} Pruefpunkten`);
  for (const w of warnungen) console.log(`WARNUNG: ${w}`);
  if (rot.length) { console.log(`Rot: ${rot.map((r) => r.name).join(" · ")}`); process.exitCode = 1; }
}

main().catch((e: unknown) => { console.error(`\nABBRUCH: ${(e as Error).message}`); process.exitCode = 2; });
