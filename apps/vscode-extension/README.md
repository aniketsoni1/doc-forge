# DocForge for VS Code

Generate polished **Markdown** or **HTML** documents from a prompt — using whatever AI you already have, with an always-on **offline fallback** so it never hard-fails.

![DocForge](https://raw.githubusercontent.com/aniketsoni1/docforge/main/assets/hero.png)

## What it does

Run **DocForge: New Document from Prompt**, describe what you want, pick a format and a generator, and DocForge opens a live, themed, sanitized preview you can **Insert** into the editor or **Save** to disk.

DocForge resolves the best available generator in a transparent priority ladder and always tells you which one ran:

1. **VS Code Language Model API** — the sanctioned, vendor-neutral way to use Copilot and other LM providers.
2. **Compatible AI extension** — best-effort, only via a documented `generateDocument` API.
3. **Bring-your-own-key** — Anthropic or OpenAI, key stored in VS Code SecretStorage.
4. **Built-in templates** — deterministic, fully offline, always available.

If no AI is available (or the workspace is untrusted, or you're offline), DocForge still produces a clean document from its built-in templates.

## Features

- Prompt-to-document for Markdown and sanitized, themed HTML
- Live preview webview with a strict Content-Security-Policy
- Generator picker (Auto / a specific model / Built-in templates)
- Provenance line — never wonder which generator produced the output
- Insert-into-editor and Save-as actions
- Respects Workspace Trust: untrusted workspaces use the offline generator only
- No telemetry; AI/network calls are opt-in and disclosed

## Commands

| Command | Description |
| --- | --- |
| `DocForge: New Document from Prompt` | The main flow (default keybinding `Ctrl/Cmd+Alt+D`) |
| `DocForge: Set API Key` | Store a BYO key in SecretStorage |
| `DocForge: Clear API Key` | Remove the stored key |

## Settings

- `docforge.defaultFormat` — `md` or `html`
- `docforge.tone`, `docforge.length`
- `docforge.enableAi` — turn off to force the offline template generator
- `docforge.provider`, `docforge.model` — for the BYO-key generator

## Privacy & security

Local-first by default. The template generator is fully offline. AI generators are opt-in; keys live in SecretStorage and are never written to settings. All model HTML is sanitized against an allowlist before it is shown or saved, and every webview uses a strict CSP.

## License

Apache-2.0 © aniketsoni1
