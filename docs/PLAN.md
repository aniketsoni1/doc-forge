# DocForge Implementation Plan

Companion to [`AUDIT.md`](AUDIT.md). Sequenced so that each phase leaves the repository
buildable, testable, and usable, and so that interface changes happen while they are still
cheap.

**Guiding constraint:** preserve the existing architecture. The audit found no structural
problem worth a rewrite. Every phase adds alongside what exists.

---

## Sequencing rationale

Three ordering forces drive the plan:

1. **Interface changes get more expensive over time.** The `Generator` seam needs a
   cancellation parameter and a richer `Capability`. There are 5 implementations today and
   there will be more. Change it now.
2. **Observability precedes features.** The Studio (§7), history (§13), and cost display
   (§14) are all *views over generation metadata that is currently thrown away*. Recording
   attempts first means those features become presentation work rather than plumbing work.
3. **Ingestion is the security frontier.** Workspace context (§8) is the first feature that
   reads user files and sends them to a remote provider. It needs redaction, path
   containment, and prompt-injection handling in place before it lands — so it comes after
   the security primitives, not with them.

---

## Phase 1 — Stabilisation *(this step)*

Fix what is broken and lay the seams every later phase depends on. No new user-facing
features beyond better errors.

| # | Work | Brief § | Audit ref |
| --- | --- | --- | --- |
| 1.1 | `ProviderError` taxonomy with a closed code set; secret redaction helper | §17, §19 | 3.1, 3.7 |
| 1.2 | Record `GenerationAttempt[]` in the ladder — generator, timing, status, issues, repair, fallback reason | §18 | 3.1 |
| 1.3 | Surface attempt trail in CLI output and extension error messages | §4 | 3.1 |
| 1.4 | Add `GenerateOptions { signal }` to the `Generator` seam; wire AbortSignal + timeout into BYOK, `CancellationToken` into the LM API path, `cancellable: true` into `withProgress` | §12 | 3.3 |
| 1.5 | Request-id guard + button disabling to kill the regenerate race | §12 | 3.4 |
| 1.6 | Shared, runtime-validated webview message schema | §7 | 3.5 |
| 1.7 | Load `docforge.config.json` in `loadConfig`; honour `aiEnabled` | §4 | 3.2, 3.8 |
| 1.8 | Wire `estimateCostUsd` through; overridable pricing table; label estimates as estimates | §14 | 3.6 |
| 1.9 | Group and expand extension settings with `order` and descriptions | §4 | §4 gap |
| 1.10 | Extract testable logic from `extension.ts`; first tests for the extension app | §21 | §21 gap |
| 1.11 | Drop `retainContextWhenHidden`; document CLI `--output` path behaviour | §19, §20 | 3.9, 3.10 |
| 1.12 | Correct the three README/ARCHITECTURE inaccuracies | §23 | §4 |

**Exit criteria:** `npm run verify` green, VSIX builds and passes content audit, extension
app has test coverage, no generator failure reaches the user as a bare id.

---

## Phase 2 — Editing workflows

The first genuinely new capability. Depends on 1.4 (cancellation) and 1.1 (errors).

- **Markdown-aware section parser** (`packages/document-model`) — heading boundaries as
  ranges, not string replacement. This is the load-bearing piece: §6 needs it, and §15's
  validation and §7's outline both consume it. For HTML, parse structurally rather than
  by regex.
- **Selection-based editing** (§5) — the 14 operations, as a transform registry so
  deterministic transforms (bullets↔prose, add headings, executive summary) work offline
  and AI transforms degrade to a clear "no provider" state rather than failing.
- **Diff review before replacement** (§5, §6) — accept / reject / regenerate / edit. Reuse
  the CLI's existing LCS differ; promote it to a shared package.
- **Section regeneration** (§6) — via editor selection or outline pick, preserving
  neighbours.
- **Streaming** (§12) — incremental preview updates, nothing incomplete written to disk,
  sanitisation and validation only on finalise.

**Risk:** the section parser is the highest-value and highest-risk item in the whole plan.
Budget snapshot tests generously; get it right before building three features on it.

