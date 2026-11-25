// vendored from code-kit@0.93.0, src/ts/pure/panel-host.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `svg-studio/src/obsidian/panel/shell.ts` (svg-studio@0.1.4) — the state and the run of the panel shell: `session`, `offered`,
// `kept`, `noEndpoint`, `applying` (Z. 168-182), `run`/`runInner`/`stop`/`settle` (Z. 280-359), `apply` (Z. 361-390), `discard`/`startNew` (Z. 398-416)
// and the target rule of `setTarget` (Z. 580-595). The drawing (Z. 184-264 and 418-573) stays with the frame; this module is the part that has no DOM.
//
// What it is for: a panel that works on a target in rounds (`PanelSession`) has two lifetimes. The frame that draws it dies with the window; the run,
// the rounds and the half-typed instruction must outlive it (close the window during a run, open it again, find the text there and the run still going).
// The host holds exactly that, and tells whoever listens: a frame subscribes when it is built and unsubscribes when it dies; the host never knows what
// a frame looks like. Everything the frame needs to draw comes out of `session()` and `live()`.
//
// Distinct from `run-state`: that is a pure automaton for a long job (`idle | running | done | aborted | failed`) with progress and phases and NO session,
// no target, no rounds and no listeners; the caller keeps the instance. The host here owns one `PanelSession`, hands out one run at a time through
// `run-slot`, buffers what the run streams (answer, reasoning, status) and writes nothing on its own: the result of a run becomes a round of the
// session, and the file is only touched when the caller passes `write` to `accept`.
//
// Rules the host keeps (each is a test in `tests/panel-host.test.ts`):
// - One run at a time: `start` during `busy()` gives `false` and does not call `run`. The slot is used WITHOUT `supersede`.
// - Every effect after an `await` sits behind `Run.guard`: the late result of an aborted run, or of a run that ends after `destroy()`, changes neither the
//   session nor `live()` and calls no listener.
// - The host does not throw to the outside (apart from a programming error of the caller): a throw of `run` becomes status `error`, a throw of `write`
//   becomes `{ ok: false, message }` with the lock released, a throw of a listener is caught and swallowed (a broken frame must not stop the host).
// - The draft (the text of the instruction field) stays on error, abort and `no-endpoint` and is cleared only by a result that is a round, and then only
//   if it is still the sent instruction (since 0.91.0: text typed during the run stays, B11). A run that
//   `start` was given an `exec` for (a hint the panel offers, such as a repair) did not come from the field, so it neither takes over nor clears the draft.
// - After `accept` ok a fresh session begins on `offered ?? retarget ?? old target`, in that order: the offered target was chosen by the person, the
//   `retarget` only keeps the fingerprint of a block current.
// - A second `accept` without an `await` in between writes once (`applying` is set before the first suspension).
// - `destroy()` aborts, discards and silences: afterwards every call is without effect and no listener is called.
//
// Purity: no `obsidian`, no DOM, no timer, no I/O; `write` and `run` are the caller's.

import { createRunSlot, type Run } from "./run-slot";
import { sameTarget, type PanelSession, type Target } from "./panel-session";

/** The phase of a status line (the same five as `StatusPhase` in obsidian-kit's `status-indicator`). */
export type HostStatusPhase = "idle" | "checking" | "ok" | "error" | "warning";

/** What a run reports while it streams. Every call is buffered in `PanelHost.live()` and passed on to the listeners; after the run was aborted or
 *  the host destroyed, a call has no effect. */
export interface HostRunIo {
  /** The run begins: buffers cleared, status "checking" with `strings.running(model)`. */
  start(): void;
  /** Clears the answer and the reasoning (a retry inside the run starts the text again). */
  clearAnswer(): void;
  onToken(text: string): void;
  onReasoning(text: string): void;
  /** What was streamed as the answer so far was thinking after all (a model that writes its thinking into the content without an opener): the answer is emptied, the reasoning stays. */
  onContentReset(): void;
  setStatus(phase: HostStatusPhase, text: string): void;
}

