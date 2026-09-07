/**
 * Lab: faehrt die Beispielpaare (oder eine Regler-Kombination) gegen einen lokalen Endpunkt
 * und zeigt, was das Modell daraus macht — mehrfach, denn EIN Lauf ist eine Anekdote.
 *
 *   npm run lab:tune -- --endpoint http://127.0.0.1:1234 --model qwen3.6-35b-a3b --lang de --runs 3
 *   npm run lab:tune -- --dim social --level 2 --text "Die Rechnung ist faellig." --runs 5
 *
 * Diagnostiziert die Reasoning-Herkunft (reasoning_content-Kanal / <think>-Tag / Klartext) —
 * Muster: vim-dojo/scripts/debrief-lab.mjs. Kein Test, kein Gate: ein Messwerkzeug.
 */
import { buildMessages, examplesFor } from "../src/core/prompt";
import { NEUTRAL, type Dials, type Dimension, type Level } from "../src/core/dials";
import { suppressParams } from "../src/vendor/kit/reasoning";
import type { Lang } from "../src/vendor/kit/i18n";

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const ENDPOINT = argOf("endpoint", "http://127.0.0.1:1234").replace(/\/+$/, "").replace(/\/v1$/, "");
const MODEL = argOf("model", "");
const LANG = argOf("lang", "de") as Lang;
const RUNS = Number(argOf("runs", "3"));
const DIM = argOf("dim", "") as Dimension | "";
const LEVEL = Number(argOf("level", "0")) as Level;
const TEXT = argOf("text", "");
const THINK = args.includes("--think");

interface Case { label: string; text: string; dials: Dials; expected: string | null }

function cases(): Case[] {
  if (DIM !== "" && TEXT !== "") return [{ label: `${DIM}:${LEVEL}`, text: TEXT, dials: { ...NEUTRAL, [DIM]: LEVEL }, expected: null }];
  return examplesFor(LANG)
    .filter((p) => DIM === "" || p.dimension === DIM)
    .map((p) => ({ label: `${p.dimension}:${p.level}`, text: p.before, dials: { ...NEUTRAL, [p.dimension]: p.level }, expected: p.after }));
}

async function call(text: string, dials: Dials): Promise<{ content: string; reasoning: string; origin: string; ms: number }> {
  const body = { model: MODEL, messages: buildMessages(text, dials, { lang: LANG }), stream: false, temperature: 0.3, ...suppressParams(!THINK) };
  const t0 = Date.now();
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
  const msg = json.choices?.[0]?.message ?? {};
  let content = msg.content ?? "";
  let reasoning = msg.reasoning_content ?? "";
  let origin = reasoning ? "reasoning_content" : "none";
  const think = /<think>([\s\S]*?)<\/think>/.exec(content);
  if (think !== null) { reasoning = think[1] ?? ""; content = content.replace(think[0], "").trim(); origin = "<think>"; }
  return { content: content.trim(), reasoning, origin, ms };
}

async function main(): Promise<void> {
  console.log(`Endpoint ${ENDPOINT} · Modell "${MODEL || "(Server)"}" · Sprache ${LANG} · ${RUNS} Laeufe je Fall · Denken ${THINK ? "an" : "aus"}\n`);
  for (const c of cases()) {
    console.log(`=== ${c.label}\n  vorher:   ${c.text}`);
    if (c.expected !== null) console.log(`  erwartet: ${c.expected}`);
    for (let i = 1; i <= RUNS; i++) {
      try {
        const r = await call(c.text, c.dials);
        const unchanged = r.content === c.text ? "  ⚠ UNVERAENDERT" : "";
        console.log(`  #${i} ${r.ms} ms · reasoning: ${r.origin}${r.reasoning ? ` (${r.reasoning.length} Zeichen)` : ""}${unchanged}\n     ${r.content.replace(/\n/g, "\n     ")}`);
      } catch (e) {
        console.log(`  #${i} FEHLER: ${(e as Error).message}`);
      }
    }
    console.log("");
  }
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exitCode = 1; });
