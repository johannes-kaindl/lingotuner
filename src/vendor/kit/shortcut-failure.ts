// vendored from obsidian-kit@0.70.0, src/pure/shortcut-failure.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus lingotuner/src/core/llm/errors.ts:33-48 (classifyShortcutFailure) und obsidian-transmute/src/core/llm/shortcut-errors.ts:2-21
// (dessen Übernahme aus lingotuner vom 2026-10-01), 2026-10-12 (Welle 19, Erhebung a4). Reine Funktion, kein obsidian-Import, kein Import.

/** Warum ein Kurzbefehl-Aufruf scheiterte — die **Union der Gründe**, nicht ein Objekt: lingotuner (`errors.ts`) und obsidian-transmute
 *  (`shortcut-errors.ts`, `client.ts`) importieren sie so und bauen ihre Fehlertypen darum. `unsupported` kommt nur über den Status 501
 *  (die Werkzeug-Grenze: ein Kurzbefehl kann keine Tool-Aufrufe), nie aus dem Körper. */
export type ShortcutFailure = "error" | "cancel" | "timeout" | "busy" | "unsupported";

const BY_STATUS: Record<number, ShortcutFailure> = { 408: "timeout", 429: "busy", 499: "cancel", 501: "unsupported" };
/** Gründe, die der Körper tragen darf. `unsupported` fehlt mit Absicht (kommt nur über 501), `file-missing` der Brücke
 *  (`ShortcutResult.reason`) ebenfalls: beides fällt auf den Status zurück. */
const REASONS: readonly string[] = ["error", "cancel", "timeout", "busy"];

/** Fehlerbild des Kurzbefehl-Transports (`createShortcutsChatTransport`): die Brücke meldet einen Status und einen JSON-Körper
 *  `{ error: { message, reason } }`. Der Grund im Körper gilt vor dem Status; ohne lesbaren Körper entscheidet der Status, der Rest ist
 *  `"error"`. `detail` ist die Meldung aus dem Körper, wenn sie ein String ist, sonst der Rohtext (oder `""`). Wirft nie.
 *
 *  Liefert `{ reason, detail }` **ohne** `kind`: lingotuner baut daraus seinen `TuneError` selbst (`{ kind: "shortcut", ...f }`). */
export function classifyShortcutFailure(status: number, errorText: string | undefined): { reason: ShortcutFailure; detail: string } {
  let detail = errorText ?? "";
  let reason: string | undefined;
  try {
    const e = (JSON.parse(errorText ?? "") as { error?: { message?: unknown; reason?: unknown } }).error;
    if (typeof e?.message === "string") detail = e.message;
    if (typeof e?.reason === "string") reason = e.reason;
  } catch { /* kein JSON: Rohtext bleibt als Detail */ }
  const known = reason !== undefined && REASONS.includes(reason) ? (reason as ShortcutFailure) : undefined;
  return { reason: known ?? BY_STATUS[status] ?? "error", detail };
}
