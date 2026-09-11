# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../../_docs/CONVENTIONS.md`](../../_docs/CONVENTIONS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-09-07: 0.1.0, erstes Release.** 93 Unit-Tests über 17 Dateien, `npm run gate` grün,
GUI-Smoke 19 grün / 0 rot / 1 übersprungen (Teil C ohne Endpunkt) mit Gegenprobe, Lab-Messung
aller 16 Beispielpaare in beiden Sprachen. Für neue Vorhaben gilt: erst Kit-first-Sondierung
(`../AGENTS.md` + `../REGISTRY.md`), dann `superpowers:brainstorming` → Spec → Plan → TDD.

## Project character

**Projekt:** `lingotuner` (manifest-`id`) — Obsidian-Plugin, das einen Text zwischen
**Kommunikationsstilen dolmetscht**: dieselbe Information, anderer Stil. Vier Regler spannen das
Spektrum zwischen neurodivergenten und neurotypischen Sprachmustern auf (Direktheit, Kontext,
soziale Rahmung, Semantik), eine Anmerkung steuert das Konkrete. Die Verarbeitung läuft über ein
**lokales, OpenAI-kompatibles Modell**; nichts verlässt den Rechner, sofern nicht selbst ein
gehosteter Endpunkt mit Schlüssel eingetragen wird. Autor: Johannes Kaindl.

**Das Produkt ist nicht „LLM schreibt um", sondern die steuerbare, wiederholbare Übersetzung.**
Neun Punkte tragen 0.1 — wer hier kürzt, kürzt das Produkt weg:

1. Vier Regler mit fünf Stufen, **Mitte = unverändert** (erzeugt keine Anweisung).
2. Anmerkung als Freitext, **mit Vorrang vor den Reglern**; allein lauffähig.
3. Presets: vier ausgeliefert (`neutral`, `clarity`, `collegial`, `polite`) + eigene.
4. Runden-Verlauf mit Rückwahl; Nachschärfen baut auf der **aktiven** Runde auf.
5. Drei Quellen (Markierung · aktive Notiz · Textfeld), vier Ausgänge (Markierung ersetzen ·
   Notiz ersetzen · Zwischenablage · neue Notiz).