/** What `run` gets. `session` is the session at the start; the result carries the next one. */
export interface HostRunCall<S> {
  session: S;
  instruction: string;
  signal: AbortSignal;
  model: string;
  io: HostRunIo;
}

/** How a run ended. `ok` carries the session with the new round; the others change nothing but status (and `noEndpoint` for the third). */
export type HostRunResult<S> =
  | { ok: true; session: S; message: string }
  | { ok: false; kind: "aborted" }
  | { ok: false; kind: "no-endpoint"; detail: string }
  | { ok: false; kind: "error"; message: string };

/** What `write` of `accept` answers. Structurally the same as obsidian-kit's `AcceptOutcome`. `retarget`: the target the written result now is. */
export type HostAcceptOutcome = { ok: true; message: string; retarget?: Target } | { ok: false; message: string };

/** The buffer of the run (and the state a frame draws that is not the session). */
export interface HostLive {
  answer: string;
  reasoning: string;
  status: { phase: HostStatusPhase; text: string };
  model: string;
  /** The detail of a `no-endpoint` result, `null` when there is none (or the model line reported a reachable list: `clearNoEndpoint`). */
  noEndpoint: string | null;
  draft: string;
}

/** What changed: `session` (session object replaced), `target` (offered target, `kept`), `run` (a run began or ended), `live` (buffer, status,
 *  `noEndpoint`), `apply` (the write lock changed). One change can report several. `setDraft` reports nothing: the frame is its source. */
export type HostEvent = "session" | "target" | "run" | "live" | "apply";

export interface PanelHostOptions<S> {
  /** A fresh session on a target (no rounds). */
  fresh(target: Target): S;
  /** The run. Standard for `start` without `exec`. Must pass `signal` on and write only through `io`; the result becomes the next session. */
  run(call: HostRunCall<S>): Promise<HostRunResult<S>>;
  /** The model name the run uses now (shown in the running status and in `live()`). */
  model(): string;
  strings: { running(model: string): string; aborted: string; noEndpoint: string };
}

