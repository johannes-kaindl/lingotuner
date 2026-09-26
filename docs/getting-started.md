# Getting started

This walk-through takes you from a fresh install to a text rewritten in a different communication style. It needs about ten minutes and a local model server.

## 1. Start a local model server

LingoTuner talks to any OpenAI-compatible server. The default address is `http://127.0.0.1:1234`, which is what [LM Studio](https://lmstudio.ai) uses out of the box.

1. Start the server and load a chat model. A mid-size model gives the best results; a very small one tends to shorten the text instead of rephrasing it.
2. In LM Studio, enable CORS in the server settings (or start it with `lms server start --cors`). Ollama needs `OLLAMA_ORIGINS=app://obsidian.md` instead. Without this, the connection test is green and the result arrives only all at once, or not at all — see [Troubleshooting](troubleshooting.md#stream-blocked-cors).

New to local models? The [local LLM setup guide](https://uplink.jkaindl.de/llm-setup) covers server, model and access from other devices.

## 2. Install and enable the plugin

Follow one of the [install routes in the README](https://github.com/johannes-kaindl/lingotuner/blob/main/README.md#install), then enable **LingoTuner** under **Settings → Community plugins**.

## 3. Check the connection

Open **Settings → Community plugins → LingoTuner**. In the **Endpoints** list the first row already holds `http://127.0.0.1:1234`. Its status line should read **Connected**. If your server runs elsewhere, change the address there.

Leave **Model** empty to let the server use whatever model it has loaded, or press **Load models** and pick one.

## 4. Open the panel

Click the sliders icon in the ribbon, or run the command **Open panel** from the command palette. The panel opens in the sidebar next to your note.

## 5. Tune a text

1. Open a note in editing mode and select a sentence or two, for example an email you received.
2. In the panel, the status line reads "Selection: … characters in …". If you would rather paste text, choose **Text field** as the source instead.
3. Pick a preset such as **Maximum clarity**, or move a dial. Each dial has five steps; the middle one leaves that dimension alone.
4. Optionally write a **Note**, for instance "use first names". It outranks the dials.
5. Press **Tune**. The result streams into the preview.

## 6. Take the result out

Choose one of the four buttons under the preview:

- **Replace selection** puts the text where the selection was. Cmd+Z (Ctrl+Z) undoes it in one step.
- **Replace note** replaces the whole body after asking; the frontmatter stays.
- **Copy** puts the text on the clipboard.
- **New note** creates a note in the vault root, or in the folder you set under **Folder for new notes**.

Not quite right? **Refine this result** applies a new note to the result you are looking at, and **Tune again from source** starts over from the original text. Every run is kept under **Rounds**.

## Where to go next

- Save a dial combination you like with **Save as preset**.
- Explore the other settings in the [README](https://github.com/johannes-kaindl/lingotuner/blob/main/README.md#configuration).
- Something went wrong? [Troubleshooting](troubleshooting.md).
