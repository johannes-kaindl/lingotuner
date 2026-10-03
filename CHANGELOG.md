# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.6.1] — 2026-10-03

### Changed

- The changelog is now written entirely in English.

## [0.6.0] — 2026-09-30

### Added

- The GitHub release now also carries a ready-to-unpack `lingotuner.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.
- **Apple Intelligence (on-device) as an endpoint.** With the LLM Endpoint Manager 0.4.0 the endpoint dropdown also offers "Apple Intelligence (on-device)"; a tune then runs through an Apple Shortcut instead of HTTP. Limits: the answer arrives all at once (no stream), is capped at about 4096 tokens, Shortcuts briefly comes to the front, and only one request runs at a time. The Model field stays empty. Failures of the shortcut (timeout, busy, cancelled, error) show their own message instead of an HTTP error. See the new guide "Use the Apple Intelligence endpoint".

### Changed

- obsidian-kit 0.46.0 and code-kit 0.9.0 (was 0.43.0 and 0.7.0, chat client 0.44.0). Brings the shortcut bridge and transport choice; the endpoint dropdown, model picker and other kit parts are updated with it. A source that uses the Shortcuts transport no longer probes a backend.

## [0.5.0] — 2026-09-26

### Changed
- **Chat client from obsidian-kit 0.43.0** (`createChatClient`), replacing the local XHR client. Visible effects:
  - After the first token, a stall of **120 seconds without data** now ends the run with "No answer within 120 seconds". Before, only the wait for the first token was limited (setting *Timeout*), and a stream that went silent later hung forever.
  - A server that **refuses the XHR stream** (origin / CORS check) is retried once without streaming through Obsidian's `requestUrl`; the answer then appears all at once. The "stream blocked (CORS)" message only shows when that request fails as well.
  - HTTP errors carry the server's message on one line, also for `200` answers that hold an error body, and a context overflow is reported as an HTTP error.
  - The Lab recording measures `ttftMs` from the first byte of the answer (also reasoning) as before, now taken from the client's timing.
- **Lab recording through `logToLab`** (kit `lab-client`): a Lab that returns a promise instead of an id no longer slips through, and a Lab with another `apiVersion` is named once per session in the console instead of looking like "no Lab".
- Kit vendoring raised to 0.43.0; the copied styles for the endpoint list (`>` child selectors, so a nested setting keeps its label) and the streaming area (empty status and reasoning slots take no space) follow the kit.

## [0.4.0] — 2026-09-26

### Added
- Help row at the top of the settings with links to the documentation and the issue tracker (English and German).

## [0.3.3] — 2026-09-26

### Added
- **User documentation.** `docs/README.md` as an index, plus *Getting started* and *Troubleshooting* (the messages verbatim from the plugin, each with cause and remedy). The README links them in the "Documentation" section.
- **README images** (hero, rounds, settings, dials), reproducible via `npm run shots`; recording contract in `docs/images/README.md`.

### Fixed
- **The row of the active round was cut off on the left at the default sidebar width.** A button keeps its text on one line and centres the overflow; the row now wraps. The GUI smoke measures this with the new check R1 (at ~300 px, counter-test red on the old state).

### Changed
- `docs/LAB.md` and `docs/SMOKE.md` now live under `docs/internal/` (maintenance material, not user documentation).

## [0.3.2] — 2026-09-25

### Fixed
- **The recording in `llm-lab` was silently off.** The Lab client checked for `apiVersion 3`, but `llm-lab` has delivered version 4 since 2026-09-03 — `readLabApi` therefore returned `null`, and no tune was recorded (without an error message). The client now speaks version 4.

### Added
- Every tune run carries a `turnId` in the Lab recording (one tune = one user action), so that the Lab can bracket related calls.

## [0.3.1] — 2026-09-24

### Changed
- `authorUrl` in the manifest points to the GitHub profile again (return to the Community Store); no functional change.

## [0.3.0] — 2026-09-23

### Changed

- **Sampling values, thinking level and token budget now come from the request profile (`code-kit`
  `sampling-profiles`) instead of a hard-coded temperature.** LingoTuner sends in the mode
  `transform`; the former fixed temperature `0.3` becomes the mode default `0.2` —
  **behaviour change**, visible in the golden request. The old switch "Skip thinking step" is
  migrated once to a thinking level per mode (`suppressThinking: true` → off, `false` → low);
  the old field is no longer stored afterwards.
- New, collapsible "Request" section in the settings (below the endpoint section): shows
  model family and backend, which fields are sent and why, allows own values per family,
  shows the last request sent and deviations of the running session.
- The thinking button in the panel now recognises the model family via the endpoint (LLM
  Endpoint Manager or name guess) instead of a plain name heuristic, and offers four levels
  (off/low/medium/high) where needed instead of only on/off.
- No more `chat_template_kwargs`/`reasoning_budget` in the request body; gpt-oss never gets
  `reasoning_effort: "none"` (the model demonstrably thinks *more* than with `"low"`).

### Fixed

- **Thinking toggle now shows its state without relying on color alone** (UI-STANDARD §8,
  state-button contract) — `aria-pressed` was missing entirely. Fixed: `aria-pressed` follows
  the state on every render, icon switches `brain` ↔ `brain-cog` for on/off instead of always
  showing `brain`. Native `disabled` and the tooltip via `think.hint` were already correct.
- Endpoint list: style for additional and key fields brought up to date (kit 0.37.0).
- An API run (`quiet: true`) no longer shows a `Notice` when a logbook entry fails, but, like
  the override error, writes only to `console.warn` next to it — a foreign caller should not
  push an unrequested message into the user's window.
- The status indicator is now also updated on a pure patch (`patchPanel`, without a full
  draw) — until now it stayed put until the next full draw arrived (harmless today, because
  every caller triggers a full draw anyway, but not a property of the function itself).

## [0.2.0] — 2026-09-15

### Added

- Fetches endpoints from the LLM Endpoint Manager when installed (kit `endpoint-source`
  0.37.0); the local list remains as a fallback. New settings field `choice` (choice versus
  the manager, empty = automatic).

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
