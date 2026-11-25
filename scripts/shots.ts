/**
 * Aufnahme-Treiber fuer `docs/images/` — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian (Skill `readme-shots`).
 *
 * ## Ablauf (Zweitinstanz, eigenes Profil, eigener Port — Freigabe Welle 9)
 *
 * ```bash
 * npm run build && npm run shots -- --setup                    # Vault aus docs/images/fixture/
 * # Zweitinstanz wie im Kopf von scripts/gui-smoke.ts (eigenes Profil, eigener Port), Vault
 * # lingotuner-shots und englische Oberflaeche (obsidian.json language UND localStorage language = "en", dann Neustart),
 * # Lock fuer den Port halten, dann:
 * npm run shots -- --port 9325 [--only hero] [--out docs/images]
 * ```
 *
 * Der Vault heisst `lingotuner-shots` (nicht `lingotuner`): der GUI-Smoke baut seinen Vault aus
 * `fixtures/vault/` in `lingotuner`, und zwei Fixtures im selben Verzeichnis wuerden einander
 * bei jedem `--setup` ueberschreiben.
 *
 * Das Modell ist eine **Attrappe** des Treibers (Port 1236, nicht der echte LM-Studio-Port 1234):
 * die Bilder zeigen dadurch immer denselben, redaktionell gewaehlten Text, unabhaengig davon, was
 * auf dem Rechner geladen ist. Der Treiber setzt Endpunkt und Modell selbst und stellt beides am
 * Ende zurueck.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit } from "node:process";

import { Cdp, attachTo, bereiteInstanzVor, clickReal, pollUntil, requireUntil, requireVisible, schliesseEinstellungen, setAppConfig, setPluginSetting } from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub, type LlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { boxAround, boxOf, capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "lingotuner";
const VAULT_NAME = "lingotuner-shots";
const VIEW_TYPE = "lingotuner-panel";
const NOTE = "Draft reply to Sam.md";
const FAKE_PORT = 1236;
// Ein Name mit erkannter Familie (qwen3): die Modellzeile zeigt dann die Denkstufe, wie bei einem echten Modell; „local-model“ hatte keine, die Bilder zeigten die Stufenwahl nie.
const FAKE_MODEL = "qwen3.8-27b";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const WINDOW = { width: 1200, height: 1000 };

const q = (s: unknown): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- Attrappe des Modells ---------------------------------------------------------------
/** Antworten in Reihenfolge der Anfragen; die letzte wird wiederholt. Der Treiber setzt sie je
 *  Motiv neu. Der Text ist redaktionell: dieselbe Information wie im Entwurf, anderer Stil. */
const ANSWERS = {
  clarity: [
    "Hi Sam,",
    "Could you send me the report by Friday? If Friday does not work, please tell me which day does.",
    "Thanks,\nJo",
  ],
  refined: [
    "Hi Sam,",
    "Could you send me the report by Friday? If that does not work, please tell me which day does.",
    "Thanks,\nJo",
  ],
} as const;

interface Fake { setAnswer: (a: readonly string[]) => void; close: () => Promise<void> }

/** Duenne Huelle ueber den zentralen Stub (`startLlmStub`, Welle 20): fester Port wie bisher, ein Stueck je Absatz ohne Takt. */
async function startFakeModel(): Promise<Fake> {
  const stuecke = (a: readonly string[]): string[] => a.map((absatz, i) => (i === 0 ? "" : "\n\n") + absatz);
  let stub: LlmStub;
  try {
    stub = await startLlmStub({ port: FAKE_PORT, models: [FAKE_MODEL], takt: 0, standard: { stuecke: stuecke(ANSWERS.clarity), model: FAKE_MODEL } });
  } catch (e) {
    throw new Error(`Port ${FAKE_PORT} nicht bindbar: ${(e as Error).message}`);
  }
  return {
    setAnswer: (a) => { stub.setzeAntwort(() => ({ stuecke: stuecke(a), model: FAKE_MODEL })); },
    close: () => stub.stop(),
  };
}

