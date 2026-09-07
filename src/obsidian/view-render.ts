import { setIcon } from "obsidian";
import { DIMENSIONS, isNoop, levelKey, type Dials, type Dimension, type Level, type Preset } from "../core/dials";
import type { Session } from "../core/session";
import { readinessKey, type Readiness, type SourceKind } from "../core/source";
import { thinkToggleState } from "../vendor/kit/think-toggle";
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
  previewEl: HTMLElement;
  tailEl: HTMLElement;
}

type El = HTMLElement;

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
  if (m.presetId === null) row.createSpan({ text: t("preset.custom"), cls: "lt-preset-custom" });
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
  const toggle = row.createEl("button", { cls: "lt-think" });
  toggle.toggleClass("is-off", think.mode === "off");
  setIcon(toggle.createSpan(), "brain");
  toggle.createSpan({ text: t(`think.${think.mode}`) });
  if (think.hint !== null) toggle.setAttribute("title", t(`think.hint.${think.hint}`));
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

export function renderPanel(root: El, m: PanelModel, h: PanelHandlers): PanelParts {
  root.empty();
  root.addClass("lt-panel");
  root.dataset.preset = m.presetId ?? "";
  const busy = m.phase === "streaming";
  sourceRow(root, m, h, busy);
  presetRow(root, m, h, busy);
  dialRows(root, m, h);
  noteRow(root, m, h);
  runRow(root, m, h);
  const status = statusRow(root);
  const previewEl = root.createDiv({ cls: "lt-preview markdown-rendered" });
  const tailEl = previewEl.createDiv({ cls: "lt-preview-tail" });
  if (m.preview === "" && m.phase === "idle") previewEl.createDiv({ cls: "lt-empty", text: t("preview.empty") });
  if (m.truncated) root.createDiv({ cls: "lt-warning", text: t("status.truncated") });
  if (m.reasoning !== "") {
    const d = root.createEl("details", { cls: "lt-reasoning" });
    d.open = m.reasoningOpen;
    d.createEl("summary", { text: t("preview.thinking") });
    d.createEl("pre", { text: m.reasoning });
    d.addEventListener("toggle", () => h.onToggleReasoning(d.open));
  }
  historyList(root, m, h, busy);
  outputRow(root, m, h);
  const parts: PanelParts = { ...status, previewEl, tailEl };
  paintStatus(parts, m.phase, m.statusText);
  return parts;
}