export interface PanelHost<S extends PanelSession<unknown>> {
  session(): S;
  /** `false` and without effect during a run and while writing. */
  setSession(s: S): boolean;
  /** Station 1: a target is offered. Without rounds and without a run it applies at once; otherwise it is held (`kept`) and `discard` takes it. */
  offer(target: Target): void;
  offered(): Target | null;
  kept(): boolean;
  /** Fresh session on `offered ?? current target`; `false` and without effect when `busy()`. The confirmation is the frame's business. */
  discard(): boolean;
  /** Fresh session on `{ kind: "new" }`; `false` when `busy()`. */
  startNew(): boolean;
  /** Sets the status from outside (a slot's `ctx.setStatus`, the model line's error); reports `live`. */
  setStatus(phase: HostStatusPhase, text: string): void;
  /** The model line reports a reachable list: a `no-endpoint` from before no longer holds. Reports `live`. */
  clearNoEndpoint(): void;
  running(): boolean;
  applying(): boolean;
  /** `running() || applying()` */
  busy(): boolean;
  setDraft(text: string): void;
  /** Starts a run. `false` when `busy()`, the host is destroyed, or the target is of kind `other`. An empty instruction starts. With `exec` that function runs instead of `options.run`. */
  start(instruction: string, exec?: (call: HostRunCall<S>) => Promise<HostRunResult<S>>): boolean;
  /** Aborts the run (signal fired, status idle with `strings.aborted`); without a run nothing happens. */
  abort(): void;
  /** Writes through the caller's `write`. `null` when there is nothing to do: no round, a run, a write already going, or destroyed. */
  accept(write: (s: S) => Promise<HostAcceptOutcome>): Promise<HostAcceptOutcome | null>;
  /** A copy of the buffer; a change of it is not seen through the returned object. */
  live(): HostLive;
  subscribe(listener: (event: HostEvent) => void): () => void;
  listeners(): number;
  /** Resolves when no run and no write is going (also those that started while waiting). */
  settled(): Promise<void>;
  /** Aborts, discards the session and the buffers, silences. Afterwards every call is without effect. */
  destroy(): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createPanelHost<S extends PanelSession<unknown>>(o: PanelHostOptions<S>, initial?: S): PanelHost<S> {
  let session: S = initial ?? o.fresh({ kind: "new" });
  let offered: Target | null = null;
  let kept = false;
  let noEndpoint: string | null = null;
  let applying = false;
  let destroyed = false;
  let answer = "";
  let reasoning = "";
  let draft = "";
  let status: { phase: HostStatusPhase; text: string } = { phase: "idle", text: "" };
  let pending: Promise<void> = Promise.resolve();
  const slot = createRunSlot();
  const listeners = new Set<{ fn: (event: HostEvent) => void }>();

  function emit(...events: HostEvent[]): void {
    if (destroyed) return;
    for (const event of events) {
      for (const l of Array.from(listeners)) {
        try {
          l.fn(event);
        } catch {
          // A broken frame must not stop the host (nor the other frames).
        }
      }
    }
  }

  const roundCount = (): number => session.rounds.rounds.length;
  const setStatusInner = (phase: HostStatusPhase, text: string): void => { status = { phase, text }; };

  /** A target held back during the run applies now if no round is open (shell.ts `settle`). Returns whether something changed. */
  function settle(): boolean {
    if (offered === null || roundCount() > 0) return false;
    session = { ...session, target: offered };
    offered = null;
    kept = false;
    return true;
  }

  function resetBuffers(): void {
    answer = "";
    reasoning = "";
  }

  function begin(instruction: string, exec: (call: HostRunCall<S>) => Promise<HostRunResult<S>>, ownsDraft: boolean, r: Run): Promise<void> {
    noEndpoint = null;
    resetBuffers();
    setStatusInner("checking", o.strings.running(o.model()));
    const io: HostRunIo = {
      start: () => { r.guard(() => { resetBuffers(); setStatusInner("checking", o.strings.running(o.model())); emit("live"); }); },
      clearAnswer: () => { r.guard(() => { resetBuffers(); emit("live"); }); },
      onToken: (text) => { r.guard(() => { answer += text; emit("live"); }); },
      onReasoning: (text) => { r.guard(() => { reasoning += text; emit("live"); }); },
      onContentReset: () => { r.guard(() => { answer = ""; emit("live"); }); },
      setStatus: (phase, text) => { r.guard(() => { setStatusInner(phase, text); emit("live"); }); },
    };
    emit("run", "live");
    return (async () => {
      try {
        const res = await exec({ session, instruction, signal: r.signal, model: o.model(), io });
        r.guard(() => {
          if (res.ok) {
            session = res.session;
            answer = "";
            setStatusInner("ok", res.message);
            // Only the draft that was SENT is cleared: what the person typed into the field during the run stays (B11, lingotuner GUI smoke 2026-11-25:
            // the clear took text typed while the model ran). A draft typed back to exactly the sent text is what was sent, and goes.
            if (ownsDraft && draft === instruction) draft = "";
            emit("session", "live");
          } else if (res.kind === "aborted") {
            setStatusInner("idle", o.strings.aborted);
            emit("live");
          } else if (res.kind === "no-endpoint") {
            noEndpoint = res.detail;
            setStatusInner("error", o.strings.noEndpoint);
            emit("live");
          } else {
            setStatusInner("error", res.message);
            emit("live");
          }
        });
      } catch (e) {
        // The panel never hangs: every throw becomes status.
        r.guard(() => { setStatusInner("error", messageOf(e)); emit("live"); });
      } finally {
        // Only a run that was still the current one ends the run for the listeners; an aborted or superseded run, or one that ends after `destroy`, is silent.
        const wasCurrent = r.isCurrent();
        r.finish();
        if (wasCurrent && !destroyed) {
          const moved = settle();
          emit("run", ...(moved ? (["target", "session"] as const) : []));
        }
      }
    })();
  }

  const host: PanelHost<S> = {
    session: () => session,
    setSession(s) {
      if (destroyed || slot.running() || applying) return false;
      session = s;
      emit("session");
      return true;
    },
    offer(target) {
      if (destroyed) return;
      let moved = false;
      // Without rounds (and without a run) the offered target applies at once; with rounds or during a run the old one stays.
      if (!slot.running() && roundCount() === 0 && session.target !== target) {
        session = { ...session, target };
        moved = true;
      }
      kept = !sameTarget(session.target, target);
      offered = kept ? target : null;
      emit("target", ...(moved ? (["session"] as const) : []));
    },
    offered: () => offered,
    kept: () => kept,
    discard() {
      if (destroyed || slot.running() || applying) return false;
      session = o.fresh(offered ?? session.target);
      kept = false;
      offered = null;
      resetBuffers();
      setStatusInner("idle", "");
      emit("session", "target", "live");
      return true;
    },
    startNew() {
      if (destroyed || slot.running() || applying) return false;
      session = o.fresh({ kind: "new" });
      kept = false;
      offered = null;
      resetBuffers();
      setStatusInner("idle", "");
      emit("session", "target", "live");
      return true;
    },
    setStatus(phase, text) {
      if (destroyed) return;
      setStatusInner(phase, text);
      emit("live");
    },
    clearNoEndpoint() {
      if (destroyed) return;
      noEndpoint = null;
      emit("live");
    },
    running: () => slot.running(),
    applying: () => applying,
    busy: () => slot.running() || applying,
    setDraft(text) {
      if (destroyed) return;
      draft = text;
    },
    start(instruction, exec) {
      // `noEndpoint` does NOT block: the state is judged anew before every start, otherwise the empty state would be a dead end.
      if (destroyed || applying || session.target.kind === "other") return false;
      // One run: `begin()` without `supersede` gives `null` during a run, and that is the only place the rule lives.
      const r = slot.begin();
      if (r === null) return false;
      if (exec === undefined) draft = instruction;
      pending = begin(instruction, exec ?? ((call) => o.run(call)), exec === undefined, r);
      return true;
    },
    abort() {
      if (destroyed || !slot.running()) return;
      slot.abort();
      setStatusInner("idle", o.strings.aborted);
      const moved = settle();
      emit("run", "live", ...(moved ? (["target", "session"] as const) : []));
    },
    async accept(write) {
      if (destroyed || roundCount() === 0 || applying || slot.running()) return null;
      applying = true;
      emit("apply");
      const work = (async (): Promise<HostAcceptOutcome> => {
        let outcome: HostAcceptOutcome;
        try {
          outcome = await write(session);
        } catch (e) {
          outcome = { ok: false, message: messageOf(e) };
        }
        if (destroyed) return outcome;
        try {
          if (outcome.ok) {
            // The written target carries the new text: without `retarget` the fingerprint of a block would be stale. During the write target and rounds
            // are locked; an offer that came meanwhile was chosen by the person and goes first.
            session = o.fresh(offered ?? outcome.retarget ?? session.target);
            kept = false;
            offered = null;
            resetBuffers();
            setStatusInner("ok", outcome.message);
            emit("session", "target", "live");
          } else {
            setStatusInner("error", outcome.message);
            emit("live");
          }
        } finally {
          applying = false;
          emit("apply");
        }
        return outcome;
      })();
      pending = work.then(() => undefined);
      return work;
    },
    live: () => ({ answer, reasoning, status: { ...status }, model: o.model(), noEndpoint, draft }),
    subscribe(listener) {
      if (destroyed) return () => undefined;
      const entry = { fn: listener };
      listeners.add(entry);
      return () => { listeners.delete(entry); };
    },
    listeners: () => listeners.size,
    async settled() {
      let p: Promise<void>;
      do {
        p = pending;
        await p;
      } while (p !== pending);
    },
    destroy() {
      if (destroyed) return;
      slot.abort();
      session = o.fresh({ kind: "new" });
      offered = null;
      kept = false;
      noEndpoint = null;
      resetBuffers();
      draft = "";
      applying = false;
      destroyed = true;
      listeners.clear();
    },
  };
  return host;
}
