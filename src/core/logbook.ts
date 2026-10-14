import { t } from "../vendor/kit/i18n";
import { localDate, localTime, localYearMonth } from "../vendor/kit/local-stamp";
import type { Dials } from "./dials";

export interface LogEntry { at: Date; model: string; dials: Dials; note: string; input: string; output: string }

/** Frontmatter-Keys bleiben englisch und unuebersetzt — sie persistieren im Nutzer-Vault. */
export const LOGBOOK_FRONTMATTER = "---\ntype: lingotuner-log\n---\n";

export function logbookPath(folder: string, at: Date): string {
  const f = folder.trim().replace(/\/+$/, "");
  const file = `LingoTuner ${localYearMonth(at)}.md`;
  return f === "" ? file : `${f}/${file}`;
}

const quote = (s: string): string => s.split("\n").map((l) => `> ${l}`).join("\n");

export function renderLogEntry(e: LogEntry): string {
  const stamp = `${localDate(e.at)} ${localTime(e.at)}`;
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
