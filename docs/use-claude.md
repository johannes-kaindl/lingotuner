# Use Claude (Anthropic API)

LingoTuner can send a request to Claude through the Anthropic API. The endpoint and your API key live in the LLM Endpoint Manager; LingoTuner only picks it. This page shows how to choose the endpoint and what to expect.

## Before you start

- The [LLM Endpoint Manager](https://github.com/johannes-kaindl/llm-endpoint-manager) plugin, in a version that offers the **Claude API** provider, with an endpoint set up and your own API key stored. The endpoint is created there, not in LingoTuner.
- **Your text leaves your device.** The request goes straight from Obsidian to Anthropic with your key. Choose this endpoint on purpose, not for notes you want to keep local.

## Choose the endpoint

1. Open **Settings → LingoTuner**.
2. In the **Endpoint** dropdown, pick the Claude endpoint.
3. Pick the model, or leave it on the endpoint's default.

The next tune goes to Claude.

## What to expect

- The answer **streams**, and the thinking block shows Claude's thinking while it works.
- **Thinking cannot be turned fully off.** The button offers the lowest effort instead of "off", and the settings say so.
- LingoTuner **does not send sampling values** (temperature, top-p and the like) to Claude. These models refuse them, so the plugin leaves them out.
- A failure in the **middle of the answer** (for example "overloaded") shows the message from the API, and the part that already arrived stays in the preview.

## When it fails

| Message contains | Cause | Fix |
|---|---|---|
| `(401)` | The API key is wrong or missing. | Store the key again in the LLM Endpoint Manager. |
| `(429)` | Rate limit of your Anthropic account. | Wait a moment, then tune again. |
| `(529)` or "Overloaded" | Anthropic is busy. | Tune again later. |

Other messages are in [Troubleshooting](troubleshooting.md).
