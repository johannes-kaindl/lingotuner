import { setIcon } from "obsidian";
import { DIMENSIONS, isNoop, levelKey, type Dials, type Dimension, type Level, type Preset } from "../core/dials";
import type { Session } from "../core/session";
import { readinessKey, type Readiness, type SourceKind } from "../core/source";
import { thinkToggleState } from "../vendor/kit/think-toggle";
import { buildStreamArea, type StreamArea } from "../vendor/kit-obsidian/stream-area";
import { t } from "../vendor/kit/i18n";

export type RunPhase = "idle" | "streaming" | "done" | "error" | "aborted";

export interface PanelModel {
  source: SourceKind;
  readiness: Readiness;
  freeText: string;
  dials: Dials;
  presets: Preset[];
  presetId: string | null;
  note: string;
  models: string[];
  model: string;
  suppressThinking: boolean;
  phase: RunPhase;
  statusText: string;
  truncated: boolean;
  session: Session;
  preview: string;
  reasoning: string;
  reasoningOpen: boolean;
  canReplaceSelection: boolean;
  canReplaceNote: boolean;
}

export interface PanelHandlers {
  onSource(k: SourceKind): void;
  onFreeText(v: string): void;
  onDial(dim: Dimension, level: Level): void;
  onPreset(id: string): void;
  onSavePreset(): void;
  onNote(v: string): void;
  onTune(): void;
  onRefine(): void;
  onAbort(): void;
  onReset(): void;
  onSelectRound(i: number): void;
  onModel(m: string): void;
  onRefreshModels(): void;
  onToggleThinking(): void;
  onToggleReasoning(open: boolean): void;
  onReplaceSelection(): void;
  onReplaceNote(): void;
  onCopy(): void;
  onNewNote(): void;
}

export interface PanelParts {
  statusEl: HTMLElement;
  statusIconEl: HTMLElement;
  statusLabelEl: HTMLElement;
  /** Der Streaming-Antwortbereich aus `obsidian-kit` (UI-STANDARD §8, `buildStreamArea`).
   *  Gedankenblock, Antwort-Body und laufender Absatz liegen darin; die Wurzel traegt
   *  zusaetzlich `.lt-preview` als Design-Scope dieses Plugins.
   *  Er SCROLLT hier NICHT selbst — das tut das Panel (ein Rollbereich, s. styles.css). */
  area: StreamArea;
}

type El = HTMLElement;

/** Erster Treffer eines Selektors. Kein `querySelector`, weil der Obsidian-Mock der Tests
 *  nur `querySelectorAll` kennt — und ein Patch, der im Test nicht laeuft, ist kein Patch. */
function one<T extends HTMLElement>(root: El, sel: string): T | null {
  return (root.querySelectorAll(sel)[0] as T | undefined) ?? null;
}

function readinessLine(r: Readiness, source: SourceKind): string {
  if (r.kind !== "ready") return t(readinessKey(r));
  if (source === "text") return t("source.ready.text", String(r.chars));
  return t(source === "selection" ? "source.ready.selection" : "source.ready.note", String(r.chars), r.name ?? "");
}

function sourceRow(parent: El, m: PanelModel, h: PanelHandlers, busy: boolean): void {
  const row = parent.createDiv({ cls: "lt-sources" });
  const kinds: SourceKind[] = ["selection", "note", "text"];
  for (const k of kinds) {
    const b = row.createEl("button", { text: t(`source.${k}`), cls: "lt-source-chip" });
    b.toggleClass("is-active", m.source === k);
    b.setAttribute("aria-pressed", String(m.source === k));
    b.disabled = busy;
    b.addEventListener("click", () => h.onSource(k));
  }
  const line = parent.createDiv({ cls: "lt-source-line", text: readinessLine(m.readiness, m.source) });
  line.toggleClass("is-blocked", m.readiness.kind !== "ready");
  if (m.source === "text") {
    const ta = parent.createEl("textarea", { cls: "lt-freetext" });
    ta.placeholder = t("source.textPlaceholder");
    ta.value = m.freeText;
    ta.rows = 6;
    ta.addEventListener("input", () => h.onFreeText(ta.value));
  }
}

