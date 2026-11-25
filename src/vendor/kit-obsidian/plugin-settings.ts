// vendored from obsidian-kit@0.113.0, src/obsidian/plugin-settings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** plugin-settings — den Einstellungs-Tab eines Plugins öffnen (Welle 38, Divergenz-Lauf).
 *
 *  Vertrag: `openPluginSettings(app, pluginId) → boolean`. Öffnet das Einstellungsfenster (`app.setting.open()`) und darin den Tab `pluginId` (`openTabById`); `open()` allein landet auf dem zuletzt benutzten Tab (mailstone `src/main.ts:600`). Rückgabe `true`, wenn danach der Tab `pluginId` aktiv ist; `false`, wenn `app.setting` fehlt oder nicht die erwartete Form hat, wenn Obsidian wirft, oder wenn es keinen Tab dieser Id gibt (dann bleibt das Fenster auf dem zuletzt benutzten Tab offen). Der Aufrufer zeigt bei `false` eine Notice, wo die Einstellungen stehen (3d-codeblocks `src/main.ts:309`, svg-studio `src/main.ts:131`), oder ignoriert es.
 *
 *  `app.setting` ist keine öffentliche API (nicht in `obsidian.d.ts`). Dies ist der **einzige** Ort im Kit mit dem getippten Zugriff: ein schmales Interface über `unknown`, jede Methode vor dem Aufruf auf ihre Form geprüft (Form der Träger anysource-sideloader `src/main.ts:90` und settings-assistant `src/obsidian/apply-modal.ts:9`, die der Store-Lint ohne Befund annimmt). Ob `activeTab` die Wahrheit sagt, misst `pilot/oeffnen.ts`; liest Obsidian kein `activeTab`, gilt der Aufruf ohne Wurf als geöffnet.
 *
 *  Grenzen: öffnet nur, schließt nicht und springt nicht zu einer Zeile im Tab. `closePluginSettings` gibt es nicht, weil kein Träger es braucht.
 *
 *  Herkunft: settings-assistant `src/obsidian/apply-modal.ts:9` (Id als Parameter, Formprüfung), finance-ledger `src/views/emptyState.ts:29` (fängt den Wurf), obsidian-kit `endpoint-source.ts` (`openEndpointManagerSettings`, ruft jetzt diese Funktion). */
import type { App } from "obsidian";

/** Die Form, die das Kit von `app.setting` annimmt. */
interface SettingHost {
  open?: unknown;
  openTabById?: unknown;
  activeTab?: { id?: unknown } | null;
}

/** Öffnet die Einstellungen und darin den Tab `pluginId`; `true`, wenn er danach aktiv ist. Wirft nie. */
export function openPluginSettings(app: App, pluginId: string): boolean {
  const setting = (app as unknown as { setting?: SettingHost }).setting;
  if (!setting || typeof setting.open !== "function" || typeof setting.openTabById !== "function") return false;
  try {
    (setting.open as () => void).call(setting);
    (setting.openTabById as (id: string) => void).call(setting, pluginId);
  } catch {
    return false;
  }
  const active = setting.activeTab;
  if (active === undefined || active === null || typeof active.id !== "string") return true;
  return active.id === pluginId;
}
