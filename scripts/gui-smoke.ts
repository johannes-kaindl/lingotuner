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
import { copyFileSync, existsSync } from "node:fs";
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
  console.log("\nDen Vault in der Zweitinstanz registrieren (Rezept im Dateikopf) und dann:");
  console.log("  npm run smoke:gui -- --port 9341");
}

async function endpointReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${ENDPOINT}/v1/models`, { signal: ctrl.signal });
    clearTimeout(timer);
    return r.ok;
  } catch { return false; }
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
  record("B7 Preset zeigt (angepasst)", (await count(cdp, ".lt-preset-custom")) === 1, `${await count(cdp, ".lt-preset-custom")} Marker`);

  const klick8 = await waehleQuelle(cdp, 2);
  const ta = await pollUntil<{ ok: boolean }>(cdp, `return document.querySelector(".lt-freetext") ? { ok: true } : null;`, 3000, 200);
  record("B8 Textfeld-Quelle zeigt Textarea", ta !== null, `${ta !== null ? ".lt-freetext da" : "fehlt"}${klick8}`);

  // Lesemodus blockiert Markierung/Notiz.
  await waehleQuelle(cdp, 1);
  await cdp.evaluate(`const v = app.workspace.getLeavesOfType("markdown")[0].view; await v.setState({ ...v.getState(), mode: "preview" }, { history: false }); app.workspace.trigger("active-leaf-change"); return { ok: true };`);
  const blocked = await pollUntil<{ ok: boolean }>(cdp, `const el = document.querySelector(".lt-source-line"); return el && el.classList.contains("is-blocked") ? { ok: true } : null;`, 5000, 250);
  record("B9 Lesemodus blockiert die Quelle", blocked !== null, blocked !== null ? "is-blocked gesetzt" : (await text(cdp, ".lt-source-line")) ?? "keine Zeile");
  await cdp.evaluate(`const v = app.workspace.getLeavesOfType("markdown")[0].view; await v.setState({ ...v.getState(), mode: "source" }, { history: false }); app.workspace.trigger("active-leaf-change"); return { ok: true };`);
}

/** Einen Tune-Lauf ausloesen und auf seinen Endzustand warten. `null` = nie fertig geworden. */
async function laufeTune(cdp: Cdp): Promise<boolean> {
  await clickReal(cdp, `document.querySelector(".lt-run")`);
  const done = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 120_000, 1000);
  return done !== null && (await hasClass(cdp, ".lt-status", "is-ok"));
}

/** Die Punkte, die ein Ergebnis VORAUSSETZEN — eine Liste, zwei Verwendungen (kein
 *  Endpunkt / kein Ergebnis). Zwei getrennte Listen liefen beim naechsten neuen Punkt
 *  auseinander, und ein vergessener Name faellt nirgends auf: er waere schlicht nicht im
 *  Protokoll, und „nicht gemessen" saehe aus wie „nicht noetig". */
const C_AUSGAENGE = [
  "C2 Kopieren freigegeben", "C3 Notiz ersetzen schreibt Body", "C4 Neue Notiz entsteht",
  "C6 Logbuch anlegen und anhaengen", "C7 Ersetzen-Ziel sperrt bei geaenderter Quelle",
];
const C_NAMEN = ["C5 is-checking animiert", "C1 Stream liefert Ergebnis", ...C_AUSGAENGE];

async function pruefeLauf(cdp: Cdp): Promise<void> {
  console.log("\nC · Lauf mit Modell");
  if (!(await endpointReachable())) {
    for (const n of C_NAMEN) skipped(n, `kein Endpunkt auf ${ENDPOINT}`);
    return;
  }
  const vorher = (await cdp.evaluate<{ t: string }>(`return { t: await app.vault.read(app.vault.getAbstractFileByPath(${q(NOTE)})) };`)).t;
  let logbuchAn = false;
  try {
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

    const done = await pollUntil<{ ok: boolean }>(cdp, `const s = document.querySelector(".lt-status"); return s && (s.classList.contains("is-ok") || s.classList.contains("is-error")) ? { ok: true } : null;`, 120_000, 1000);
    const ok = done !== null && (await hasClass(cdp, ".lt-status", "is-ok"));
    const preview = (await text(cdp, ".lt-preview")) ?? "";
    record("C1 Stream liefert Ergebnis", ok && preview.length > 0, ok ? `${preview.length} Zeichen` : `Status: ${(await text(cdp, ".lt-status")) ?? "?"}`);

    if (!ok) {
      for (const n of C_AUSGAENGE) skipped(n, "Lauf 1 lieferte kein Ergebnis — die Ausgaenge sind ohne eines gegenstandslos");
      return;
    }
    record("C2 Kopieren freigegeben", (await disabled(cdp, ".lt-out-copy")) === false, `disabled=${await disabled(cdp, ".lt-out-copy")}`);

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
  } finally {
    // Der Lauf hinterlaesst nichts im Vault: Notiz zurueck, Logbuch weg, Einstellung zurueck.
    await cdp.evaluate(`await app.vault.modify(app.vault.getAbstractFileByPath(${q(NOTE)}), ${q(vorher)}); return { ok: true };`).catch(() => null);
    await cdp.evaluate(`
      const f = app.vault.getAbstractFileByPath(${q(LOGBOOK_FOLDER)});
      if (f) await app.vault.delete(f, true);
      return { ok: true };
    `).catch(() => null);
    if (logbuchAn) await setPluginSetting(cdp, PLUGIN_ID, "logbookEnabled", false).catch(() => null);
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
