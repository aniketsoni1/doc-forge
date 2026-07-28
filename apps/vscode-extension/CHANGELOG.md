# Changelog

All notable changes to the DocForge VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-28

### Added

- **DocForge: Improve Selected Text** (`Ctrl/Cmd+Alt+I`) - select text, choose one
  of 15 transforms, review a diff, then accept, reject or regenerate. Four
  transforms (prose ↔ bullets, add headings, executive summary) are
  deterministic and need no provider at all; the picker marks which is which.
- **DocForge: Regenerate Section** - rewrite one section, chosen from the
  document outline with the section under the cursor offered first. Neighbouring
  sections are preserved exactly, because the replacement is spliced at parsed
  character offsets rather than matched by string.
- **DocForge: Run Diagnostics** - generator availability plus the last
  generation's full attempt trail.
- Streaming drafts in the preview, rendered as text rather than markup because
  streamed output has not been sanitized yet.
- Copy action and a Cancel button in the preview.
- A diff before overwriting an existing file when saving.
- Grouped settings (Generation / Providers / Reporting), plus
  `docforge.requestTimeoutMs` and `docforge.pricing`.
- Token, cost and duration reporting, always labelled when estimated.

### Fixed

- Cancelling now aborts the in-flight provider request. The Language Model path
  previously created a cancellation token it never used, and the BYO-key path
  had no timeout at all, so a hung connection hung the editor indefinitely.
- Rapid regeneration could race, with the later-resolving result winning
  regardless of which the user started last. Superseded results are discarded.
- Webview messages are validated at runtime instead of being trusted on the
  strength of a TypeScript annotation.
- Provider failures report which generator failed, why, and what to do next,
  rather than surfacing a bare message.
- Dropped `retainContextWhenHidden` from the preview panel.

### Security

- Provider error bodies are redacted and truncated before being shown or logged.
- Rewritten HTML fragments pass through the same sanitizer allowlist as
  generated documents.

### Known limitations

- Eleven of the fifteen transforms require an AI provider. The four deterministic
  ones are structural rather than semantic.
- Whether streaming arrives incrementally depends on the provider: the VS Code
  Language Model API streams; the bring-your-own-key path returns in one piece.
- PDF and DOCX export, the Document Studio, workspace-aware generation, the
  prompt library and validation diagnostics are not implemented yet.

## [0.1.1] - 2026-07-18

### Changed

- Corrected publisher id to `AniketSoni` and set a unique display name
  `DocForge - Document Generator`.
- Normalized punctuation to plain hyphens; repository links point to `doc-forge`.

## [0.1.0] - 2026-07-18

### Added

- New Document from Prompt command with an input box and format picker.
- Generator picker (Auto / specific model / Built-in templates) driven by a live capability probe.
- Priority ladder: VS Code Language Model API, compatible AI extension, bring-your-own-key, and the deterministic template generator.
- Live preview webview with a strict Content-Security-Policy and theme-aware, printable styling.
- Insert-into-editor and Save-as actions, plus Regenerate.
- Provenance line showing which generator produced the document.
- Workspace Trust support: untrusted workspaces use the offline template generator only.
- BYO API key stored in VS Code SecretStorage (never written to settings).
