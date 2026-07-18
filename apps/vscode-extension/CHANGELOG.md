# Changelog

All notable changes to the DocForge VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