// --- Zustand ---------------------------------------------------------------------------
async function panelZustand(ws: Cdp): Promise<void> {
  await ws.evaluate(`
    app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
    app.workspace.detachLeavesOfType("markdown");
    // Standardbreite zurueck (ein Motiv verbreitert die Sidebar) und leere „Untitled"-Notizen weg:
    // ein Mehrmotiv-Lauf hat einmal eine angelegt, vermutlich durch einen Klick, der nach einer
    // Layout-Aenderung neben das Ziel fiel — die Datei stand danach im Datei-Explorer des Bildes.
    app.workspace.rightSplit.setSize(300);
    for (const f of app.vault.getMarkdownFiles()) if (/^Untitled( \\d+)?\\.md$/.test(f.name) && f.stat.size === 0) await app.vault.delete(f);
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  `);
  await setPluginSetting(ws, PLUGIN_ID, "endpoints", [{ url: `http://127.0.0.1:${FAKE_PORT}`, model: FAKE_MODEL }]);
  await setPluginSetting(ws, PLUGIN_ID, "lastDials", { directness: 0, context: 0, social: 0, semantics: 0 });
  await ws.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; p.llm.invalidate(); await p.llm.resolve(); return { ok: true };`);
}

async function aufraeumen(ws: Cdp): Promise<void> {
  await ws.evaluate(`
    app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    if (p) {
      p.settings.endpoints = [{ url: "http://127.0.0.1:1234" }];
      p.settings.lastDials = { directness: 0, context: 0, social: 0, semantics: 0 };
      await p.saveSettings();
      p.llm.invalidate();
    }
    return { ok: true };
  `).catch(() => { console.log("  ! Aufraeumen fehlgeschlagen — data.json im Aufnahme-Vault pruefen"); });
}

/** Notiz oeffnen, den ersten Absatz markieren und das Panel mit der Markierung oeffnen. */
async function oeffneMitMarkierung(ws: Cdp): Promise<void> {
  const geoeffnet = await ws.evaluate<{ ok: boolean }>(`
    const file = app.vault.getAbstractFileByPath(${q(NOTE)});
    if (!file) return { ok: false };
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "source" } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true };
  `);
  if (!geoeffnet.ok) throw new Error(`Notiz „${NOTE}" fehlt im Vault`);
  const markiert = await ws.evaluate<{ n: number }>(`
    const ed = app.workspace.activeEditor && app.workspace.activeEditor.editor;
    if (!ed) return { n: -1 };
    const zeilen = ed.getValue().split("\\n");
    const von = zeilen.findIndex((z) => z.startsWith("I was just wondering"));
    if (von < 0) return { n: -2 };
    ed.setSelection({ line: von, ch: 0 }, { line: von, ch: zeilen[von].length });
    return { n: ed.getSelection().length };
  `);
  if (markiert.n <= 0) throw new Error(`Markierung fehlgeschlagen (${markiert.n})`);
  await ws.evaluate(`app.commands.executeCommandById(${q(`${PLUGIN_ID}:tune-selection`)}); return { ok: true };`);
  const da = await pollUntil<{ ok: boolean }>(ws, `return document.querySelector(".lt-panel") ? { ok: true } : null;`, 10_000, 300);
  if (da === null) throw new Error("Panel oeffnet nicht");
  await sleep(600);
}

async function waehlePreset(ws: Cdp, name: string): Promise<void> {
  const idx = (await ws.evaluate<{ i: number }>(`
    return { i: [...document.querySelectorAll(".lt-preset-chip")].findIndex((b) => (b.textContent || "").trim() === ${q(name)}) };
  `)).i;
  if (idx < 0) throw new Error(`Preset „${name}" nicht gefunden`);
  await clickReal(ws, `document.querySelectorAll(".lt-preset-chip")[${idx}]`);
  await sleep(300);
}

/** Senden und warten, bis der Rahmen fertig meldet. `runden`: so viele Zeilen muss die Rundenliste danach tragen (die Liste erscheint erst ab zwei Runden; ab der zweiten Runde steht der Status schon vorher auf is-ok). */
async function tune(ws: Cdp, runden = 0): Promise<void> {
  await clickReal(ws, `document.querySelector(".okit-prompt-panel-send")`);
  const fertig = await pollUntil<{ ok: boolean }>(ws, `
    const s = document.querySelector(".okit-prompt-panel-status");
    if (!s || !s.classList.contains("is-ok")) return null;
    return document.querySelectorAll(".okit-prompt-panel-rounds .okit-vlist-row").length >= ${runden} ? { ok: true } : null;
  `, 30_000, 300);
  if (fertig === null) {
    const st = await ws.evaluate<{ cls: string; label: string }>(`const s = document.querySelector(".okit-prompt-panel-status"); const l = document.querySelector(".okit-prompt-panel-status .okit-status-label"); return { cls: s ? s.className : "kein .okit-prompt-panel-status", label: l ? l.textContent : "" };`);
    throw new Error(`Lauf wird nicht fertig (Status nie is-ok oder zu wenige Runden): ${st.cls} · „${st.label}"`);
  }
  await sleep(800);   // die Vorschau rendert Markdown nach dem Ende des Stroms
}

