/** Override-Ordner im Vault: „leer heisst Auslieferungsstand" (REGISTRY, n=2: yijing-oracle, koda-agent).
 *  Kein Automatismus kopiert den Auslieferungsstand hinein — nur der Knopf in den Settings. */
import { DIMENSIONS, type Dimension } from "../dials";
import { examplesFor, type PromptOverrides } from "../prompt";
import { exampleKey, type ExampleLevel } from "./types";
import { PROMPT_TEXT } from "../prompt-text";
import type { Lang } from "../../vendor/kit/i18n";

export interface OverrideReader { read(path: string): Promise<string | null> }
export interface OverrideWriter {
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}

export const SYSTEM_FILE = "system.md";
const EXAMPLE_LEVELS: readonly ExampleLevel[] = [-2, -1, 1, 2];

export function exampleFileName(dim: Dimension, level: ExampleLevel): string {
  return `${dim}_${level}.md`;
}

function joinPath(folder: string, file: string): string {
  const f = folder.trim().replace(/\/+$/, "");
  return f === "" ? file : `${f}/${file}`;
}

export function parseExampleFile(text: string): { before: string; after: string } | null {
  const m = /^##\s*before\s*$([\s\S]*?)^##\s*after\s*$([\s\S]*)$/im.exec(text.replace(/\r\n/g, "\n"));
  if (m === null) return null;
  const before = (m[1] ?? "").trim();
  const after = (m[2] ?? "").trim();
  if (before === "" || after === "") return null;
  return { before, after };
}

export function renderExampleFile(pair: { before: string; after: string }): string {
  return `## before\n\n${pair.before}\n\n## after\n\n${pair.after}\n`;
}

export function renderSystemFile(lang: Lang): string {
  const t = PROMPT_TEXT[lang];
  return [t.role, "", ...t.invariants.map((s) => `- ${s}`), ""].join("\n");
}

export async function loadOverrides(
  reader: OverrideReader,
  folder: string,
): Promise<{ overrides: PromptOverrides; problems: string[] }> {
  const overrides: PromptOverrides = {};
  const problems: string[] = [];
  if (folder.trim() === "") return { overrides, problems };

  const system = await reader.read(joinPath(folder, SYSTEM_FILE));
  if (system !== null && system.trim() !== "") overrides.system = system.trim();

  for (const d of DIMENSIONS) {
    for (const l of EXAMPLE_LEVELS) {
      const path = joinPath(folder, exampleFileName(d, l));
      const raw = await reader.read(path);
      if (raw === null) continue;
      const pair = parseExampleFile(raw);
      if (pair === null) { problems.push(path); continue; }
      overrides.examples ??= {};
      overrides.examples[exampleKey(d, l)] = pair;
    }
  }
  return { overrides, problems };
}

/** Schreibt system.md + 16 Beispieldateien, ueberspringt Vorhandenes. Liefert die Zahl der Neuanlagen. */
export async function writeShippedTexts(writer: OverrideWriter, folder: string, lang: Lang): Promise<number> {
  await writer.ensureFolder(folder);
  let written = 0;
  const put = async (file: string, content: string): Promise<void> => {
    const path = joinPath(folder, file);
    if (await writer.exists(path)) return;
    await writer.write(path, content);
    written += 1;
  };
  await put(SYSTEM_FILE, renderSystemFile(lang));
  for (const p of examplesFor(lang)) {
    await put(exampleFileName(p.dimension, p.level), renderExampleFile({ before: p.before, after: p.after }));
  }
  return written;
}
