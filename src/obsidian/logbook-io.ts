import { normalizePath, type App } from "obsidian";
import { LOGBOOK_FRONTMATTER, logbookPath, renderLogEntry, type LogEntry } from "../core/logbook";

export async function appendLogEntry(app: App, folder: string, entry: LogEntry): Promise<void> {
  const dir = normalizePath(folder.trim());
  if (dir !== "" && dir !== "/" && app.vault.getAbstractFileByPath(dir) === null) await app.vault.createFolder(dir);
  const path = normalizePath(logbookPath(folder, entry.at));
  const existing = app.vault.getFileByPath(path);
  const text = renderLogEntry(entry);
  if (existing === null) { await app.vault.create(path, LOGBOOK_FRONTMATTER + text); return; }
  await app.vault.append(existing, text);
}