async function notiz(ws: Cdp, text: string): Promise<void> {
  await ws.evaluate(`
    const el = document.querySelector(".okit-prompt-panel-input");
    el.value = ${q(text)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  `);
}

/** Das Element, das das Panel rollt (der erste Vorfahr mit overflow auto/scroll, der wirklich ueberlaeuft), oder null. */
const ROLLBEREICH = `(() => { let el = document.querySelector(".okit-prompt-panel"); while (el && el !== document.body) { const o = getComputedStyle(el).overflowY; if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) return el; el = el.parentElement; } return null; })()`;

// --- Motive ----------------------------------------------------------------------------
type Motiv = { name: string; datei: string; thumb: boolean; nimm: (ws: Cdp, fake: Fake, port: number) => Promise<Buffer> };

/** Zeiger aus dem Bild: nach `clickReal` ruht er auf dem Knopf, und Obsidian zeigt das `aria-label` des Feldes darueber als Tooltip („Note“ im ersten Hero, Nachlauf Welle 37). */
async function mausWeg(ws: Cdp): Promise<void> {
  await ws.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await ws.evaluate(`document.querySelectorAll(".tooltip").forEach((t) => t.remove()); return { ok: true };`);
  await sleep(300);
}

async function ganzesFenster(ws: Cdp): Promise<Buffer> {
  await mausWeg(ws);
  return capture(ws, undefined, 2);
}

const MOTIVE: Motiv[] = [
  {
    name: "hero", datei: "hero.png", thumb: false,
    nimm: async (ws, fake) => {
      fake.setAnswer(ANSWERS.clarity);
      await panelZustand(ws);
      await oeffneMitMarkierung(ws);
      await waehlePreset(ws, "Maximum clarity");
      await tune(ws, 0);
      return ganzesFenster(ws);
    },
  },
  {
    name: "rounds", datei: "rounds.png", thumb: false,
    nimm: async (ws, fake) => {
      fake.setAnswer(ANSWERS.clarity);
      await panelZustand(ws);
      await oeffneMitMarkierung(ws);
      await waehlePreset(ws, "Maximum clarity");
      await tune(ws, 0);
      fake.setAnswer(ANSWERS.refined);
      await notiz(ws, "Keep the offer of another day.");
      await tune(ws, 2);
      // Nach zwei Runden ist das Panel hoeher als das Fenster, und die feste Fusszeile (Station 7) deckt die Rundenliste ab: ans Ende rollen.
      await ws.evaluate(`const r = ${ROLLBEREICH}; if (r) r.scrollTop = r.scrollHeight; return { ok: true };`);
      await sleep(300);
      return ganzesFenster(ws);
    },
  },
  {
    name: "dials", datei: "dials.png", thumb: true,
    nimm: async (ws) => {
      await panelZustand(ws);
      await oeffneMitMarkierung(ws);
      await waehlePreset(ws, "Collegial");
      // Vom Ziel (Station 1) bis zum Knopf Tune (Station 4); Statuszeile und Vorschau zeigt der Rahmen erst mit einem Lauf.
      const box = await boxAround(ws, [".okit-prompt-panel-top", ".okit-prompt-panel-send"], 4);
      if (!box) throw new Error("Panel-Bereiche nicht gefunden");
      await mausWeg(ws);
      return capture(ws, box, 2);
    },
  },
];

// --- Pruefbilder (kein README-Bild) ------------------------------------------------------
/** Das Panel hell und dunkel bei Seitenleistenbreite (300 px) und bei 366 px, vor dem ersten Lauf und nach zwei Runden, je oben und
 *  ganz nach unten gerollt. Fuer die Layout-Pruefung vor einem Release (alle Bedienteile erreichbar, nichts abgeschnitten); die Bilder
 *  gehen in `--bilder`/`--out`, nie nach `docs/images/`. Aufruf: `npm run shots -- --port <p> --only pruef --bilder <ordner>`. */
