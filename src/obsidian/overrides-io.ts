import { normalizePath, type App } from "obsidian";
import type { OverrideReader, OverrideWriter } from "../core/examples/overrides";

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
    async ensureFolder(path) {
      const p = normalizePath(path);
      if (p === "" || p === "/") return;
      if (app.vault.getAbstractFileByPath(p) === null) await app.vault.createFolder(p);
    },
  };
}