6. Streamende Vorschau — nie blind schreiben.
7. Anbieter-API für Nachbarplugins, llm-lab-Meldung je Aufruf (beides defensiv).
8. Logbuch als Monatsnotiz (opt-in).
9. Prompts + 32 Beispielpaare im Code, Override-Ordner im Vault („leer = Auslieferungsstand").

**Modellagnostik ist Pflicht** (wie in allen Schwester-Plugins): kein hartkodierter Modellname,
kein Feature, das nur ein Server kann. Das Modell kommt aus `GET /v1/models` des Endpunkts, leer
heißt „Server entscheidet". Reasoning-Modelle sind mitgedacht (`think-splitter`, `suppressParams`).

**Nicht-Ziele 0.1:** Stil-Erkennung des Quelltexts · Neovim/CLI · Cloud-Anbieter als Default ·
Rückfall-Transport (`requestUrl` statt XHR) · vault-weite Läufe · eigenes Chat-Interface ·
Screenshots in der README (`readme-shots` ist 0.2) · Store-Einreichung.

## Architecture principles

**PROF-OBS-03/04 — reiner Kern ohne `obsidian`-Import.** Regler-Modell, Prompt-Bau,
Beispielbank, Runden-Verlauf, Quellen-Guards, Logbuch-Rendering und die Anbieter-API liegen in
`src/core/` und sind in Node ohne DOM-Mock testbar. Nur `main.ts`, Settings-Tab, View und die
IO-Adapter importieren `obsidian`. `npm run check:pure` nagelt das fest.

```
src/core/                pure, obsidian-frei, Vitest
  dials.ts               Level/Dials/Presets, presetFor, isNoop, normalizeDials
  examples/{de,en}.ts     je 16 Vorher/Nachher-Paare (4 Dimensionen x 4 Stufen != 0)
  examples/overrides.ts   Parser Datei -> PromptOverrides (Datei-IO injiziert)
  prompt.ts / prompt-text.ts  buildMessages + der ausgelieferte Systemteil
  session.ts             Round/Session, selectRound, refineFrom
  source.ts              SourceState, Readiness, Staleness (pure Haelfte)
  llm/client.ts          streamTune(transport, ...) -> TuneResult
  llm/errors.ts          TuneError + classifyNetworkFailure
  llm/resolver.ts        Endpunkt-Wahl aus der Liste
  api.ts                 createLingoTunerApi
  logbook.ts             Abschnitt der Logbuch-Notiz rendern
src/obsidian/            view · view-render · editor-io · http · settings-tab ·
                         lab · logbook-io · overrides-io
src/vendor/kit/          obsidian-kit 0.34.0 + code-kit 0.6.0, pure — nie von Hand aendern
src/vendor/kit-obsidian/ Kit-Module, die `obsidian` importieren — nie von Hand aendern
src/i18n/strings.ts      EN kanonisch + DE, beide vollstaendig
src/main.ts
```

**`buildMessages` ist der Kern.** Systemteil (Invarianten) → je Dimension mit `Level ≠ 0` ein
Anweisungsblock mit Stufenname **und genau einem Few-Shot-Paar dieser Stufe** → falls vorhanden
der Anmerkungsblock mit ausdrücklichem Vorrang → Nutzer-Nachricht mit dem Text. Stufe 0 erzeugt
**nichts**; `isNoop(dials, note)` ist deshalb kein Sonderfall, sondern die Konsequenz daraus.
Die Anweisungssprache wird per `lang` benannt, nicht geraten.

**Panel und Anbieter-API gehen denselben Ausführungspfad** (`LingoTunerPlugin.run()`): dieselbe
Endpunkt-Auflösung, derselbe Stream, dasselbe Timeout, dieselbe llm-lab-Meldung. Nur Panel-Zustand
und Ausgänge hängen am Panel. Ein zweiter Weg neben `run()` gehört **nicht** danebengebaut — genau
daran ist in `obsidian-transmute` die Anzeige von der Ausführung abgedriftet.

**View ist zweigeteilt** (`view.ts` baut, `view-render.ts` zeichnet aus dem Zustand). Ein
`empty()` unter dem Cursor nähme Fokus, Cursorposition und den Undo-Stack des Feldes mit.

### Kit-first-Befund (Ergebnis der Sondierung 2026-09-07)

| Baustein | Quelle | Form |
|---|---|---|
| `clipboard`, `sse`, `endpoint`, `endpoint_config`, `endpoint_diagnostics`, `model-choice`, `model-list-cache`, `reasoning`, `capabilities`, `think-splitter`, `think-toggle`, `timeout`, `error_body`, `i18n`, `settings`, `stream-blocks` | `obsidian-kit` 0.34.0 / `code-kit` 0.6.0 | vendored `src/vendor/kit/` |
| `buildEndpointList`, `renderModelPicker`, `confirm`, `settings_walker`, `folder-suggest`, `clipboard`, `buildStreamArea`, `createStableWriter` | `obsidian-kit/src/obsidian/` | vendored `src/vendor/kit-obsidian/` |
| XHR-Stream-Transport | `vault-rag/src/sse.ts` | Übernahme mit Herkunftsstempel |
| `splitStable` (stabile Vorschau-Blöcke) | erst Übernahme aus `koda-agent`, seit 2026-09-11 vendored aus `code-kit` 0.6.0 | vendored `src/vendor/kit/stream-blocks.ts` |
| Streaming-Antwortbereich + inkrementeller Markdown-Schreiber | `obsidian-kit` 0.34.0 (`buildStreamArea`, `createStableWriter`) | vendored — LingoTuner ist der erste Konsument |
| CORS-Fall „Probe grün, Chat rot" | `koda-agent/src/core/llm/failover.ts` (`onRefusedDespiteProbe`) | Muster → `classifyNetworkFailure` |
| Runden-Verlauf | `obsidian-transmute/src/core/{types,session}.ts` | Übernahme (3. Exemplar → Kit-Kandidat) |
| Selektion mitschreiben + Guards | `vault-rag/src/main.ts`, `reformat_selection_state.ts` | Übernahme (2. Exemplar) |
| `splitSelectionAffix` (Rand-Whitespace) | `vault-rag/src/reformat_mechanical.ts` | Übernahme |
| Anbieter-API-Form (`apiVersion`, `ok`-Union) | `vault-rag/src/plugin_api.ts`, `local-image-generator` | Muster |
| llm-lab-Aufruf | `llm-lab/src/plugin_api.ts` (`log(input)`, synchron) | Konsument |
| Release/Lint/Gate | `../tools/release-template/` via Skill `plugin-release-setup` | Vorlage |

Jede Übernahme trägt `// uebernommen aus <repo>/<pfad>, <YYYY-MM-DD>` in Zeile 1
(Dach-`AGENTS.md` Punkt 1) — der Stempel ist die Voraussetzung dafür, dass die Extraktions-Schwelle
echte Instanzen zählt und keine Kopier-Kette.

**Vier bewusste Abweichungen von der Spec** (im Cockpit unter `_SDD/` nachgetragen):
Override-Dateiname `<dimension>_<level>.md` statt `-` (das negative Vorzeichen kollidiert sonst) ·
`tune()` liefert eine `ok`-diskriminierte Union statt `Promise<string>` (Haus-Muster) ·
Denken-Schalter aus `code-kit` (`think-toggle`) statt Kopie aus transmute ·
`splitStable` aus koda-agent, nicht aus vault-rag (dort nur Rohtext-Vorschau).

## Commands

```bash
npm run dev / build / deploy      # esbuild watch · prod-Bundle (tsc + esbuild) · Copy nach $OBSIDIAN_PLUGIN_DIR
npm run lint                      # check-no-inline-disables + eslint src --max-warnings 0
npm test                          # NUL-Byte-Check + vitest run (93 Tests)
npm run typecheck                 # tsc --noEmit (dazu: typecheck:test, typecheck:scripts)
npm run check:pure                # src/core darf `obsidian` nicht importieren
npm run gate                      # lint + alle Typechecks + test + check:pure + build
npm run lab:tune                  # Prompt-Lab gegen den lokalen Endpunkt (scripts/tune-lab.ts)
npm run smoke:gui                 # GUI-Smoke gegen ein laufendes Obsidian (scripts/gui-smoke.ts)
npm run release / version-bump / preflight   # delegieren ans zentrale ../tools/release/ (Dach)
```

**Lab** (Prompt-Qualität messen statt behaupten — ein Lauf ist eine Anekdote):

```bash
npm run lab:tune -- --model qwen/qwen3.6-35b-a3b --lang de --runs 2
npm run lab:tune -- --dim directness --runs 2      # gezielter Nachlauf einer Dimension
```

**GUI-Smoke** läuft in einer **Zweitinstanz** (eigenes `--user-data-dir`, eigener Port) — die
reguläre Instanz auf `9222` gehört möglicherweise einer anderen Session und wird nicht angefasst:

```bash
npm run build && npm run smoke:gui -- --setup      # Staging-Vault aus fixtures/vault/ bauen
# Zweitinstanz starten (Rezept vollständig in docs/SMOKE.md), dann:
npm run smoke:gui -- --port 9341
```

Vor jedem CDP-Zugriff den Lock nehmen (`obsidian-cdp-lock.py acquire --exclusive focus --ttl 300`)
und **unmittelbar nach dem Lauf** freigeben — Committen und Doku brauchen den Port nicht.

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **TDD** (`superpowers:test-driven-development`): der reine Kern wird test-first gebaut. Ein
  Test führt alle 32 Beispielpaare durch `buildMessages` — kein Paar darf still fehlen.
- **Tests:** vitest; Obsidian-Mock aus `obsidian-kit/testing` (Skill
  `obsidian-plugin-test-pattern`). `tsc --noEmit` läuft separat (vitest ≠ tsc).
- **UI:** [`../UI-STANDARD.md`](../UI-STANDARD.md) ist verbindlich — **vor** jeder View-/Modal-/
  Settings-Arbeit lesen, auch wenn `ui_adoption_check` grün meldet (der Check sieht die Typografie
  nicht). Alle Metazeilen tragen `--font-ui-small`/`--font-ui-smaller`, nur Theme-Variablen.
- **i18n:** nutzersichtbare Strings via `t()` aus `src/i18n/strings.ts`, EN kanonisch, DE
  vollständig (PROF-OBS-07, UI-STANDARD §10). Kein Fachbegriff ohne Auflösung. **Frontmatter-Keys
  und Logbuch-Struktur bleiben englisch** — sie persistieren im Nutzer-Vault, eine Migration
  erreicht fremde Vaults nie.
- **Vendoring:** `src/vendor/**` wird **nie von Hand** geändert — `tools/sync-kit.sh` schreibt
  beide Bäume aus einer festen Ref (CORE-META-22) und aktualisiert beide `VENDOR.json`.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien
  stagen**, nie `git add -A`. Trailer bei substanziellem AI-Beitrag.

## UI-Abweichungen

Deklaration nach `UI-STANDARD.md` §1a — von einem verbindlichen §8-Baustein abzuweichen ist
erlaubt, stillschweigend abzuweichen nicht.

- **Modell-Auswahl im Panel ist ein reines Dropdown ohne Freitext-Fallback** (§8 „Async
  Modell-Feld" verlangt beides). Grund: das Panel ist der Schnellwechsler; das verbindliche Feld
  mit Freitext trägt der Settings-Tab über den Kit-Picker.
  `gilt-solange:` `src/obsidian/settings-tab.ts` ruft `renderModelPicker` aus
  `src/vendor/kit-obsidian/model-picker.ts`.
- **Status-Indikator kennt einen fuenften Zustand „bereit" mit Icon `circle` und ohne `is-*`-Klasse**
  (§8 nennt vier Zustaende/Icons). Grund: vor dem ersten Lauf ist weder Erfolg noch Fehler wahr —
  ein gruener Haken neben „Bereit" behauptete einen Erfolg, den es nicht gab (Final-Review 2026-09-07).
  `gilt-solange:` `paintStatus` in `src/obsidian/view-render.ts` setzt fuer `phase === "idle"` das Icon
  `circle` und keine Zustandsklasse; `aria-label` bleibt gesetzt.

## Gotchas

- **CORS: Probe grün, Chat rot.** `requestUrl` läuft im Main-Prozess ohne Origin und kommt durch;
  der Stream läuft per XHR aus dem Renderer mit Origin `app://obsidian.md` und wird von einem
  lokalen Server ohne CORS-Header abgelehnt — **ohne Status, ohne Body**. Ein Netzwerkfehler ohne
  Status wird deshalb nicht als „Server nicht erreichbar" gemeldet, sondern über eine
  Nachprobe (`classifyNetworkFailure`) als `cors-suspected` mit dem konkreten Schalter.
- **`lms server start` ist weder Statuscheck noch CORS-Schalter.** Jedes fehlende Flag wird auf
  den Default zurückgesetzt und persistiert: `--cors` ohne `--bind` bindet auf `127.0.0.1`
  (sperrt andere Geräte aus, lokal bleibt alles grün), `--bind 0.0.0.0` ohne `--cors` schaltet
  CORS **ab** — und dann scheitert genau dieses Plugin am Preflight, während der Verbindungstest
  weiter grün ist. Immer `lms server start --bind 0.0.0.0 --cors`. Statuscheck ohne Nebenwirkung:
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:1234/v1/models`. Details und
  Werkzeug: `_docs/docs/lokale-llms.md` § „`lms server start` ist weder Statuscheck noch
  CORS-Schalter".
- **Eine Zweitinstanz startet im Restricted Mode — und das sieht aus wie ein kaputtes Plugin.**
  Jede Einzelprüfung gibt Entwarnung (`community-plugins.json` listet es,
  `app.plugins.enabledPlugins` enthält es, das Manifest ist vollständig), nur
  `app.plugins.plugins` ist leer und `loadPlugin(id)` resolved mit `null` — ohne Fehler, ohne
  Konsolenausgabe. Der Treiber ruft deshalb `app.plugins.setEnable(true)`. Ein `npm run deploy`
  oder ein Reload hilft hier **nicht**.
- **Ein frisches Profil startet mit der gebündelten Obsidian-Version**, nicht mit der laufenden.
  Für `minAppVersion 1.8.7` ist das folgenlos; wer die `.asar` ins Testprofil kopiert, hebt die
  Zweitinstanz gezielt an (Rezept in `docs/SMOKE.md`).
- **„Notiz ersetzen" ersetzt nur den Body — das Frontmatter bleibt.** Ersetzt wird über den
  Editor (also Cmd+Z-fähig), und der Bereich beginnt hinter dem Frontmatter-Block. Wer hier auf
  `vault.modify` mit dem ganzen Dateiinhalt umbaut, zerstört Frontmatter **und** den Undo-Stack.
- **Override „leer = Auslieferungsstand".** Der Default des Ordners ist `""`, und beim ersten
  Öffnen wird **nichts** in den Vault kopiert. Nur so erreichen spätere Prompt-Verbesserungen
  bestehende Nutzer. Der Knopf „Auslieferungsstand in den Ordner schreiben" ist eine explizite
  Nutzeraktion und überschreibt vorhandene Dateien nicht. Eine kaputte Override-Datei ist eine
  Meldung + Auslieferungsstand, kein Abbruch.
- **Das Zeitlimit gilt bis zum ersten Content-Token, nicht bis zum Ende.** `onToken` löscht den
  Timer; eine lange Antwort wird nie abgeschnitten. Die Kehrseite: ein Modell, das minutenlang
  **denkt**, läuft ins Timeout, weil Reasoning über `onReasoning` läuft und den Timer nicht
  anfasst — das ist gewollt (der Fall hat mit `thought-only` eine eigene Meldung).
- **Ein leerer `content` bei gefülltem `reasoning` ist keine leere Antwort**, sondern ein Modell,
  das sein Token-Budget vollständig ins Denken gesteckt hat (`TuneError.thought-only`).
- **Ersetzen-Guards sind zwei Fragen, nicht eine:** *live* (dieselbe Editor-Instanz, derselbe
  `file.path`, `getMode() === "source"`) und *stale* (Text an der Stelle seit dem Einlesen
  unverändert). Beide verweigern nur die Ersetzen-Ausgänge; Kopieren und „Neue Notiz" bleiben.
- **Die Markierung wird proaktiv mitgeschrieben** (`SelectionTracker`), weil ein Klick ins Panel
  den Editor-Fokus nimmt — zum Zeitpunkt des Knopfdrucks gibt es keine Markierung mehr.
- **`main.js`** ist Build-Artefakt, **`data.json`** ist Obsidian-persistierte Konfiguration —
  beide git-ignored.
- **Release-CI ist GitHub-only** (`.github/` wird von Forgejo ignoriert) und läuft hier
  bewusst nicht, siehe unten.

## Memory

**Cockpit:** `$VAULT/25_Coding/lingotuner/` (Stand, Tasks, Session-Log, Entscheidungen —
mnemetisches Substrat/SSOT). **SDD-Artefakte (Spec/Plan) liegen dort unter `_SDD/`, nicht im
Repo** (CORE-META-14) — das Repo behält die verdichtete Design-Essenz hier und im CHANGELOG.
**Nie absolute Pfade außerhalb des Repos in Repo-Dateien** — Platzhalter (`$VAULT/…`) verwenden.

Dieses Repo liegt unter dem Koordinations-Dach `obsidian-plugins/` und ist ein **eigenständiges
Git-Repo** (PROF-OBS-09). **Vor dem Lösen eines Problems:** [`../AGENTS.md`](../AGENTS.md)
(Kit-first-Regel) und [`../REGISTRY.md`](../REGISTRY.md) prüfen.

## Abweichungen von der Leitkonvention

- **Kein GitHub-Mirror, kein Store-Release.** Das Repo ist am 2026-09-07 ohne `github`-Remote
  angelegt worden; `npm run release` fährt fest mit `--no-github` (im `package.json` verdrahtet,
  nicht als Tipp-Disziplin), und `lingotuner` steht in `tools/mirror_drift_check.py::AUSNAHMEN`.
  Grund: der GitHub-Ausstieg des Workspace (das Konto ist geflaggt) — die Verteilung läuft über
  den Forgejo-Release und den `anysource-sideloader`-Katalog. Wer das Flag entfernt, ohne ein
  `github`-Remote einzurichten, bekommt einen harten Abbruch; wer das Remote löscht, ohne das
  Flag zu setzen, zerstört die Releases.
- **`origin` ist Forgejo (`git.jkaindl.de:jkaindl/lingotuner`) und die einzige Quelle.** Das
  Repository ist **privat** — der Katalog-Eintrag folgt, sobald es öffentlich geschaltet wird
  (ein Katalog-Eintrag auf ein privates Repo wäre ein toter Eintrag, weil der Sideloader die
  Releases über die Forge-API liest).
- **Keine Screenshots in der README.** `readme-shots` ist auf 0.2 vertagt; die README trägt
  deshalb einen Hero-**Absatz** statt eines Hero-Bildes.