async function pruefBilder(ws: Cdp, fake: Fake, outDir: string): Promise<string[]> {
  if (outDir === "docs/images") throw new Error("--only pruef braucht --bilder <ordner> (Pruefbilder gehoeren nicht nach docs/images)");
  mkdirSync(outDir, { recursive: true });
  const geschrieben: string[] = [];
  const reihe = async (stand: string): Promise<void> => {
    for (const thema of ["moonstone", "obsidian"] as const) {
      await setAppConfig(ws, "theme", thema);
      for (const breite of [300, 366]) {
        await ws.evaluate(`app.workspace.rightSplit.setSize(${breite}); await new Promise((r) => setTimeout(r, 500)); return { ok: true };`);
        for (const lage of ["oben", "unten"] as const) {
          const m = await ws.evaluate<{ rollt: boolean; h: number; c: number }>(`const r = ${ROLLBEREICH}; if (r) r.scrollTop = ${lage === "oben" ? 0 : "r.scrollHeight"}; return { rollt: Boolean(r), h: r ? r.scrollHeight : 0, c: r ? r.clientHeight : 0 };`);
          if (lage === "unten" && !m.rollt) continue;   // passt alles in die Hoehe, reicht das obere Bild
          await sleep(300);
          await mausWeg(ws);
          const box = await boxOf(ws, ".lt-panel");
          if (!box) throw new Error("Panel nicht sichtbar");
          const datei = join(outDir, `pruef-${stand}-${thema === "moonstone" ? "hell" : "dunkel"}-${breite}-${lage}.png`);
          writeFileSync(datei, await capture(ws, box, 2));
          geschrieben.push(`${datei} (Panel ${Math.round(box.width)} px, Rollbereich ${m.rollt ? `${m.h}/${m.c}` : "keiner"})`);
        }
      }
    }
    await setAppConfig(ws, "theme", "moonstone");
    await ws.evaluate(`app.workspace.rightSplit.setSize(300); return { ok: true };`);
  };
  fake.setAnswer(ANSWERS.clarity);
  await panelZustand(ws);
  await oeffneMitMarkierung(ws);
  await waehlePreset(ws, "Maximum clarity");
  await reihe("bereit");
  await tune(ws, 0);
  fake.setAnswer(ANSWERS.refined);
  await notiz(ws, "Keep the offer of another day.");
  await tune(ws, 2);
  await reihe("runden");
  return geschrieben;
}

/** Einstellungen: ab Obsidian 1.13 ein eigenes Fenster ohne `window.app`. */
async function settingsBild(ws: Cdp, port: number, outDir: string): Promise<string> {
  await schliesseEinstellungen(ws);
  await sleep(800);
  await ws.evaluate(`
    app.setting.open();
    await new Promise((r) => setTimeout(r, 500));
    app.setting.openTabById(${q(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true };
  `);
  const modal = await ws.evaluate<{ m: boolean }>(`return { m: Boolean(document.querySelector(".modal.mod-settings")) };`);
  const fenster = modal.m ? ws : await attachTo("settings", port, VAULT_NAME);
  if (!fenster) throw new Error("Kein Einstellungen-Fenster gefunden");
  try {
    if (!modal.m) await requireVisible(fenster).catch(() => undefined);
    await setWindowSize(fenster, 1200, 1100);
    await requireUntil(fenster, `document.body.textContent.includes("Endpoints")`, "Einstellungen-Tab zeigt „Endpoints“ nicht — ein Bild ohne die Endpunkt-Zeile waere falsch", 10_000, 250);
    await sleep(2500);   // die Statusleuchte der Endpunkt-Zeile kommt asynchron
    // Der Tab ist laenger als der Bildschirm: gezeigt wird die Inhaltsspalte von „Connection" bis
    // zum Ende der Gruppe „Style" (Ausgabe-Gruppe steht in der README-Tabelle).
    const stil = await boxAround(fenster, [".vertical-tab-content .setting-item"], 0);
    // Bis zum Ende der Zeile „System prompt“ (Gruppe Style): seit der Systemprompt-Einstellung ist Style hoeher als das Fenster, ein Ausschnitt bis „Output“
    // reichte unter den Fensterrand und zeigte dort Schwarz (Nachlauf Welle 37).
    const bis = await fenster.evaluate<{ y: number }>(`
      const namen = [...document.querySelectorAll(".setting-item-name")];
      const sp = namen.find((e) => (e.textContent || "").trim() === "System prompt");
      const zeile = sp ? sp.closest(".setting-item") : null;
      return { y: zeile ? Math.min(zeile.getBoundingClientRect().bottom + 14, window.innerHeight) + 14 : -1 };   // nie unter den Fensterrand: dort malt die Aufnahme Schwarz
    `);
    if (!stil || bis.y < 0) throw new Error("Einstellungs-Inhalt nicht gefunden");
    const von = await fenster.evaluate<{ y: number }>(`
      const namen = [...document.querySelectorAll(".setting-item-name, .setting-item-heading, h1, h2, h3")];
      const k = namen.find((e) => (e.textContent || "").trim() === "Connection");
      return { y: k ? k.getBoundingClientRect().top : -1 };
    `);
    if (von.y < 0) throw new Error("Gruppe „Connection“ nicht gefunden");
    const clip: Rect = { x: stil.x - 16, y: von.y - 28, width: stil.width + 32, height: bis.y - von.y + 28 - 14 };
    const png = await capture(fenster, clip, 2);
    return await writeShot(fenster, "settings.png", png, { outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH });
  } finally {
    if (!modal.m) fenster.close();
    await schliesseEinstellungen(ws);
  }
}

