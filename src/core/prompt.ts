import { DIMENSIONS, type Dials } from "./dials";
import { EXAMPLES_DE } from "./examples/de";
import { EXAMPLES_EN } from "./examples/en";
import { exampleKey, type ExampleKey, type ExamplePair } from "./examples/types";
import { PROMPT_TEXT } from "./prompt-text";
import type { Lang } from "../vendor/kit/i18n";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface PromptOverrides {
  system?: string;
  examples?: Partial<Record<ExampleKey, { before: string; after: string }>>;
}

export interface BuildOptions {
  note?: string;
  lang: Lang;
  overrides?: PromptOverrides;
}

export function examplesFor(lang: Lang): readonly ExamplePair[] {
  return lang === "de" ? EXAMPLES_DE : EXAMPLES_EN;
}

function pairFor(lang: Lang, key: ExampleKey, overrides?: PromptOverrides): { before: string; after: string } {
  const o = overrides?.examples?.[key];
  if (o !== undefined) return o;
  const p = examplesFor(lang).find((e) => exampleKey(e.dimension, e.level) === key);
  // Die Beispielbank ist per Test vollstaendig (16/16) — ein Miss waere ein Programmierfehler.
  if (p === undefined) throw new Error(`example missing: ${key}`);
  return { before: p.before, after: p.after };
}

/** Der stabile Teil des Prompts: Rolle, Invarianten, Regler-Anweisungen mit Beispielen.
 *  Ohne Anmerkung — die ist Nutzereingabe und gehoert nicht in den Fassungsvergleich (llm-lab). */
export function systemPrompt(dials: Dials, opts: BuildOptions): string {
  const text = PROMPT_TEXT[opts.lang];
  const head = opts.overrides?.system?.trim() || [text.role, "", ...text.invariants.map((s) => `- ${s}`)].join("\n");
  const blocks: string[] = [];
  for (const d of DIMENSIONS) {
    const level = dials[d];
    if (level === 0) continue;
    const pair = pairFor(opts.lang, exampleKey(d, level), opts.overrides);
    blocks.push([
      `- ${text.levels[d][level]}`,
      `  ${text.exampleBefore} ${pair.before}`,
      `  ${text.exampleAfter} ${pair.after}`,
    ].join("\n"));
  }
  const parts = [head];
  if (blocks.length > 0) parts.push("", text.instructionsHead, ...blocks);
  return parts.join("\n");
}

export function buildMessages(text: string, dials: Dials, opts: BuildOptions): ChatMessage[] {
  const note = opts.note?.trim() ?? "";
  let system = systemPrompt(dials, opts);
  if (note !== "") system += `\n\n${PROMPT_TEXT[opts.lang].noteHead}\n${note}`;
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}
