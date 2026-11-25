import { normalizePath, type App } from "obsidian";
import { ensureDir } from "../vendor/kit/ensure-dir";
import { LOGBOOK_FRONTMATTER, logbookPath, renderLogEntry, type LogEntry } from "../core/logbook";

export async function appendLogEntry(app: App, folder: string, entry: LogEntry): Promise<void> {
  const dir = normalizePath(folder.trim());
  await ensureDir(app.vault.adapter, dir);   // samt Eltern, Rennen ist kein Fehler (code-kit; "" und "/" tun nichts)
  const path = normalizePath(logbookPath(folder, entry.at));
  const existing = app.vault.getFileByPath(path);
  const text = renderLogEntry(entry);
  if (existing === null) { await app.vault.create(path, LOGBOOK_FRONTMATTER + text); return; }
  await app.vault.append(existing, text);
}
