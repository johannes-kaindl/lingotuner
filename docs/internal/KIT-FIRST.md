# Kit-first-Befund und Spec-Abweichungen

Ausgelagert aus der `AGENTS.md` (CORE-AGENT-15). Auslöser: ein Baustein wird neu gebaut, ersetzt oder vendored, oder jemand fragt, woher eine Übernahme stammt. Stand der Tabelle: Sondierung 2026-09-07, Pins seitdem nachgezogen.

| Baustein | Quelle | Form |
|---|---|---|
| `clipboard`, `sse`, `endpoint`, `endpoint_config`, `endpoint_diagnostics`, `model-choice`, `model-list-cache`, `reasoning`, `capabilities`, `think-splitter`, `think-toggle`, `timeout`, `error_body`, `i18n`, `settings`, `stream-blocks`, `sampling-profiles`, `backend-probe`, `redact`, `safe-markdown`, `secrets`, `rounds`, `model-context`, `embeddings-client` | `obsidian-kit` 0.56.0 / `code-kit` 0.23.0 | vendored `src/vendor/kit/` (Liste: `tools/kit-sync.json`) |
| `buildEndpointList`, `renderModelPicker`, `buildModelBar` (die Modellzeile des Panels, seit 2026-10-25; der Eigenbau und die UI-Abweichung „Async Modell-Feld“ entfielen), `confirm`, `settings_walker`, `folder-suggest`, `clipboard`, `buildStreamArea`, `createStableWriter` | `obsidian-kit/src/obsidian/` | vendored `src/vendor/kit-obsidian/` |
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
