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
import { mobilAus, mobilEin } from "../../tools/obsidian-cdp/chat-layout.js";
import { startLlmStub, type LlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { messeErreichbarkeit } from "../../tools/obsidian-cdp/pflichtpunkte.js";
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
    // Jedes Motiv beginnt ohne Runde, und die Sitzung wird VOR dem Schliessen verworfen: mit offener Runde fragt das Panel beim Schliessen nach (Smoke P2), und der
    // Dialog fing im Mehrmotiv-Lauf den Preset-Klick von „rounds“ ab (Lauf meldete „alle Regler in der Mitte“; einzeln lief jedes Motiv, Welle 38).
    app.plugins.plugins[${q(PLUGIN_ID)}].host.discard();
    app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
    app.workspace.detachLeavesOfType("markdown");
    // Standardbreite zurueck (ein Motiv verbreitert die Sidebar) und leere „Untitled"-Notizen weg:
    // ein Mehrmotiv-Lauf hat einmal eine angelegt, vermutlich durch einen Klick, der nach einer
    // Layout-Aenderung neben das Ziel fiel — die Datei stand danach im Datei-Explorer des Bildes.
    if (typeof app.workspace.rightSplit.setSize === "function") app.workspace.rightSplit.setSize(300);   // die Schublade im Mobil-Modus kennt es nicht
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
  // Der Klick muss ankommen: Chip aktiv und die Regler aus der Mitte (sonst meldet der Lauf spaeter nur „nichts zu aendern“).
  const an = await pollUntil<{ ok: boolean }>(ws, `
    const b = document.querySelectorAll(".lt-preset-chip")[${idx}];
    const werte = [...document.querySelectorAll(".lt-dial-input")].map((i) => i.value);
    return b && b.classList.contains("is-active") && werte.some((w) => w !== "0") ? { ok: true } : null;
  `, 3000, 150);
  if (an === null) {
    const st = await ws.evaluate<unknown>(`const p = app.plugins.plugins[${q(PLUGIN_ID)}]; return { aktiv: [...document.querySelectorAll(".lt-preset-chip.is-active")].map((b) => b.textContent), regler: [...document.querySelectorAll(".lt-dial-input")].map((i) => i.value), lastDials: p.settings.lastDials, panels: document.querySelectorAll(".lt-panel").length, chips: document.querySelectorAll(".lt-preset-chip").length };`);
    throw new Error(`Preset „${name}“ nicht uebernommen: ${JSON.stringify(st)}`);
  }
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
  // Tastaturweg: vom Knopf „New“ (Station 1) mit echter Tab-Taste durch das Panel; jede Station soll in der Reihenfolge des Rahmens kommen.
  await ws.evaluate(`const r = ${ROLLBEREICH}; if (r) r.scrollTop = 0; document.querySelector(".okit-prompt-panel-new").focus(); return { ok: true };`);
  const weg: string[] = [];
  for (let i = 0; i < 40; i++) {
    const el = await ws.evaluate<string>(`const e = document.activeElement; if (!e || !e.closest(".okit-prompt-panel")) return "AUSSERHALB:" + (e ? e.tagName : "-");
      const station = ["okit-prompt-panel-top", "okit-model-bar", "okit-prompt-panel-notices", "okit-prompt-panel-controls", "okit-prompt-panel-input", "okit-prompt-panel-actions", "okit-prompt-panel-stream", "okit-prompt-panel-preview", "okit-prompt-panel-rounds", "okit-prompt-panel-end"].find((c) => e.classList.contains(c) || e.closest("." + c)) || "?";
      return station + " | " + e.tagName.toLowerCase() + " " + ((e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || "").trim().slice(0, 40));`);
    weg.push(el);
    if (el.startsWith("AUSSERHALB")) break;
    await ws.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await ws.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(80);
  }
  const datei = join(outDir, "tastaturweg.txt");
  writeFileSync(datei, weg.join("\n") + "\n");
  geschrieben.push(`${datei} (${weg.length} Schritte)`);
  return geschrieben;
}

