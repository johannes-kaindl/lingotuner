// uebernommen aus obsidian-transmute/tests/helpers/dom.ts, 2026-09-07
/**
 * Suchen im Fake-Element-Baum.
 *
 * `makeFakeEl()` aus dem Obsidian-Mock kennt kein `querySelector` — es haelt nur
 * `children`, `className` und `tagName`. Der Mock ist ein aus fuenf Plugins gepflegtes
 * Superset und wird deshalb NICHT lokal erweitert; stattdessen liegt die Suche hier.
 */
type FakeEl = { className?: string; tagName?: string; children?: FakeEl[] };

export function findAllByClass<T = FakeEl>(root: unknown, cls: string): T[] {
  const out: T[] = [];
  const walk = (node: FakeEl): void => {
    if (typeof node.className === "string" && node.className.split(" ").includes(cls)) {
      out.push(node as T);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root as FakeEl);
  return out;
}

export function findByClass<T = FakeEl>(root: unknown, cls: string): T | null {
  return findAllByClass<T>(root, cls)[0] ?? null;
}

export function findAllByTag<T = FakeEl>(root: unknown, tag: string): T[] {
  const out: T[] = [];
  const upper = tag.toUpperCase();
  const walk = (node: FakeEl): void => {
    if (node.tagName === upper) out.push(node as T);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root as FakeEl);
  return out;
}

export function findByTag<T = FakeEl>(root: unknown, tag: string): T | null {
  return findAllByTag<T>(root, tag)[0] ?? null;
}
