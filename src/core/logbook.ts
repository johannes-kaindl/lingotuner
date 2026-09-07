import { t } from "../vendor/kit/i18n";
import type { Dials } from "./dials";

export interface LogEntry { at: Date; model: string; dials: Dials; note: string; input: string; output: string }

/** Frontmatter-Keys bleiben englisch und unuebersetzt — sie persistieren im Nutzer-Vault. */
export const LOGBOOK_FRONTMATTER = "---\ntype: lingotuner-log\n---\n";

const pad = (n: number): string => String(n).padStart(2, "0");

export function logbookPath(folder: string, at: Date): string {
  const f = folder.trim().replace(/\/+$/, "");
  const file = `LingoTuner ${at.getFullYear()}-${pad(at.getMonth() + 1)}.md`;
  return f === "" ? file : `${f}/${file}`;
}

const quote = (s: string): string => s.split("\n").map((l) => `> ${l}`).join("\n");

export function renderLogEntry(e: LogEntry): string {
  const stamp = `${e.at.getFullYear()}-${pad(e.at.getMonth() + 1)}-${pad(e.at.getDate())} ${pad(e.at.getHours())}:${pad(e.at.getMinutes())}`;
  const d = e.dials;
  const lines = [
    "",
    t("logbook.heading", stamp, e.model || "–"),
    "",
    t("logbook.dials", String(d.directness), String(d.context), String(d.social), String(d.semantics)),
  ];
  if (e.note.trim() !== "") lines.push(t("logbook.note", e.note.trim()));
  lines.push("", `**${t("logbook.original")}**`, "", quote(e.input), "", `**${t("logbook.result")}**`, "", quote(e.output), "");
  return lines.join("\n");
}