// --- Pruefbilder im Mobil-Modus (Telefongroesse) ------------------------------------------
/** Das Panel im Mobil-Modus von Obsidian (Emulation, `tools/obsidian-cdp/chat-layout.ts`: `mobilEin`/`mobilAus`) bei 390 x 844 und 320 x 568, hell und dunkel,
 *  bereit und nach einem Lauf, je oben und ganz nach unten gerollt, mit Massen aus dem DOM (Ausreisser, Ueberlauf, Tippflaechen, Erreichbarkeit) und einer
 *  Gegenprobe (ein Element auf 600 px). Ersatz fuer einen Blick am iPhone, kein Beleg fuer WebKit oder die Bildschirmtastatur.
 *  Aufruf: `npm run shots -- --port <p> --only pruef-mobil --bilder <ordner>` (Rezept: Kopf von `docs/internal/SMOKE.md`, `messlauf.sh` mit RUNNER=shots). */
const TELEFONE = [{ breite: 390, hoehe: 844 }, { breite: 320, hoehe: 568 }] as const;
const MIN_TIPP = 44;
/** Bedienelemente des Panels, die ein Daumen trifft (sichtbare werden mit `data-mob` markiert, `messeErreichbarkeit` liest die Marke). */
const BEDIENBAR = `button, input, select, textarea, a[href], summary, [role="button"], [role="slider"], [role="tab"], .clickable-icon, [tabindex]:not([tabindex="-1"])`;