function presetRow(parent: El, m: PanelModel, h: PanelHandlers, busy: boolean): void {
  const row = parent.createDiv({ cls: "lt-presets" });
  for (const p of m.presets) {
    const b = row.createEl("button", { text: p.label ?? t(`preset.${p.id}`), cls: "lt-preset-chip" });
    b.toggleClass("is-active", m.presetId === p.id);
    b.setAttribute("aria-pressed", String(m.presetId === p.id));
    b.disabled = busy;
    b.addEventListener("click", () => h.onPreset(p.id));
  }
  // Der Marker ist ein FESTER Platzhalter, kein bedingtes Element: ein Reglerzug muss ihn
  // umschalten koennen, ohne die Zeile neu zu bauen — sonst zieht er den gegriffenen Regler
  // unter dem Zeiger weg (Fehler 1). Leer heisst „Preset getroffen"; ein leerer Span rendert
  // nichts.
  row.createSpan({ text: m.presetId === null ? t("preset.custom") : "", cls: "lt-preset-custom" });
  const save = row.createEl("button", { cls: "lt-preset-save clickable-icon" });
  setIcon(save, "save");
  save.setAttribute("aria-label", t("preset.save"));
  save.disabled = busy;
  save.addEventListener("click", () => h.onSavePreset());
}

function dialRows(parent: El, m: PanelModel, h: PanelHandlers): void {
  const box = parent.createDiv({ cls: "lt-dials" });
  for (const d of DIMENSIONS) {
    const row = box.createDiv({ cls: "lt-dial" });
    const head = row.createDiv({ cls: "lt-dial-head" });
    head.createSpan({ text: t(`dial.${d}`), cls: "lt-dial-name" });
    head.createSpan({ text: t(levelKey(d, m.dials[d])), cls: "lt-dial-level" });
    const line = row.createDiv({ cls: "lt-dial-line" });
    line.createSpan({ text: t(`dial.${d}.left`), cls: "lt-dial-pole" });
    const input = line.createEl("input", {
      cls: "lt-dial-input",
      attr: { type: "range", min: "-2", max: "2", step: "1", value: String(m.dials[d]), "data-dim": d },
    });
    input.setAttribute("aria-label", t("dial.aria", t(`dial.${d}`), t(`dial.${d}.left`), t(`dial.${d}.right`)));
    input.addEventListener("input", () => h.onDial(d, (Number(input.value) as Level)));
    line.createSpan({ text: t(`dial.${d}.right`), cls: "lt-dial-pole" });
  }
}

function noteRow(parent: El, m: PanelModel, h: PanelHandlers): void {
  const row = parent.createDiv({ cls: "lt-note-row" });
  row.createSpan({ text: t("note.label"), cls: "lt-label" });
  const ta = row.createEl("textarea", { cls: "lt-note" });
  ta.placeholder = t("note.placeholder");
  ta.value = m.note;
  ta.rows = 2;
  ta.addEventListener("input", () => h.onNote(ta.value));
}

function runRow(parent: El, m: PanelModel, h: PanelHandlers): void {
  const row = parent.createDiv({ cls: "lt-run-row" });
  const ready = m.readiness.kind === "ready";
  const noop = isNoop(m.dials, m.note);
  const busy = m.phase === "streaming";
  const hasRounds = m.session.rounds.length > 0;

  const run = row.createEl("button", { cls: "lt-run mod-cta" });
  if (busy) {
    run.setText(t("run.abort"));
    run.addEventListener("click", () => h.onAbort());
  } else {
    run.setText(hasRounds ? t("run.retune") : t("run.tune"));
    run.disabled = !ready || noop;
    run.addEventListener("click", () => h.onTune());
  }
  if (hasRounds && !busy) {
    const refine = row.createEl("button", { text: t("run.refine"), cls: "lt-refine" });
    refine.disabled = noop;
    refine.addEventListener("click", () => h.onRefine());
  }
  // Zuruecksetzen erscheint, sobald es etwas zurueckzusetzen GIBT — Runden oder eine Vorschau.
  // Waehrend des ERSTEN Laufs gibt es deshalb keinen: `run()` setzt `preview = ""` und es gibt
  // noch keine Runde, also steht dort nur „Abbrechen" — und mehr braucht es da auch nicht, weil
  // noch nichts zu verwerfen ist. Ab dem zweiten Lauf ist er auch waehrend des Streams da und
  // bricht dann ab und raeumt in einem Zug.
  if (hasRounds || m.preview !== "") {
    const reset = row.createEl("button", { text: t("run.reset"), cls: "lt-reset" });
    reset.addEventListener("click", () => h.onReset());
  }

  const select = row.createEl("select", { cls: "lt-model dropdown" });
  select.setAttribute("aria-label", t("set.model"));
  select.disabled = busy;
  select.createEl("option", { text: t("run.modelAuto"), value: "" });
  const ids = m.models.includes(m.model) || m.model === "" ? m.models : [m.model, ...m.models];
  for (const id of ids) select.createEl("option", { text: id, value: id });
  select.value = m.model;
  select.addEventListener("change", () => h.onModel(select.value));
  const refresh = row.createEl("button", { cls: "lt-model-refresh clickable-icon" });
  setIcon(refresh, "refresh-cw");
  refresh.setAttribute("aria-label", t("ep.refreshModels"));
  refresh.disabled = busy;
  refresh.addEventListener("click", () => h.onRefreshModels());

  const think = thinkToggleState(m.model, m.suppressThinking);
  const thinkOn = think.mode !== "off";
  const toggle = row.createEl("button", { cls: "lt-think" });
  toggle.toggleClass("is-off", think.mode === "off");
  setIcon(toggle.createSpan(), thinkOn ? "brain" : "brain-cog");
  toggle.createSpan({ text: t(`think.${think.mode}`) });
  if (think.hint !== null) toggle.setAttribute("title", t(`think.hint.${think.hint}`));
  toggle.setAttribute("aria-pressed", String(thinkOn));
  toggle.disabled = busy || think.disabled;
  if (think.disabled) toggle.setAttribute("aria-disabled", "true");
  if (!think.disabled) toggle.addEventListener("click", () => h.onToggleThinking());
}

