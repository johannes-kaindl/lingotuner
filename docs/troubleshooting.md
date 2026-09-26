# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## No reachable endpoint

> No reachable endpoint. Check the connection in the settings.

**Cause:** none of the addresses under **Endpoints** answered. In the settings each row shows its own status; the wording says why:

| Row status | Meaning |
|---|---|
| Connection refused — server not running or wrong port. | The server is off, or the port in the address is wrong. |
| Unknown host — typo in the address? | The host name does not resolve. |
| Timed out — network unreachable. | The machine is not reachable from here. |
| Answers, but is not an OpenAI-compatible endpoint. | Something answers, but it is not a chat-completions server. |
| Access denied — API key missing or invalid. | The server wants an API key. Enter it on that row. |

**Fix:** start the server and load a model, then press **Test connection** in the settings. Local servers usually need a port, for example `http://127.0.0.1:1234`.

## Stream blocked (CORS)

> The server is reachable, but the stream was blocked by the browser (CORS). In LM Studio enable CORS in the server settings; for Ollama set OLLAMA_ORIGINS=app://obsidian.md.

**Cause:** the result is streamed from the origin `app://obsidian.md`, and a server can answer a plain request while refusing that origin. The connection test passes, the stream does not. The plugin then retries once without streaming, and you only see this message when that request fails as well.

**Fix:** in LM Studio switch on CORS in the server settings, or start it with `lms server start --bind 0.0.0.0 --cors`. For Ollama set `OLLAMA_ORIGINS=app://obsidian.md` and restart it.

## The model only reasoned

> The model only reasoned and returned no text. Turn thinking off or raise the token limit.

**Cause:** a reasoning model used its whole token budget on thinking.

**Fix:** switch thinking off with the thinking button in the panel, or raise the token budget under **Settings → LingoTuner → Request**.

## The answer was cut off

> The answer was cut off by the token limit — the result may be incomplete.

**Cause:** the model hit the token budget mid-answer. The partial text is kept, with this warning.

**Fix:** raise the token budget under **Request**, or tune a shorter text.

## No answer in time

> No answer within {N} seconds. Check the server or raise the timeout in the settings.

**Cause:** no first token arrived within the timeout (60 seconds by default), or an answer that had started went silent for 120 seconds. Big models can need longer to load.

**Fix:** raise **Timeout (seconds)** in the settings, or load the model in the server before you press **Tune**. The setting only covers the wait for the first token; once streaming has started, only 120 seconds without any data end it.

## The server rejected the request

> The server rejected the request ({status}): {message}

**Cause:** the server answered with an error, for instance because no model is loaded or the model name in **Model** does not exist there.

**Fix:** load a model in the server, or clear **Model** to let the server pick, or press **Load models** and choose one from the list.

## Tune does nothing

> All dials are in the middle and the note is empty — nothing to change.

**Cause:** with every dial in the middle and no note there is no instruction to give, so nothing is sent.

**Fix:** move a dial, pick a preset, or write a note. A note alone is enough.

## The panel says it cannot use the text

| Status line | What to do |
|---|---|
| Select some text in a note first. | Select text in the editor, or switch the source to **Active note** or **Text field**. |
| Open a note in the main area first. | Open a note in the main editor area. |
| The note is in reading mode — switch to editing mode to use it. | Switch the note to editing mode. |
| Paste or type the text to tune. | The **Text field** source is empty. |

## The replace buttons are greyed out or refuse

> The note changed since it was read — select or reload before writing.
> The note is no longer open in editing mode — nothing was written.
> The selection or note changed since this result was made — select the original text again or tune anew.

**Cause:** **Replace selection** and **Replace note** only work while the source is still live: the same note, still in editing mode, with the text unchanged since it was read. The plugin refuses rather than overwrite something you edited in the meantime.

**Fix:** select the original text again, or press **Tune again from source**. **Copy** and **New note** always work.

## The endpoint list is managed elsewhere

If the LLM Endpoint Manager plugin is installed, the settings show "Endpoints come from the LLM Endpoint Manager". Then the endpoint and model are chosen there, and the local list in this plugin is only a fallback. To change the address or the model, press **Open manager settings**.

> The endpoint chosen in the LLM Endpoint Manager needs an API key that isn't stored yet. Check it there, not in this plugin's local list.

**Fix:** open the manager and store the key for that endpoint.

## Your override file is ignored

> Override file could not be read, shipped text used: {file}

**Cause:** a file in your **Override folder** could not be read. The shipped text is used for that part instead, so nothing breaks.

**Fix:** check that the file is named `system.md` or `<dimension>_<level>.md` (for example `directness_-2.md`; only the levels −2, −1, 1 and 2 have files) and lives directly in the folder. An example file needs a `## before` and a `## after` heading, each followed by text. **Write shipped texts into the folder** creates all of them as a starting point.

## Getting help

Open an issue at <https://github.com/johannes-kaindl/lingotuner/issues>. Say which model and server you use, what you did, and the exact text of any message.
