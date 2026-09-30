# Use the Apple Intelligence endpoint

LingoTuner can send a request to Apple's on-device model instead of a server. The request runs through an Apple Shortcut, so nothing leaves your device and no server has to run. This page shows how to choose that endpoint and what to expect from it.

## Before you start

- The [LLM Endpoint Manager](https://github.com/johannes-kaindl/llm-endpoint-manager) plugin, version 0.4.0 or newer, with the endpoint **Apple Intelligence (on-device)** set up. The endpoint and the shortcut it calls are created there, not in LingoTuner. The setup is described at <https://uplink.jkaindl.de/apple-shortcuts>.
- Shortcuts and Apple Intelligence on the device that runs Obsidian.

## Choose the endpoint

1. Open **Settings → LingoTuner**.
2. In the **Endpoint** dropdown, pick **Apple Intelligence (on-device)**.
3. Leave the **Model** field empty. The shortcut decides which model answers.

A note below the dropdown repeats the limits. The next tune goes through the shortcut.

## What to expect

- The answer arrives **all at once**. The preview stays empty until the shortcut is done; there is no stream.
- The answer is limited to about **4096 tokens**.
- The **Shortcuts app comes to the front** for a moment and then returns to Obsidian.
- Only **one request at a time** runs. A second tune during the first one is refused.
- The endpoint cannot call tools. LingoTuner does not need them.
- The wait is bounded by the timeout of the shortcut, set in the LLM Endpoint Manager. LingoTuner waits at least that long plus ten seconds, so the shortcut can report its own timeout first.

## When it fails

The messages and their fixes are in [Troubleshooting](troubleshooting.md#the-apple-intelligence-shortcut-fails).