function statusRow(parent: El): Pick<PanelParts, "statusEl" | "statusIconEl" | "statusLabelEl"> {
  const statusEl = parent.createDiv({ cls: "lt-status" });
  const statusIconEl = statusEl.createSpan({ cls: "lt-status-icon" });
  const statusLabelEl = statusEl.createSpan({ cls: "lt-status-label" });
  return { statusEl, statusIconEl, statusLabelEl };
}

/** §8 Status-Indikator: Form (Icon) UND Klasse UND aria-label — nie Farbe allein.
 *  `idle` ist bewusst NEUTRAL: ein leerer Ausgangszustand ist kein Erfolg, und ein gruenes
 *  is-ok vor dem ersten Lauf behauptete genau das (leerer Kreis, keine Zustandsklasse). */
export function paintStatus(parts: PanelParts, phase: RunPhase, text: string): void {
  const el = parts.statusEl;
  el.removeClass("is-checking", "is-ok", "is-error", "is-warning");
  const icon = phase === "streaming" ? "loader"
    : phase === "error" ? "circle-x"
    : phase === "aborted" ? "alert-triangle"
    : phase === "idle" ? "circle"
    : "circle-check";
  const cls = phase === "streaming" ? "is-checking"
    : phase === "error" ? "is-error"
    : phase === "aborted" ? "is-warning"
    : phase === "idle" ? null
    : "is-ok";
  if (cls !== null) el.addClass(cls);
  setIcon(parts.statusIconEl, icon);
  parts.statusLabelEl.setText(text);
  el.setAttribute("aria-label", text);
}

function historyList(parent: El, m: PanelModel, h: PanelHandlers, busy: boolean): void {
  if (m.session.rounds.length < 2) return;
  const box = parent.createDiv({ cls: "lt-history" });
  box.createDiv({ text: t("history.title"), cls: "lt-label" });
  m.session.rounds.forEach((r, i) => {
    const row = box.createEl("button", { cls: "lt-history-row" });
    row.toggleClass("is-active", i === m.session.active);
    row.setAttribute("aria-pressed", String(i === m.session.active));
    row.disabled = busy;
    const based = r.basedOn === null ? t("history.fromSource") : t("history.refined", String(r.basedOn + 1));
    const note = r.note.trim() === "" ? t("history.noteless") : r.note;
    const segments = [t("history.round", String(i + 1)), based, note];
    if (r.aborted) segments.push(t("history.aborted"));
    row.setText(segments.join(" · "));
    row.addEventListener("click", () => h.onSelectRound(i));
  });
}