function setup(): void {
  const vaultDir = stagingVaultDir(VAULT_NAME);
  const log = buildVault({ repoRoot: cwd(), vaultDir, fixtureDir: "docs/images/fixture", pluginId: PLUGIN_ID });
  console.log(`Vault: ${vaultDir}`);
  for (const zeile of log) console.log(" ·", zeile);
  console.log("\nObsidian mit diesem Vault UND englischer Oberflaeche starten (Zweitinstanz, eigener Port), dann:\n  npm run shots -- --port <port>");
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  if (args.includes("--setup")) { setup(); return; }

  const port = Number(flag("port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port <1024-65535> ist Pflicht (Port deiner Zweitinstanz) — kein Standardport.");
  const only = flag("only");
  const outDir = flag("bilder") ?? flag("out") ?? "docs/images";   // --bilder: so reicht messlauf.sh (BILDER) den Ordner durch

  const ws = await attachTo("workspace", port, VAULT_NAME);
  if (!ws) throw new Error(`Kein Obsidian-Fenster fuer Vault „${VAULT_NAME}" auf Port ${port}`);

  let fake: Fake | null = null;
  try {
    await requireVisible(ws);

    const sprache = await ws.evaluate<{ lang: string }>(`return { lang: window.moment ? window.moment.locale() : "?" };`);
    if (!sprache.lang.startsWith("en")) {
      throw new Error(`Oberflaeche ist „${sprache.lang}", nicht Englisch — obsidian.json UND localStorage["language"] auf "en", dann Neustart.`);
    }
    // Vertrauensdialog, Restricted Mode und Plugin laden, das Hauptfenster als activeDocument zurueckholen (ein frisches Profil zeigt sonst den Dialog im Bild).
    const vor = await bereiteInstanzVor(ws, { pluginIds: [PLUGIN_ID], nurVault: VAULT_NAME, sprache: "en" });
    console.log(`Instanz: ${vor.hinweis}`);
    // Helles Theme zur Laufzeit: obsidian.json/appearance.json greifen bei laufender Instanz nicht.
    await setAppConfig(ws, "theme", "moonstone");
    await setWindowSize(ws, WINDOW.width, WINDOW.height);
    await sleep(600);

    fake = await startFakeModel();
    if (only === "pruef") {
      for (const zeile of await pruefBilder(ws, fake, outDir)) console.log("  ✓", zeile);
      return;
    }
    const wanted = MOTIVE.filter((m) => only === undefined || m.name === only);
    for (const m of wanted) {
      const png = await m.nimm(ws, fake, port);
      console.log("  ✓", await writeShot(ws, m.datei, png, { outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: m.thumb }));
    }
    if (only === undefined || only === "settings") {
      await panelZustand(ws);
      console.log("  ✓", await settingsBild(ws, port, outDir));
    }
  } finally {
    await aufraeumen(ws);
    if (fake) await fake.close().catch(() => undefined);
    ws.close();
  }
}

await main().catch((fehler: Error) => { console.error(fehler.message); exit(1); });
