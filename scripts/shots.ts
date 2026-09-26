/**
 * Aufnahme-Treiber fuer `docs/images/` — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian (Skill `readme-shots`).
 *
 * ## Ablauf (Zweitinstanz, eigenes Profil, eigener Port — Freigabe Welle 9)
 *
 * ```bash
 * npm run build && npm run shots -- --setup                    # Vault aus docs/images/fixture/
 * # Obsidian mit diesem Vault UND englischer Oberflaeche starten (obsidian.json language UND
 * # localStorage language = "en", dann Neustart), Lock fuer den Port halten, dann:
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

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { argv, cwd, exit } from "node:process";

import { Cdp, attachTo, clickReal, pollUntil, requireVisible, setAppConfig, setPluginSetting } from "../../tools/obsidian-cdp/cdp.js";
import { boxAround, capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "lingotuner";
const VAULT_NAME = "lingotuner-shots";
const VIEW_TYPE = "lingotuner-panel";
const NOTE = "Draft reply to Sam.md";
const FAKE_PORT = 1236;
const FAKE_MODEL = "local-model";
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

async function startFakeModel(): Promise<Fake> {
  let answer: readonly string[] = ANSWERS.clarity;
  const server: Server = createServer((req, res) => {
    // Der Renderer laeuft unter app://obsidian.md — ohne CORS-Header sieht der Server nie eine Anfrage.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.url?.includes("/v1/models") === true) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: FAKE_MODEL, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/v1/chat/completions") === true) {
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const send = (delta: object, finish: string | null): void => {
          res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }], model: FAKE_MODEL })}\n\n`);
        };
        answer.forEach((absatz, i) => { send({ content: (i === 0 ? "" : "\n\n") + absatz }, null); });
        send({}, "stop");
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", (e) => { reject(new Error(`Port ${FAKE_PORT} nicht bindbar: ${(e as Error).message}`)); });
    server.listen(FAKE_PORT, "127.0.0.1", resolve);
  });
  return {
    setAnswer: (a) => { answer = a; },
    close: () => new Promise<void>((r) => { server.close(() => { r(); }); }),
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
  await setPluginSetting(ws, PLUGIN_ID, "endpoints", [{ url: `http://127.0.0.1:${FAKE_PORT}` }]);
  await setPluginSetting(ws, PLUGIN_ID, "model", FAKE_MODEL);
  await setPluginSetting(ws, PLUGIN_ID, "lastDials", { directness: 0, context: 0, social: 0, semantics: 0 });
  await ws.evaluate(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; p.invalidateEndpointCache(); await p.resolveEndpoint(); return { ok: true };`);
}

async function aufraeumen(ws: Cdp): Promise<void> {
  await ws.evaluate(`
    app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    if (p) {
      p.settings.endpoints = [{ url: "http://127.0.0.1:1234" }];
      p.settings.model = "";
      p.settings.lastDials = { directness: 0, context: 0, social: 0, semantics: 0 };
      await p.saveSettings();
      p.invalidateEndpointCache();
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

async function tune(ws: Cdp, selector = ".lt-run"): Promise<void> {
  await clickReal(ws, `document.querySelector(${q(selector)})`);
  const fertig = await pollUntil<{ ok: boolean }>(ws, `
    const s = document.querySelector(".lt-status");
    return s && s.classList.contains("is-ok") ? { ok: true } : null;
  `, 30_000, 300);
  if (fertig === null) throw new Error("Lauf wird nicht fertig (Status nie is-ok)");
  await sleep(500);
}

async function notiz(ws: Cdp, text: string): Promise<void> {
  await ws.evaluate(`
    const el = document.querySelector(".lt-note");
    el.value = ${q(text)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  `);
}

// --- Motive ----------------------------------------------------------------------------
type Motiv = { name: string; datei: string; thumb: boolean; nimm: (ws: Cdp, fake: Fake, port: number) => Promise<Buffer> };

async function ganzesFenster(ws: Cdp): Promise<Buffer> {
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
      await tune(ws);
      return ganzesFenster(ws);
    },
  },
  {
    name: "rounds", datei: "rounds.png", thumb: false,
    nimm: async (ws, fake) => {
      fake.setAnswer(ANSWERS.clarity);
      await panelZustand(ws);
      await oeffneMitMarkierung(ws);
      // Runden-Zeilen tragen Herkunft UND Notiz; in der Standardbreite der Sidebar wird die
      // zweite links abgeschnitten (Befund an den Master gemeldet) — das Bild zeigt eine breitere.
      await ws.evaluate(`app.workspace.rightSplit.setSize(460); return { ok: true };`);
      await sleep(500);
      await waehlePreset(ws, "Maximum clarity");
      await tune(ws);
      fake.setAnswer(ANSWERS.refined);
      await notiz(ws, "Keep the offer of another day.");
      await tune(ws, ".lt-refine");
      return ganzesFenster(ws);
    },
  },
  {
    name: "dials", datei: "dials.png", thumb: true,
    nimm: async (ws) => {
      await panelZustand(ws);
      await oeffneMitMarkierung(ws);
      await waehlePreset(ws, "Collegial");
      const box = await boxAround(ws, [".lt-sources", ".lt-outputs"], 4);
      if (!box) throw new Error("Panel-Bereiche nicht gefunden");
      return capture(ws, box, 2);
    },
  },
];

/** Einstellungen: ab Obsidian 1.13 ein eigenes Fenster ohne `window.app`. */
async function settingsBild(ws: Cdp, port: number, outDir: string): Promise<string> {
  await ws.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
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
    await pollUntil<{ ok: boolean }>(fenster, `return document.body.textContent.includes("Endpoints") ? { ok: true } : null;`, 10_000, 250);
    await sleep(2500);   // die Statusleuchte der Endpunkt-Zeile kommt asynchron
    // Der Tab ist laenger als der Bildschirm: gezeigt wird die Inhaltsspalte von „Connection" bis
    // zum Ende der Gruppe „Style" (Ausgabe-Gruppe steht in der README-Tabelle).
    const stil = await boxAround(fenster, [".vertical-tab-content .setting-item"], 0);
    const bis = await fenster.evaluate<{ y: number }>(`
      const namen = [...document.querySelectorAll(".setting-item-name")];
      const out = namen.find((e) => (e.textContent || "").trim() === "Output");
      return { y: out ? out.getBoundingClientRect().top : -1 };
    `);
    if (!stil || bis.y < 0) throw new Error("Einstellungs-Inhalt nicht gefunden");
    const von = await fenster.evaluate<{ y: number }>(`
      const namen = [...document.querySelectorAll(".setting-item-name, .setting-item-heading, h1, h2, h3")];
      const k = namen.find((e) => (e.textContent || "").trim() === "Connection");
      return { y: k ? k.getBoundingClientRect().top : -1 };
    `);
    if (von.y < 0) throw new Error("Gruppe „Connection“ nicht gefunden");
    const clip: Rect = { x: stil.x - 16, y: von.y - 20, width: stil.width + 32, height: bis.y - von.y };
    const png = await capture(fenster, clip, 2);
    return await writeShot(fenster, "settings.png", png, { outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH });
  } finally {
    if (!modal.m) fenster.close();
    await ws.evaluate(`app.setting.close(); return { ok: true };`).catch(() => undefined);
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

  const port = Number(flag("port") ?? 9222);
  const only = flag("only");
  const outDir = flag("out") ?? "docs/images";

  const ws = await attachTo("workspace", port, VAULT_NAME);
  if (!ws) throw new Error(`Kein Obsidian-Fenster fuer Vault „${VAULT_NAME}" auf Port ${port}`);

  let fake: Fake | null = null;
  try {
    if (process.platform === "darwin") {
      try { execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']); await sleep(1200); }
      catch { console.log("  (Hinweis: osascript activate schlug fehl)"); }
    }
    await requireVisible(ws);

    const sprache = await ws.evaluate<{ lang: string }>(`return { lang: window.moment ? window.moment.locale() : "?" };`);
    if (!sprache.lang.startsWith("en")) {
      throw new Error(`Oberflaeche ist „${sprache.lang}", nicht Englisch — obsidian.json UND localStorage["language"] auf "en", dann Neustart.`);
    }
    const geladen = (await ws.evaluate<{ g: boolean }>(`return { g: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]) };`)).g;
    if (!geladen) {
      // Frisches Profil = Restricted Mode: jede Einzelpruefung gibt Entwarnung, nur plugins ist leer.
      await ws.evaluate(`
        if (app.plugins.setEnable) await app.plugins.setEnable(true);
        await app.plugins.enablePluginAndSave(${q(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 1200));
        return { ok: true };
      `);
    }
    // Helles Theme zur Laufzeit: obsidian.json/appearance.json greifen bei laufender Instanz nicht.
    await setAppConfig(ws, "theme", "moonstone");
    await setWindowSize(ws, WINDOW.width, WINDOW.height);
    await sleep(600);

    fake = await startFakeModel();
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