function outputRow(parent: El, m: PanelModel, h: PanelHandlers): void {
  const row = parent.createDiv({ cls: "lt-outputs" });
  const hasResult = m.preview.trim() !== "" && (m.phase === "done" || m.phase === "aborted");
  const mk = (cls: string, key: string, enabled: boolean, cb: () => void): void => {
    const b = row.createEl("button", { text: t(key), cls: `lt-out ${cls}` });
    b.disabled = !enabled;
    b.addEventListener("click", cb);
  };
  mk("lt-out-replace-selection", "out.replaceSelection", hasResult && m.canReplaceSelection, () => h.onReplaceSelection());
  mk("lt-out-replace-note", "out.replaceNote", hasResult && m.canReplaceNote, () => h.onReplaceNote());
  mk("lt-out-copy", "out.copy", hasResult, () => h.onCopy());
  mk("lt-out-new-note", "out.newNote", hasResult, () => h.onNewNote());
}

/** Was einen VOLL-Draw erzwingt. Alles andere ist ein Patch (`patchPanel`) — ein Voll-Draw
 *  zieht jedes Eingabefeld unter dem Cursor weg und war die Ursache von Fehler 1. */
export function structureKey(m: PanelModel): string {
  return [
    m.source, m.phase,
    String(m.session.rounds.length), String(m.session.active),
    m.models.join(" "), m.model, String(m.suppressThinking),
    m.presets.map((p) => p.id).join(" "),
    String(m.truncated),
    m.preview === "" ? "0" : "1",
    m.reasoning === "" ? "0" : "1",
    // Trenner als SICHTBARES Leerzeichen. Hier standen drei unsichtbare Steuerzeichen
    // (2x U+0002, 1x U+0001) — sie trennten zwar korrekt, waren aber in jeder Ansicht
    // unsichtbar, gingen so in `main.js` mit und wurden in der Review als `join("")`
    // gelesen. `check-no-nul-bytes` prueft nur U+0000 und sah sie nicht.
  ].join(" ");
}

/** Aktualisierung OHNE Neuaufbau — der einzige zulaessige Weg, solange der Fokus im Panel
 *  liegt. Deckt Bereitschaftszeile, Knopf-Sperren, Stufennamen, Preset-Markierung, die
 *  Ausgangsknoepfe UND (seit der 0.1.1-Nachlese) den Status-Indikator ab.
 *
 *  `parts` ist optional und NULL vor dem ersten Voll-Draw (`this.parts` in view.ts startet als
 *  `null`) — `softDraw()` ruft `patchPanel` aber nur nach mindestens einem `draw()`, `parts` ist
 *  zur Laufzeit also praktisch nie null; der Parameter bleibt trotzdem optional, weil der Typ
 *  in view.ts `PanelParts | null` ist und `patchPanel` keine eigene Invariante darueber
 *  erzwingen kann. Ohne `parts` bleibt der Indikator unveraendert (kein Wurf) statt zu bluffen. */
export function patchPanel(root: El, m: PanelModel, parts: PanelParts | null = null): void {
  root.dataset.preset = m.presetId ?? "";
  const busy = m.phase === "streaming";

  if (parts !== null) paintStatus(parts, m.phase, m.statusText);

  const line = one(root, ".lt-source-line");
  if (line !== null) {
    line.setText(readinessLine(m.readiness, m.source));
    line.toggleClass("is-blocked", m.readiness.kind !== "ready");
  }

  root.querySelectorAll<HTMLElement>(".lt-dial").forEach((row, i) => {
    const dim = DIMENSIONS[i];
    if (dim === undefined) return;
    one(row, ".lt-dial-level")?.setText(t(levelKey(dim, m.dials[dim])));
  });

  root.querySelectorAll<HTMLButtonElement>(".lt-preset-chip").forEach((b, i) => {
    const p = m.presets[i];
    if (p === undefined) return;
    b.toggleClass("is-active", m.presetId === p.id);
    b.setAttribute("aria-pressed", String(m.presetId === p.id));
  });
  one(root, ".lt-preset-custom")?.setText(m.presetId === null ? t("preset.custom") : "");

  const noop = isNoop(m.dials, m.note);
  // Waehrend des Streams traegt `.lt-run` die Abbrechen-Rolle und darf NIE gesperrt werden.
  const run = one<HTMLButtonElement>(root, ".lt-run");
  if (run !== null && !busy) run.disabled = m.readiness.kind !== "ready" || noop;
  const refine = one<HTMLButtonElement>(root, ".lt-refine");
  if (refine !== null && !busy) refine.disabled = noop;

  const hasResult = m.preview.trim() !== "" && (m.phase === "done" || m.phase === "aborted");
  const setOut = (cls: string, enabled: boolean): void => {
    const b = one<HTMLButtonElement>(root, cls);
    if (b !== null) b.disabled = !enabled;
  };
  setOut(".lt-out-replace-selection", hasResult && m.canReplaceSelection);
  setOut(".lt-out-replace-note", hasResult && m.canReplaceNote);
  setOut(".lt-out-copy", hasResult);
  setOut(".lt-out-new-note", hasResult);
}

