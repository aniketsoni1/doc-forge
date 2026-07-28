# Changelog

All notable changes to DocForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Phase 2 - Editing workflows

Added

- `@dfg/document-model`: Markdown and HTML parsed into a section tree with exact
  character offsets. Correctly ignores `#` inside fenced and indented code
  blocks, handles setext headings and YAML front matter, and finds HTML headings
  with a real tokenizer so comments, scripts and attribute values cannot produce
  phantom sections.
- `@dfg/transforms`: 15 selection operations. Four - prose to bullets, bullets to
  prose, add headings, executive summary - are deterministic and run with no
  provider, no key and no network.
- `@dfg/diff`: the CLI's line differ promoted to a shared package, with hunk
  collapsing and no colour coupling, so the extension renders the same
  comparison.
- **DocForge: Improve Selected Text** (`Ctrl/Cmd+Alt+I`) and **DocForge:
  Regenerate Section**, both with diff review offering accept, reject or
  regenerate, and both cancellable.
- Streaming drafts in the preview, rendered as text rather than markup.
- CLI: `docforge rewrite`, `docforge transforms`, `docforge outline`.

Notes

- Section replacement splices at parsed offsets, so neighbouring sections are
  preserved byte for byte. There is a test asserting exactly that for every
  section of a document containing the awkward constructs.
- Rewritten HTML fragments pass through the same sanitizer allowlist as
  generated documents.
- An edit is abandoned if the document changed while the preview was open.

### Phase 1 - Stabilisation

Phase 1 of the improvement plan in [`docs/PLAN.md`](docs/PLAN.md).
No breaking changes to existing behaviour; `Generator.generate` gained an optional
second parameter, so existing implementations continue to compile.

### Added

- `ProviderError` with a closed code set (`auth`, `rate_limit`, `network`,
  `unsupported_model`, `context_too_large`, `invalid_response`, `cancelled`,
  `unavailable`, `content_rejected`, `unknown`), each carrying a recovery hint and
  a retryability flag.
- Credential redaction (`redactSecrets`, `redactKnownSecret`, `containsSecret`),
  applied automatically to every `ProviderError` message.
- `GenerationAttempt` records: the ladder now reports every generator it tried,
  with status, timing, validation issues, repair outcome, and fallback reason.
- Cancellation throughout the pipeline via an optional `AbortSignal` on
  `Generator.generate`, bridged to VS Code's `CancellationToken` in the extension
  and to `fetch` in the BYO-key generator, plus an independent request timeout.
- `GeneratorFeatures` capability advertisement (streaming, cancellation, cost
  reporting, system prompts, model discovery, offline, max context).
- Token, cost, and duration reporting, with an overridable price table and
  explicit estimated-vs-measured labelling.
- `DocForge: Run Diagnostics` command and a DocForge output channel.
- Copy action, cancel button, busy states, and a diff-before-overwrite prompt in
  the preview.
- Grouped extension settings (Generation / Providers / Reporting) plus
  `docforge.requestTimeoutMs` and `docforge.pricing`.
- `docs/AUDIT.md` and `docs/PLAN.md`.

### Fixed

- `docforge.config.json` is now actually read. `docforge init` previously wrote a
  file that nothing consumed.
- `config.aiEnabled` is now honoured by the CLI instead of being inert.
- Provider error bodies are redacted and truncated before being surfaced, rather
  than interpolated verbatim into an error message.
- Rapid regeneration can no longer race: a superseded result is discarded instead
  of overwriting newer output.
- Webview messages are validated at runtime against a shared schema instead of
  being trusted on the strength of a TypeScript annotation alone.
- `estimateTokens` / `estimateCostUsd` were dead code; they are now wired through.
- Cancelling now stops the ladder rather than silently falling back to templates.
- Dropped `retainContextWhenHidden` from the preview panel.

### Changed

- Test suite grown from 70 to 200+ tests, including the first coverage of the
  VS Code extension app.
- README and `docs/ARCHITECTURE.md` corrected where they overstated or misnamed
  what was implemented.

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
