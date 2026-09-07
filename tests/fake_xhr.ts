// uebernommen aus vault-rag/tests/fake_xhr.ts, 2026-09-07
import { vi } from "vitest";

/** Stubt XMLHttpRequest und gibt Treiber-Helfer zurück:
 *  feed() spielt onprogress-Chunks + onload ein, progress() nur die Chunks (Stream bleibt offen —
 *  noetig, um einen Abbruch MITTEN im Stream zu inszenieren), error() simuliert onerror,
 *  body liest den Request-Body. */
export function installFakeXHR(): { readonly body: string; readonly headers: Record<string, string>; feed(chunks: string[], status?: number): void; progress(chunks: string[], status?: number): void; error(): void } {
  const state: { inst: any } = { inst: null };
  vi.stubGlobal("XMLHttpRequest", class {
    status = 200;
    responseText = "";
    body = "";
    headers: Record<string, string> = {};
    onprogress: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() { state.inst = this; }
    open(): void {}
    setRequestHeader(k: string, v: string): void { this.headers[k] = v; }
    send(b?: string): void { this.body = b ?? ""; }
    abort(): void { this.onabort?.(); }
  });
  return {
    get body(): string { return state.inst.body as string; },
    get headers(): Record<string, string> { return state.inst.headers as Record<string, string>; },
    feed(chunks: string[], status = 200): void {
      state.inst.status = status;
      for (const c of chunks) { state.inst.responseText += c; state.inst.onprogress?.(); }
      state.inst.onload?.();
    },
    progress(chunks: string[], status = 200): void {
      state.inst.status = status;
      for (const c of chunks) { state.inst.responseText += c; state.inst.onprogress?.(); }
    },
    error(): void { state.inst.onerror?.(); },
  };
}