export function renderPanel(root: El, m: PanelModel, h: PanelHandlers): PanelParts {
  root.empty();
  root.addClass("lt-panel");
  root.dataset.preset = m.presetId ?? "";
  const busy = m.phase === "streaming";
  // Die Bedienelemente sitzen in einem eigenen Block. Er scrollt seit 2026-09-11 NICHT mehr
  // selbst — das Panel ist ein einziger Rollbereich (Layout-Vertrag in styles.css).
  const controls = root.createDiv({ cls: "lt-controls" });
  sourceRow(controls, m, h, busy);
  presetRow(controls, m, h, busy);
  dialRows(controls, m, h);
  noteRow(controls, m, h);
  // Die Ausfuehren-Zeile steht BEWUSST ausserhalb des rollenden Blocks: sie traegt die
  // Hauptaktion. Lag sie darin, war sie nach dem ersten Ergebnis aus dem Sichtfeld gerollt —
  // Nachschaerfen und Zuruecksetzen waren da, aber an ihrer Stelle traf ein Klick das Panel
  // statt des Knopfes. Gefunden hat das C9 im GUI-Smoke, nicht das Auge.
  runRow(root, m, h);
  const status = statusRow(root);
  // Streaming-Antwortbereich aus dem Kit (§8): Gedanken zuerst, Antwort darunter — dieselbe
  // Reihenfolge wie im Stream. Der Gedankenblock entsteht erst beim ersten Gedanken.
  const area = buildStreamArea(root, {
    strings: { reasoning: t("preview.thinking") },
    cls: "lt-preview",
    reasoningOpen: m.reasoningOpen,
    onReasoningToggle: (open) => h.onToggleReasoning(open),
    // Der Body ist hier KEIN Scroll-Container: das Panel rollt als Ganzes (Entscheidung
    // 2026-09-11). `scrollEl` sagt dem Kit, woran `followTail` haengt — und schaltet dabei
    // ueber die Wurzelklasse `okit-stream--host-scroll` den eigenen Scroll des Bodys ab.
    scrollEl: root,
  });
  // Obsidian stylt gerenderten Markdown ueber Nachfahren-Selektoren an `.markdown-rendered`
  // (Ueberschriften-Abstaende, Listen-Einzug, blockquote, Tabellen, Code-Bloecke, Callouts).
  // Ohne die Klasse faellt eine formatierte Antwort auf Browser-Defaults zurueck. Das Kit
  // setzt sie nicht — es weiss nicht, dass hier Markdown hineingerendert wird —, also setzt
  // sie der Consumer. Beim Umstieg auf `buildStreamArea` ist sie am 2026-09-11 zunaechst
  // verlorengegangen: der Smoke-Lauf jenes Tages lieferte 49 Zeichen Fliesstext, und daran
  // ist der Verlust nicht zu sehen (Review I1).
  area.bodyEl.addClass("markdown-rendered");
  if (m.reasoning !== "") area.setReasoning(m.reasoning);
  // VOR den laufenden Absatz: `buildStreamArea` legt `tailEl` als erstes Kind des Bodys an,
  // ein `createDiv` haengte den Leerzustand also darunter. Der Tail wandert dahinter, statt
  // den Leerzustand per `insertBefore` einzuschieben — derselbe Handgriff, den der Voll-Draw
  // fuer den Preview-Block schon macht, und der Obsidian-Mock der Tests kennt nur ihn.
  if (m.preview === "" && m.phase === "idle") {
    area.bodyEl.createDiv({ cls: "lt-empty", text: t("preview.empty") });
    area.bodyEl.appendChild(area.tailEl);
  }
  if (m.truncated) root.createDiv({ cls: "lt-warning", text: t("status.truncated") });
  historyList(root, m, h, busy);
  outputRow(root, m, h);
  const parts: PanelParts = { ...status, area };
  paintStatus(parts, m.phase, m.statusText);
  return parts;
}
