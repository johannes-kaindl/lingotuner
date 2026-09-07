# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Fixed

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
