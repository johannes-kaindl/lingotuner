export type TuneError =
  | { kind: "http"; status: number; detail: string }
  | { kind: "network" }
  | { kind: "cors-suspected" }
  | { kind: "thought-only" }
  | { kind: "empty" }
  | { kind: "aborted" }
  | { kind: "timeout"; seconds: number }
  | { kind: "shortcut"; reason: ShortcutFailure; detail: string };

export type ShortcutFailure = "error" | "cancel" | "timeout" | "busy" | "unsupported";

export function errorMessageKey(e: TuneError): { key: string; args: string[] } {
  switch (e.kind) {
    case "http": return { key: "error.http", args: [String(e.status), e.detail] };
    case "network": return { key: "error.network", args: [] };
    case "cors-suspected": return { key: "error.corsSuspected", args: [] };
    case "thought-only": return { key: "error.thoughtOnly", args: [] };
    case "empty": return { key: "error.empty", args: [] };
    case "aborted": return { key: "error.aborted", args: [] };
    case "timeout": return { key: "error.timeout", args: [String(e.seconds)] };
    case "shortcut": return { key: `error.shortcut.${e.reason}`, args: [e.detail] };
  }
}

/** „Probe gruen, Chat rot": requestUrl (Main-Prozess, ohne Origin) kommt durch, XHR aus dem
 *  Renderer (Origin app://obsidian.md) nicht — ein lokaler Server ohne CORS-Header.
 *  Muster: koda-agent/src/core/llm/failover.ts (onRefusedDespiteProbe). */
export function classifyNetworkFailure(probeReachable: boolean): TuneError {
  return probeReachable ? { kind: "cors-suspected" } : { kind: "network" };
}

const SHORTCUT_BY_STATUS: Record<number, ShortcutFailure> = { 408: "timeout", 429: "busy", 499: "cancel", 501: "unsupported" };
const SHORTCUT_REASONS: readonly string[] = ["error", "cancel", "timeout", "busy"];

/** Fehlerbild des Kurzbefehl-Transports (Kit `createShortcutsChatTransport`): die Bruecke meldet
 *  Status und einen JSON-Koerper `{ error: { message, reason } }`. Der Grund im Koerper gilt vor
 *  dem Status; ohne lesbaren Koerper entscheidet der Status, der Rest ist „error". */
export function classifyShortcutFailure(status: number, errorText: string | undefined): TuneError & { kind: "shortcut" } {
  let message = errorText ?? "";
  let reason: string | undefined;
  try {
    const e = (JSON.parse(errorText ?? "") as { error?: { message?: unknown; reason?: unknown } }).error;
    if (typeof e?.message === "string") message = e.message;
    if (typeof e?.reason === "string") reason = e.reason;
  } catch { /* kein JSON: Rohtext bleibt als Detail */ }
  const known = reason !== undefined && SHORTCUT_REASONS.includes(reason) ? (reason as ShortcutFailure) : undefined;
  return { kind: "shortcut", reason: known ?? SHORTCUT_BY_STATUS[status] ?? "error", detail: message };
}