/** Misst im Renderer: (a) Ausreisser, (b) waagerechter Ueberlauf, (c) Tippflaechen, (d-statisch) Abschneidung durch Vorfahren, plus Beschriftungen, die ihr Kasten kappt. Markiert Bedienelemente (`data-mob`) und den Rollbereich (`data-mob-roll`). */
const MESS_PANEL = `
  const root = document.querySelector(".lt-panel");
  if (!root) return { fehler: "kein .lt-panel im DOM" };
  const rr = root.getBoundingClientRect();
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const sel = (e) => { const t = []; let x = e; while (x && x !== root && t.length < 4) { const k = [...x.classList].filter((c) => !c.startsWith("is-")).slice(0, 2).join("."); t.unshift(x.tagName.toLowerCase() + (k ? "." + k : "")); x = x.parentElement; } return t.join(" > "); };
  const txt = (e) => ((e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || "").trim().replace(/\\s+/g, " ").slice(0, 28));
  for (const m of document.querySelectorAll("[data-mob], [data-mob-roll]")) { m.removeAttribute("data-mob"); m.removeAttribute("data-mob-roll"); }
  // Rollbereich: erster Vorfahr des Panel-Rahmens, der rollt
  let roll = null; { let el = document.querySelector(".okit-prompt-panel") || root; while (el && el !== document.body) { const o = getComputedStyle(el).overflowY; if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) { roll = el; break; } el = el.parentElement; } }
  if (roll) roll.setAttribute("data-mob-roll", "1");
  const klippVorfahr = (e) => { let x = e.parentElement; while (x && x !== document.body) { const cs = getComputedStyle(x); if (cs.overflowX !== "visible") { const r = x.getBoundingClientRect(); if (r.right <= rr.right + 1 && r.left >= rr.left - 1) return sel(x) + " (" + cs.overflowX + ")"; } if (x === root) break; x = x.parentElement; } return null; };
  // (a)
  const ausreisser = [];
  const alle = [...root.querySelectorAll("*")].filter(sichtbar);
  for (const e of alle) {
    const r = e.getBoundingClientRect();
    const rechts = r.right - rr.right; const links = rr.left - r.left; const vp = r.right - innerWidth;
    if (rechts > 1 || links > 1 || vp > 1) ausreisser.push({ sel: sel(e), text: txt(e), rechts: Math.round(rechts), links: Math.round(links), ueberViewport: Math.round(vp), geklippt: klippVorfahr(e) });
  }
  // (b)
  const ueberlauf = [];
  const pruefe = (name, e) => { if (e.scrollWidth > e.clientWidth + 1) ueberlauf.push({ wo: name, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, overflowX: getComputedStyle(e).overflowX }); };
  pruefe("document.documentElement", document.documentElement); pruefe("document.body", document.body);
  { let x = root; while (x && x !== document.body) { pruefe(x === root ? ".lt-panel (Wurzel)" : "Vorfahr " + [x.tagName.toLowerCase(), ...[...x.classList].slice(0, 2)].join("."), x); x = x.parentElement; } }
  for (const e of alle) { const ox = getComputedStyle(e).overflowX; if ((ox === "auto" || ox === "scroll") && e.scrollWidth > e.clientWidth + 1) ueberlauf.push({ wo: "innen " + sel(e), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, overflowX: ox }); }
  // (c) Tippflaechen; die Kit-Regel vergroessert manche per ::after (position absolute), das zaehlt als Treffflaeche
  const bed = [...new Set([...root.querySelectorAll(${JSON.stringify(BEDIENBAR)}), ...(root.matches(${JSON.stringify(BEDIENBAR)}) ? [root] : [])])];
  const tipp = []; let unsichtbar = 0; let n = 0;
  for (const e of bed) {
    if (!sichtbar(e)) { unsichtbar += 1; continue; }
    n += 1; e.setAttribute("data-mob", "1");
    const r = e.getBoundingClientRect(); let w = r.width; let h = r.height;
    const a = getComputedStyle(e, "::after"); let nachAfter = false;
    if (a.content !== "none" && a.position === "absolute") { const aw = parseFloat(a.width); const ah = parseFloat(a.height); if (aw > w || ah > h) nachAfter = true; w = Math.max(w, aw || 0); h = Math.max(h, ah || 0); }
    tipp.push({ sel: sel(e), text: txt(e), typ: e.tagName.toLowerCase() + (e.getAttribute("type") ? "[" + e.getAttribute("type") + "]" : ""), roh: [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10], wirksam: [Math.round(w * 10) / 10, Math.round(h * 10) / 10], afterVergroessert: nachAfter });
  }
  // (d, statisch) Teile eines Bedienelements ausserhalb eines Vorfahren mit overflow hidden/clip (nicht rollbar), bei Rolle ganz oben
  const abgeschnitten = [];
  for (const e of bed) {
    if (!sichtbar(e)) continue;
    const r = e.getBoundingClientRect();
    let x = e.parentElement;
    while (x && x !== document.body) {
      const cs = getComputedStyle(x);
      const ar = x.getBoundingClientRect();
      if (cs.overflowX === "hidden" || cs.overflowX === "clip") { if (r.right > ar.right + 1 || r.left < ar.left - 1) { abgeschnitten.push({ sel: sel(e), text: txt(e), achse: "x", vorfahr: sel(x) || x.className, ueberstand: Math.round(Math.max(r.right - ar.right, ar.left - r.left)) }); break; } }
      if (x === root) break;
      x = x.parentElement;
    }
  }
  // Beschriftungen, die ihr Kasten kappt (overflow hidden/ellipsis, Text breiter als der Kasten)
  const gekappt = [];
  for (const e of alle) { const cs = getComputedStyle(e); if ((cs.overflowX === "hidden" || cs.overflowX === "clip") && e.scrollWidth > e.clientWidth + 1 && (e.textContent || "").trim() !== "") gekappt.push({ sel: sel(e), text: txt(e), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, ellipsis: cs.textOverflow === "ellipsis" }); }
  return {
    viewport: [innerWidth, innerHeight], body: [...document.body.classList].filter((c) => c === "is-mobile" || c === "is-phone" || c === "is-tablet").join(" "),
    panel: [Math.round(rr.left), Math.round(rr.right), Math.round(rr.width)],
    roll: roll ? { sel: sel(roll) || roll.className, scrollHeight: roll.scrollHeight, clientHeight: roll.clientHeight } : null,
    ausreisser, ueberlauf, bedienelemente: n, unsichtbareBedienelemente: unsichtbar, tipp, abgeschnitten, gekappt,
  };
`;