---

## Phase 3 — Document Studio

Presentation over the metadata Phase 1 started recording.

- Central webview panel; business logic stays outside it (§7).
- Prompt editor, template/provider/model selectors, tone and length controls.
- Streaming preview, outline, section actions, metadata and provenance panel.
- Validation results surface (feeds Phase 5's §15 pipeline).
- Keyboard navigation, accessible labels, actionable empty states (§27).

The webview stays a thin presentation layer over the typed message schema from 1.6.

---

## Phase 4 — Workspace intelligence

The security-critical phase. Nothing here ships without the redaction and containment
primitives from Phase 1 and dedicated tests.

- Explicit context selection with include/exclude patterns and `.gitignore` filtering (§8).
- **Preview before transmission** — the user sees exactly what leaves the machine.
- Secret-pattern redaction; Workspace Trust gating; size limits and chunking.
- Prompt-injection handling: workspace content is untrusted input, not instruction (§19).
- Repository-aware generators: README, architecture, API docs, release notes from git
  history, changelog, onboarding.

**Gate:** a threat-model document and security tests for each boundary land *with* this
phase, not after it.

---

## Phase 5 — Libraries, export, validation

- **Prompt/template library** (§9) — built-in / user / workspace scopes, YAML or JSON with
  schema validation, variable resolution and preview, CRUD, import/export.
- **Template expansion** (§10) — 6 → 21 types, richer heuristics (stack, install steps,
  risks, milestones, owners, dates, metrics), and snapshot tests for every template.
  Replacing the placeholder prose is what makes the offline path genuinely useful rather
  than merely present.
- **Export** (§11) — an internal document model first, then PDF/DOCX/txt/JSON/RTF as
  renderers over it. Evaluate every dependency against package size, licensing, platform
  support, and VSIX impact before adding it; document format limitations honestly.
- **History + caching** (§13) — local, metadata-first, full-text storage opt-in, retention
  configurable, fully disableable. Never cache secrets.
- **Validation + accessibility** (§15, §16) — the 13 checks into VS Code diagnostics and
  the Problems panel; objective errors kept clearly distinct from subjective writing
  suggestions.

---

## Phase 6 — Release preparation

- Documentation: threat model, prompt-authoring, template-authoring, provider-development
  guides; roadmap.
- Genuine screenshots and demo capture per `docs/CAPTURE.md`. No fabricated assets.
- CI additions: coverage thresholds, license checks, markdown lint, doc-link checking.
- VSIX content audit, install smoke test in a clean editor, checksums.
- Marketplace metadata review.

Prepared locally. Nothing published or pushed.

---

## Cross-cutting decisions

**Local storage strategy (deliverable 7).** No database. History and cache live as JSON
under the extension's `globalStorageUri` (user scope) and `.docforge/` (workspace scope,
gitignorable and shareable via source control for prompts). Rationale: zero native
dependencies, no VSIX size impact, trivially inspectable and deletable by the user — which
matters for a privacy-conscious feature — and matches the "database-free" requirement.

**Migration (deliverable 8).** Settings renames go through a migration map read at
activation, with deprecated keys marked `deprecationMessage` in `package.json` and honoured
for at least one minor release. History and cache files carry a `schemaVersion` field from
their first write so later migration is possible without guesswork.

**Dependency policy.** The project currently ships four runtime dependencies
(`markdown-it`, `sanitize-html`, `commander`, `picocolors`) and no provider SDKs — BYOK
uses raw `fetch`. That restraint is a feature. PDF and DOCX export in Phase 5 are the first
real pressure on it; both get an explicit evaluation against §11's criteria before
adoption, and a documented technical blocker is an acceptable outcome.

**Testing posture.** Tests must never require paid API keys. `MockGenerator` already covers
the ladder; Phase 1 adds extension-app coverage, Phase 2 adds snapshot tests for the
section parser, Phase 4 adds security-boundary tests, Phase 6 adds e2e via
`@vscode/test-electron`.
