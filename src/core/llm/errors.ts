import { classifyShortcutFailure as classifyKitShortcutFailure, type ShortcutFailure } from "../../vendor/kit/shortcut-failure";

export type TuneError =
  | { kind: "http"; status: number; detail: string }
  | { kind: "network" }
  | { kind: "cors-suspected" }
  | { kind: "thought-only" }
  | { kind: "empty" }
  | { kind: "aborted" }
  | { kind: "timeout"; seconds: number }
  | { kind: "shortcut"; reason: ShortcutFailure; detail: string };

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

/** Fehlerbild des Kurzbefehl-Transports (Kit `createShortcutsChatTransport`): die Klassifizierung
 *  (Grund im Koerper vor dem Status, sonst Status, sonst „error") kommt aus dem Kit; hier wird
 *  daraus der `TuneError` gebaut. */
export function classifyShortcutFailure(status: number, errorText: string | undefined): TuneError & { kind: "shortcut" } {
  return { kind: "shortcut", ...classifyKitShortcutFailure(status, errorText) };
}