interface MobMasse {
  fehler?: string; viewport: [number, number]; body: string; panel: [number, number, number];
  roll: { sel: string; scrollHeight: number; clientHeight: number } | null;
  ausreisser: { sel: string; text: string; rechts: number; links: number; ueberViewport: number; geklippt: string | null }[];
  ueberlauf: { wo: string; scrollWidth: number; clientWidth: number; overflowX: string }[];
  bedienelemente: number; unsichtbareBedienelemente: number;
  tipp: { sel: string; text: string; typ: string; roh: [number, number]; wirksam: [number, number]; afterVergroessert: boolean }[];
  abgeschnitten: { sel: string; text: string; achse: string; vorfahr: string; ueberstand: number }[];
  gekappt: { sel: string; text: string; scrollWidth: number; clientWidth: number; ellipsis: boolean }[];
}

/** Wo landet das Panel? Blatt, Wurzel, Schublade, Lage und Masse. */
const LANDEPLATZ = `
  const leaf = app.workspace.getLeavesOfType(${q(VIEW_TYPE)})[0];
  if (!leaf) return { da: false };
  const root = leaf.getRoot();
  const name = root === app.workspace.rightSplit ? "rightSplit" : root === app.workspace.leftSplit ? "leftSplit" : root === app.workspace.rootSplit ? "rootSplit" : "?";
  const drawer = leaf.view.containerEl.closest(".workspace-drawer");
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return { da: true, wurzel: name, wurzelKlasse: root.constructor.name, drawerKlassen: drawer ? drawer.className : null, drawerRect: r(drawer), blattRect: r(leaf.view.containerEl), sichtbarImDokument: Boolean(leaf.view.containerEl.offsetParent), drawerKollabiert: root.collapsed, body: [...document.body.classList].filter((c) => /^(is-mobile|is-phone|is-tablet|is-floating-nav)$/.test(c)).join(" ") };
`;

