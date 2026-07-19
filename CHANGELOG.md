# Changelog

All notable changes to DocForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-07-18

### Changed

- Normalized punctuation to plain hyphens across docs, source, and diagrams.
- Aligned all repository links to the `doc-forge` GitHub repo.
- Committed `package-lock.json` so CI (`npm ci`, dependency caching) is reproducible.

### Fixed

- VS Code Marketplace publisher id (`AniketSoni`) and a unique display name
  (`DocForge - Document Generator`).

## [0.1.0] - 2026-07-18

### Added

- `@dfg/core` domain model: `DocSpec`, `DocResult`, `Capability`, the `Generator`
  interface, Zod schemas, and a `ToolDescriptor` permission model.
- Pure libraries `@dfg/render` (markdown-it + themed/printable HTML scaffold +
  front-matter + preview model), `@dfg/templates` (six deterministic presets +
  prompt heuristics), and `@dfg/sanitize` (allowlist HTML sanitizer + Markdown
  normalize/lint).
- `generator-template` (deterministic, offline) and `generator-byok`
  (Anthropic/OpenAI, key-gated, injectable fetch).
- `@dfg/agent`: priority ladder with capability probe, validation, one bounded
  repair pass, graceful fall-through to templates, finalize/sanitize/preview, and
  provenance.
- CLI (`docforge`) with `create`, `init`, `doctor`, `configure`; `--no-ai`,
  `--format`, `--template`, `--tone`, `--length`, `--output`, `--non-interactive`,
  diff + approval before overwrite.
- VS Code extension: New Document from Prompt, generator picker, strict-CSP live
  preview, Insert/Save/Regenerate, editor-only LM API + extension generators,
  SecretStorage key handling, Workspace Trust support.
- Reproducible VSIX packaging + a dependency-free VSIX content auditor, a headless
  pipeline smoke test, branding assets, diagrams, and CI/release workflows.
