# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Fixed
- **Die Aufzeichnung in `llm-lab` war still aus.** Der Lab-Client prüfte `apiVersion 3`, `llm-lab` liefert seit 0.7 die Fassung 4 — `readLabApi` gab deshalb `null` zurück, und kein Tunen wurde aufgezeichnet (ohne Fehlermeldung). Der Client spricht jetzt Fassung 4.

### Added
- Jeder Tunen-Lauf trägt eine `turnId` in der Lab-Aufzeichnung (ein Tunen = eine Nutzer-Handlung), damit das Lab zusammengehörige Aufrufe klammern kann.

## [0.3.1] — 2026-09-24

### Changed
- `authorUrl` im Manifest zeigt wieder auf das GitHub-Profil (Rückkehr in den Community Store); keine Funktionsänderung.

## [0.3.0] — 2026-09-23

### Changed

- **Sampling-Werte, Denkstufe und Tokenbudget kommen jetzt aus dem Anfrage-Profil (`code-kit`
  `sampling-profiles`) statt aus einer fest eingetragenen Temperatur.** LingoTuner sendet im
  Modus `transform`; die bisherige feste Temperatur `0.3` wird zur Modus-Vorgabe `0.2` —
  **Verhaltenswechsel**, sichtbar im goldenen Request. Der alte Schalter „Denkschritt
  überspringen" wird einmalig zu einer Denkstufe je Modus migriert (`suppressThinking: true` →
  aus, `false` → niedrig); das alte Feld wird danach nicht mehr gespeichert.
- Neuer, aufklappbarer Abschnitt „Anfrage" in den Einstellungen (unter dem Endpunkt-Abschnitt):
  zeigt Modellfamilie und Backend, welche Felder gesendet werden und warum, erlaubt eigene
  Werte je Familie, zeigt die letzte gesendete Anfrage und Abweichungen der laufenden Sitzung.
- Der Denk-Knopf im Panel erkennt die Modellfamilie jetzt über den Endpunkt (LLM Endpoint
  Manager oder Namensschätzung) statt über eine reine Namensheuristik, und bietet bei Bedarf
  vier Stufen (aus/niedrig/mittel/hoch) statt nur an/aus.
- Kein `chat_template_kwargs`/`reasoning_budget` mehr im Anfrage-Body; gpt-oss bekommt nie
  `reasoning_effort: "none"` (das Modell denkt dabei nachweislich *mehr* als bei `"low"`).

### Fixed

- **Thinking toggle now shows its state without relying on color alone** (UI-STANDARD §8,
  state-button contract) — `aria-pressed` was missing entirely. Fixed: `aria-pressed` follows
  the state on every render, icon switches `brain` ↔ `brain-cog` for on/off instead of always
  showing `brain`. Native `disabled` and the tooltip via `think.hint` were already correct.
- Endpunkt-Liste: Stil für Zusatz- und Schlüsselfelder nachgezogen (Kit 0.37.0).
- Ein API-Lauf (`quiet: true`) zeigt bei einem fehlgeschlagenen Logbuch-Eintrag keine `Notice`
  mehr, sondern schreibt wie der Override-Fehler daneben nur nach `console.warn` — ein
  Fremdaufruf soll dem Nutzer keine unangeforderte Meldung ins Fenster schieben.
- Der Status-Indikator wird jetzt auch bei einem reinen Patch (`patchPanel`, ohne Voll-Draw)
  nachgezogen — bislang blieb er stehen, bis der nächste Voll-Draw kam (heute folgenlos, weil
  jeder Aufrufer ohnehin einen Voll-Draw auslöst, aber keine Eigenschaft der Funktion selbst).

## [0.2.0] — 2026-09-15

### Added

- Bezieht Endpunkte vom LLM Endpoint Manager, wenn installiert (Kit `endpoint-source` 0.37.0);
  lokale Liste bleibt Rückfall. Neues Settings-Feld `choice` (Wahl gegenüber dem Manager, leer =
  automatisch).

## [0.1.2] — 2026-09-11

### Changed

- The streaming answer area now comes from obsidian-kit 0.34.0 (`buildStreamArea`, `createStableWriter`) instead of being built here; LingoTuner is its first consumer. Same behaviour, one shared building block.
- The panel is one single scrolling area. Nothing inside it shrinks or gets cut off any more — with a long result the output buttons sit below the answer and take a scroll to reach.

### Fixed

- On a short panel the dials, the text field and the output buttons all stay reachable: instead of dividing a fixed height between the controls and the preview, the whole panel scrolls.

## [0.1.1] — 2026-09-07

### Added

- A "Reset" button in the run row clears session, preview, reasoning, note and text field and cancels a running stream. It appears as soon as there is something to reset, and asks before discarding a session that already has rounds. The dials stay as they are.

### Fixed

- Typing survives the end of a run: the final redraw puts focus and cursor back into the field they were in, instead of dropping them on `<body>` while you wait for the result.
- The output buttons stay reachable on a short panel: the preview floor yields (`min(14em, 40%)`) instead of pushing them out of a panel that clips its overflow.
- Streaming no longer yanks the view back to the bottom while you are reading further up; it follows only when you are already at the end.
- The text field can be typed into again: a caret move inside the panel no longer redraws it, so the field under the cursor survives (it was rebuilt on every `selectionchange`, which took the focus away immediately).
- Long output stays inside its own scrolling preview box instead of running on top of the four output buttons; the action bar now sits below it and keeps its place.
- The run row (tune, refine, reset, model) stays put instead of scrolling out of reach once a result fills the panel.
- Model reasoning is streamed into an open block as it arrives, above the answer, instead of appearing only once the run has finished.
- The run timeout is now cleared by the first token of any kind, so a reasoning model that thinks for a while before answering is no longer cut off.
- A new note made from a text-field run is named with a date stamp instead of whatever note happened to be selected; a run from a note keeps that note's name through every refine round.
- The active endpoint is resolved once at load, so the settings list marks the active row before the first run instead of after it.
- An unreadable override file is reported only when the set of problems changes, and never as a notice for runs started through the plugin API.
- The root of a refine chain is found by a tested pure function instead of a private view method.
- A stream started with an already-aborted signal now rejects instead of hanging forever.
- The status indicator is neutral before the first run instead of showing a green success state, and a cancelled round is marked as cancelled in the round list.
- Disabled chips, model picker and history rows are visibly disabled; the truncation warning uses the warning colour instead of the error colour.
- The model list arriving mid-stream no longer redraws the panel and tears down the preview.
- The logbook dial line is localized only — the English duplicate behind it is gone.
- README and `docs/LAB.md` state what the lab run actually measured.

## [0.1.0] — 2026-09-07

### Added

- Four style dials, a note field, streaming preview, presets, round history, four outputs, provider API, llm-lab logging, logbook.