async function pruefMobil(halter: { ws: Cdp }, fake: Fake, outDir: string, port: number): Promise<string[]> {
  if (outDir === "docs/images") throw new Error("--only pruef-mobil braucht --bilder <ordner> (Pruefbilder gehoeren nicht nach docs/images)");
  mkdirSync(outDir, { recursive: true });
  const geschrieben: string[] = [];
  const zeilen: string[] = [];
  const aus = (z: string): void => { console.log(z); zeilen.push(z); };
  const alleMasse: Record<string, unknown> = {};
  const anhaengen = async (): Promise<Cdp> => {
    const neu = await attachTo("workspace", port, VAULT_NAME);
    if (!neu) throw new Error("nach dem Neuladen kein Fenster");
    await requireVisible(neu);
    await bereiteInstanzVor(neu, { pluginIds: [PLUGIN_ID], nurVault: VAULT_NAME, sprache: "en" });
    return neu;
  };
  const metriken = async (ws: Cdp, breite: number, hoehe: number): Promise<void> => {
    await ws.send("Emulation.setDeviceMetricsOverride", { width: breite, height: hoehe, deviceScaleFactor: 2, mobile: true });
    await sleep(1000);
  };
  let mobil = false;
  try {
    halter.ws = await mobilEin(halter.ws, anhaengen, { breite: TELEFONE[0].breite, hoehe: TELEFONE[0].hoehe });
    mobil = true;
    let ws = halter.ws;
    const flags = await ws.evaluate<{ mobile: boolean; phone: boolean; tablet: boolean; w: number; h: number }>(`return { mobile: document.body.classList.contains("is-mobile"), phone: document.body.classList.contains("is-phone"), tablet: document.body.classList.contains("is-tablet"), w: innerWidth, h: innerHeight };`);
    aus(`Mobil-Emulation: is-mobile ${flags.mobile} · is-phone ${flags.phone} · is-tablet ${flags.tablet} · Fenster ${flags.w}x${flags.h}`);
    if (!flags.mobile) throw new Error("is-mobile nicht gesetzt");
    if (!flags.phone) throw new Error(`is-phone nicht gesetzt bei ${flags.w}x${flags.h} (Klassen: ${flags.tablet ? "is-tablet" : "keine Telefonklasse"}) - die Messung waere keine Telefonmessung`);
    await ws.evaluate(`app.vault.setConfig("nativeMenus", false); return { ok: true };`);

    // Landeplatz: der Weg des Befehls „LingoTuner: Open style interpreter“, auf leerem Blatt (ohne Markierung)
    fake.setAnswer(ANSWERS.clarity);
    await panelZustand(ws);
    await ws.evaluate(`app.commands.executeCommandById(${q(`${PLUGIN_ID}:open-panel`)}); return { ok: true };`);
    const da0 = await pollUntil<{ ok: boolean }>(ws, `return document.querySelector(".lt-panel") ? { ok: true } : null;`, 10_000, 300);
    if (da0 === null) throw new Error("Open style interpreter oeffnet im Mobil-Modus kein Panel");
    await sleep(900);
    const platz = await ws.evaluate<Record<string, unknown>>(LANDEPLATZ);
    aus(`Landeplatz (Befehl Open style interpreter, kein Editor offen): ${JSON.stringify(platz)}`);
    alleMasse["landeplatz"] = platz;
    await panelZustand(ws);
    await oeffneMitMarkierung(ws);
    await sleep(500);
    const platz2 = await ws.evaluate<Record<string, unknown>>(LANDEPLATZ);
    aus(`Landeplatz (Befehl Tune selection, Markierung gesetzt): ${JSON.stringify(platz2)}`);
    alleMasse["landeplatzMitMarkierung"] = platz2;
    await waehlePreset(ws, "Maximum clarity");

    const reihe = async (stand: string): Promise<void> => {
      for (const tel of TELEFONE) {
        await metriken(ws, tel.breite, tel.hoehe);
        const f2 = await ws.evaluate<{ phone: boolean; mobile: boolean }>(`return { phone: document.body.classList.contains("is-phone"), mobile: document.body.classList.contains("is-mobile") };`);
        if (!f2.mobile || !f2.phone) aus(`  ! ${tel.breite}x${tel.hoehe}: is-mobile ${f2.mobile}, is-phone ${f2.phone} (Messung gilt nur mit beiden)`);
        for (const thema of ["moonstone", "obsidian"] as const) {
          await setAppConfig(ws, "theme", thema);
          await sleep(400);
          const tag = `${stand}-${thema === "moonstone" ? "hell" : "dunkel"}-${tel.breite}`;
          const rolle = async (lage: "oben" | "unten"): Promise<boolean> => {
            const m = await ws.evaluate<{ rollt: boolean }>(`const r = document.querySelector("[data-mob-roll]") || ${ROLLBEREICH}; if (r) r.scrollTop = ${lage === "oben" ? 0 : "r.scrollHeight"}; return { rollt: Boolean(r) };`);
            await sleep(300);
            return m.rollt;
          };
          // Masse zuerst (markiert den Rollbereich), dann Bilder
          await rolle("oben");
          const masse = await ws.evaluate<MobMasse>(MESS_PANEL);
          if (masse.fehler) throw new Error(masse.fehler);
          alleMasse[tag] = masse;
          // Erreichbarkeit: jedes sichtbare Bedienelement nach scrollIntoView mit elementFromPoint auf sich selbst (Baustein pflichtpunkte.ts)
          const erreich = await messeErreichbarkeit(ws, { selektoren: ["[data-mob]"], ueberlauf: "[data-mob-roll]", ohneUeberlauf: "Rollbereich passt in die Hoehe", scrollen: true });
          alleMasse[tag + "-erreichbar"] = erreich;
          await rolle("oben");
          const bild = async (lage: string): Promise<void> => {
            await mausWeg(ws);
            const datei = join(outDir, `pruef-mobil-${tag}-${lage}.png`);
            writeFileSync(datei, await capture(ws, undefined, 1));
            geschrieben.push(`${datei} (Fenster ${masse.viewport.join("x")}, Panel ${masse.panel[2]} px breit, Rollbereich ${masse.roll ? `${masse.roll.scrollHeight}/${masse.roll.clientHeight}` : "keiner"})`);
          };
          await bild("oben");
          if (masse.roll) { await rolle("unten"); await bild("unten"); await rolle("oben"); }
          // Tabelle
          const klein = masse.tipp.filter((x) => x.wirksam[0] < MIN_TIPP || x.wirksam[1] < MIN_TIPP);
          const kleinRoh = masse.tipp.filter((x) => x.roh[0] < MIN_TIPP || x.roh[1] < MIN_TIPP).length;
          aus(`\n## ${tag} (${masse.viewport.join("x")}, Panel x ${masse.panel[0]}-${masse.panel[1]} = ${masse.panel[2]} px, ${masse.body})`);
          aus(`(a) Ausreisser rechts/links/ueber Viewport: ${masse.ausreisser.length}${masse.ausreisser.length ? " -> " + masse.ausreisser.slice(0, 12).map((x) => `${x.sel} [${x.text}] r${x.rechts} l${x.links} v${x.ueberViewport}${x.geklippt ? " geklippt von " + x.geklippt : ""}`).join(" | ") : ""}`);
          aus(`(b) waagerechter Ueberlauf: ${masse.ueberlauf.length === 0 ? "keiner" : masse.ueberlauf.map((x) => `${x.wo} ${x.scrollWidth}>${x.clientWidth} (${x.overflowX})`).join(" | ")}`);
          aus(`(c) Tippflaechen: ${masse.bedienelemente} sichtbare Bedienelemente (${masse.unsichtbareBedienelemente} ohne Flaeche), davon unter ${MIN_TIPP} px wirksam: ${klein.length} (roh: ${kleinRoh})`);
          for (const k of klein) aus(`     ${k.typ} ${k.sel} [${k.text}] roh ${k.roh.join("x")} wirksam ${k.wirksam.join("x")}${k.afterVergroessert ? " (::after)" : ""}`);
          aus(`(d) Erreichbarkeit: ${erreich.urteil} - ${erreich.detail}`);
          aus(`    Abschneidung durch Vorfahr mit overflow hidden/clip: ${masse.abgeschnitten.length === 0 ? "keine" : masse.abgeschnitten.map((x) => `${x.sel} [${x.text}] ${x.achse} ${x.ueberstand} px aus ${x.vorfahr}`).join(" | ")}`);
          aus(`    Beschriftungen vom Kasten gekappt: ${masse.gekappt.length === 0 ? "keine" : masse.gekappt.map((x) => `${x.sel} [${x.text}] ${x.scrollWidth}>${x.clientWidth}${x.ellipsis ? " ellipsis" : ""}`).join(" | ")}`);
          // (e) Gegenprobe: ein Element auf 600 px, einmal je Telefon und Stand (hell)
          if (thema === "moonstone") {
            // Kandidaten der Reihe nach: das erste Element, das wirklich auf >= 590 px waechst, traegt die Probe (ein Element, das CSS bei der Breite haelt, beweist nichts).
            const gp = await ws.evaluate<{ gesetzt: boolean; element: string; vorher: number; nachher: number; a: number; b: number; wo: string[]; rechts: number; versuche: string[] }>(`
              const kandidaten = [".okit-prompt-panel-send", ".okit-prompt-panel-input", ".lt-controls", ".okit-prompt-panel-top", ".lt-dials"];
              const versuche = [];
              for (const k of kandidaten) {
                const el = document.querySelector(k);
                if (!el) { versuche.push(k + ": fehlt"); continue; }
                const alt = el.getAttribute("style");
                const vorher = el.getBoundingClientRect().width;
                el.style.setProperty("width", "600px", "important");
                await new Promise((r) => setTimeout(r, 300));
                const nachher = el.getBoundingClientRect().width;
                if (nachher < 590) { versuche.push(k + ": width 600px ergibt " + Math.round(nachher) + " px (max-width " + getComputedStyle(el).maxWidth + ", flex " + getComputedStyle(el).flex + ")"); if (alt === null) el.removeAttribute("style"); else el.setAttribute("style", alt); continue; }
                const m = await (async () => { ${MESS_PANEL} })();
                if (alt === null) el.removeAttribute("style"); else el.setAttribute("style", alt);
                await new Promise((r) => setTimeout(r, 300));
                return { gesetzt: true, element: k, vorher: Math.round(vorher), nachher: Math.round(nachher), a: m.ausreisser.length, b: m.ueberlauf.length, wo: m.ueberlauf.map((x) => x.wo + " " + x.scrollWidth + ">" + x.clientWidth).slice(0, 4), rechts: Math.max(0, ...m.ausreisser.map((x) => x.rechts)), versuche };
              }
              return { gesetzt: false, element: "", vorher: 0, nachher: 0, a: 0, b: 0, wo: [], rechts: 0, versuche };
            `);
            const ok = gp.gesetzt && gp.a > 0 && gp.b > 0;
            aus(`(e) Gegenprobe ${gp.gesetzt ? `${gp.element} von ${gp.vorher} auf ${gp.nachher} px (width 600px)` : "ohne tragendes Element"}: Ausreisser ${gp.a} (groesster rechts +${gp.rechts} px), Ueberlauf ${gp.b} ${gp.wo.length ? "(" + gp.wo.join(" | ") + ")" : ""} -> ${ok ? "beide Messungen melden es" : gp.gesetzt ? "MESSUNG BLIND (a oder b meldet nichts)" : "KEIN Element liess sich verbreitern"}${gp.versuche.length ? " | verworfen: " + gp.versuche.join("; ") : ""}`);
            alleMasse[tag + "-gegenprobe"] = gp;
            // zurueck zum Normalzustand: die Marken neu setzen
            await ws.evaluate(MESS_PANEL);
          }
        }
      }
      await setAppConfig(ws, "theme", "moonstone");
      await metriken(ws, TELEFONE[0].breite, TELEFONE[0].hoehe);
    };
    await reihe("bereit");
    await tune(ws, 0);
    await reihe("ergebnis");
    writeFileSync(join(outDir, "masse.json"), JSON.stringify(alleMasse, null, 2));
    writeFileSync(join(outDir, "masse.txt"), zeilen.join("\n") + "\n");
    geschrieben.push(`${join(outDir, "masse.txt")} (Tabelle), ${join(outDir, "masse.json")} (Rohdaten)`);
  } finally {
    if (mobil) {
      await mobilAus(halter.ws, { schema: "moonstone" }).catch(() => undefined);
      await sleep(4000);
      try { halter.ws.close(); } catch { /* Kontext weg */ }
      halter.ws = await anhaengen();
      const nochMobil = await halter.ws.evaluate<boolean>(`return document.body.classList.contains("is-mobile");`).catch(() => true);
      if (nochMobil) console.log("  ! is-mobile steht nach mobilAus noch (Profil danach nicht wiederverwenden)");
    }
  }
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

  const erstes = await attachTo("workspace", port, VAULT_NAME);
  if (!erstes) throw new Error(`Kein Obsidian-Fenster fuer Vault „${VAULT_NAME}" auf Port ${port}`);
  const halter: { ws: Cdp } = { ws: erstes };   // der Mobil-Lauf laedt Obsidian neu und tauscht die Verbindung
  let ws = erstes;

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
    if (only === "pruef-mobil") {
      try { for (const zeile of await pruefMobil(halter, fake, outDir, port)) console.log("  ✓", zeile); } finally { ws = halter.ws; }
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
