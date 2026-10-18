# Gotchas (ausgelagert)

Ausgelagert aus der `AGENTS.md` (CORE-AGENT-15). Jeder Abschnitt nennt seinen Auslöser; die `AGENTS.md` trägt je eine Zeigerzeile.

## lms server start

*Auslöser: lokaler LM-Studio-Server wird gestartet oder CORS-Fehler gesucht*

- **`lms server start` ist weder Statuscheck noch CORS-Schalter.** Jedes fehlende Flag wird auf
  den Default zurückgesetzt und persistiert: `--cors` ohne `--bind` bindet auf `127.0.0.1`
  (sperrt andere Geräte aus, lokal bleibt alles grün), `--bind 0.0.0.0` ohne `--cors` schaltet
  CORS **ab** — und dann scheitert genau dieses Plugin am Preflight, während der Verbindungstest
  weiter grün ist. Immer `lms server start --bind 0.0.0.0 --cors`. Statuscheck ohne Nebenwirkung:
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:1234/v1/models`. Details und
  Werkzeug: `_docs/docs/lokale-llms.md` § „`lms server start` ist weder Statuscheck noch
  CORS-Schalter".

## Zweitinstanz und Restricted Mode

*Auslöser: Plugin lädt in einer Zweitinstanz nicht*

- **Eine Zweitinstanz startet im Restricted Mode — und das sieht aus wie ein kaputtes Plugin.**
  Jede Einzelprüfung gibt Entwarnung (`community-plugins.json` listet es,
  `app.plugins.enabledPlugins` enthält es, das Manifest ist vollständig), nur
  `app.plugins.plugins` ist leer und `loadPlugin(id)` resolved mit `null` — ohne Fehler, ohne
  Konsolenausgabe. Der Treiber ruft deshalb `app.plugins.setEnable(true)`. Ein `npm run deploy`
  oder ein Reload hilft hier **nicht**.

## Gebündelte Obsidian-Version

*Auslöser: Zweitinstanz mit frischem Profil*

- **Ein frisches Profil startet mit der gebündelten Obsidian-Version**, nicht mit der laufenden.
  Für `minAppVersion 1.11.4` ist das meist folgenlos (die gebündelte Version liegt darunter: die `.asar` kopieren ist Pflicht); wer die `.asar` ins Testprofil kopiert, hebt die
  Zweitinstanz gezielt an (Rezept in `docs/internal/SMOKE.md`).

## Fristen und leere Antwort

*Auslöser: Zeitüberschreitung, leere Antwort oder thought-only*

- **Die Fristen sind fest und kein Setting** (seit dem Verbindungs-Tausch, Kit 0.51.2): bis zum ersten
  Token 600 s (`JIT_FIRST_CHUNK_TIMEOUT_MS`, ein erst beim Aufruf ladendes Modell braucht Minuten),
  danach 120 s Stille. Ein Kurzbefehl-Endpunkt hebt die erste Frist auf Kurzbefehl-Frist + 10 s. Ein Modell,
  das minutenlang **denkt**, zählt als Aktivität (Reasoning ist ein Chunk); eine leere Antwort hat mit
  `thought-only` eine eigene Meldung.
- **Ein leerer `content` bei gefülltem `reasoning` ist keine leere Antwort**, sondern ein Modell,
  das sein Token-Budget vollständig ins Denken gesteckt hat (`TuneError.thought-only`).

## LLM Endpoint Manager

*Auslöser: Endpunkt-Auflösung oder Nachbarplugin-Wechsel*

- **Der LLM Endpoint Manager ist optional und wird bei JEDEM Aufruf frisch gelesen** —
  `findEndpointManager(app)` (Kit `endpoint-source`) liest `app.plugins.plugins["llm-endpoint-manager"].api`
  neu, nie aus einem gemerkten Plugin-Feld. Grund: das Nachbarplugin kann jederzeit installiert,
  aktiviert, deaktiviert oder umkonfiguriert werden — ein gecachtes „Manager da/weg" würde nach
  einer solchen Änderung falsch bleiben. `llm.resolve()` (Kit-Verbindung) merkt nur den LOKALEN Pfad bis
  `llm.invalidate()`; „kein Endpunkt“ (Server beim Start aus) wird seit Kit 0.51.3 nicht gemerkt, der Manager-Pfad nie.

## textContent im GUI-Smoke

*Auslöser: Treiber liest Text aus dem Settings-Fenster*

- **`document.textContent` liefert für ein Document-Node per DOM-Spec IMMER `null`** — nur
  Element-/Text-Nodes tragen `textContent`. Gemessen 2026-09-15 beim GUI-Smoke-Ausbau (Abschnitt
  M): ein Treiber-Helfer für das eigene Settings-Fenster (Obsidian ≥1.13) las `root.textContent`
  mit `root = document` und bekam `""` — obwohl `document.querySelectorAll(...)` im SELBEN Skript
  echte Elemente fand. Sah aus wie ein Timing-Flake (mehrere Sleeps/Polls draufgeworfen, halfen
  nichts), war aber ein struktureller Fehler. Fix: `root = document.body`. Wer in einem
  GUI-Smoke-Treiber Text aus einem eigenen Settings-Fenster liest, prüft das zuerst.
