// vendored from code-kit@0.91.0, src/ts/pure/run-slot.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `3d-codeblocks/src/obsidian/prompt-panel.ts` (`controller: AbortController | null`, `runInner` with
// `this.controller !== ctrl` after every await, `abort()` that sets it to null), the same pattern as lingotuner's `run`.

/** One run in a `RunSlot`. */
export interface Run {
  /** Aborted by `RunSlot.abort()` or when another run supersedes this one; stays unaborted after `finish()`. */
  readonly signal: AbortSignal;
  /** `true` while this run is the slot's run: not finished, not aborted, not superseded. */
  isCurrent(): boolean;
  /** Runs `fn` and returns its value if this run is still current, otherwise `undefined` without calling `fn`. Put every write to shared
   *  state that comes after an `await` behind it: a run that was superseded meanwhile must not overwrite the newer one. */
  guard<T>(fn: () => T): T | undefined;
  /** Frees the slot if this run is still current; a no-op for a run that was superseded, aborted or finished (idempotent). Call it in `finally`. */
  finish(): void;
}

/** One run at a time, with cancellation and a stale-run check. The slot holds no run data; the caller keeps its own state and writes
 *  to it through `Run.guard`. */
export interface RunSlot {
  /** Starts a run. During another run: `null`, or with `supersede: true` the old run is aborted and the new one starts. */
  begin(o?: { supersede?: boolean }): Run | null;
  /** Aborts the current run and frees the slot; a no-op without a run. */
  abort(): void;
  /** `true` while a run is current. */
  running(): boolean;
}

export function createRunSlot(): RunSlot {
  let current: { run: Run; controller: AbortController } | null = null;

  return {
    begin(o) {
      if (current !== null) {
        if (o?.supersede !== true) return null;
        current.controller.abort();
        current = null;
      }
      const controller = new AbortController();
      const run: Run = {
        signal: controller.signal,
        isCurrent: () => current !== null && current.run === run,
        guard<T>(fn: () => T): T | undefined {
          return current !== null && current.run === run ? fn() : undefined;
        },
        finish() {
          if (current !== null && current.run === run) current = null;
        },
      };
      current = { run, controller };
      return run;
    },
    abort() {
      if (current === null) return;
      const { controller } = current;
      current = null;
      controller.abort();
    },
    running: () => current !== null,
  };
}
