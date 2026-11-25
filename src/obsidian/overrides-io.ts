import { normalizePath, type App } from "obsidian";
import type { OverrideReader, OverrideWriter } from "../core/examples/overrides";
import { ensureDir } from "../vendor/kit/ensure-dir";

export function vaultOverrideReader(app: App): OverrideReader {
  return {
    async read(path) {
      const file = app.vault.getFileByPath(normalizePath(path));
      if (file === null) return null;
      try { return await app.vault.cachedRead(file); } catch { return null; }
    },
  };
}

export function vaultOverrideWriter(app: App): OverrideWriter {
  return {
    exists: (path) => Promise.resolve(app.vault.getAbstractFileByPath(normalizePath(path)) !== null),
    async write(path, content) { await app.vault.create(normalizePath(path), content); },
    // Ordner samt Eltern, ein paralleler Gewinner ist kein Fehler (code-kit `ensureDir`, wie Kit `createNote`; vorher `createFolder`: nicht rekursiv, warf beim Rennen).
    async ensureFolder(path) { await ensureDir(app.vault.adapter, normalizePath(path)); },
  };
}
