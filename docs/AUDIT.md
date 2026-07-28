# DocForge Repository Audit

**Audited commit:** `081a77c` on `main`
**Date:** 2026-07-27
**Baseline:** `npm run verify` passes — typecheck (src + ext), lint, 70 tests across 8 files, smoke.
**Scale:** 3,260 lines of TypeScript across 10 packages and 2 apps.

This document records what the repository actually does today, measured against the
30-section improvement brief. It is deliberately blunt about gaps: the brief asks for a
product roughly six times the size of what exists, and pretending otherwise would make the
plan useless.

---

## 1. Architecture as built

A path-alias monorepo (`@dfg/* → packages/*/src`). No per-package build step in
development — `tsx`, Vitest, and esbuild resolve the aliases directly. This is a genuinely
good decision for a project this size and should be preserved.

```
packages/
  core                 domain model, Zod schemas, error types, permission descriptors
  render               markdown-it wrapper, HTML scaffold, front-matter, preview model
  templates            6 presets + prompt heuristics + deterministic prose helpers
  sanitize             sanitize-html allowlist + markdown normalizer/linter
  configuration        env-driven config resolution
  reporting            token estimate, cost estimate, provenance strings
  agent                the ladder: resolve → generate → validate → repair → finalize
  testing              MockGenerator + sample prompts
  generator-template   deterministic, always available
  generator-byok       Anthropic / OpenAI over fetch
apps/
  cli                  commander program: create, doctor, init, configure
  vscode-extension     3 commands, 1 preview webview, 2 editor-only generators
```

### Layering discipline

Holds up well. `@dfg/core` has no I/O. `render`, `templates`, and `sanitize` are pure. No
`vscode` import escapes `apps/vscode-extension`. `@dfg/agent` is the single orchestration
seam. The brief's §26 suggested layout is largely already satisfied in spirit, and a
migration to its exact package names would be churn for no benefit.

**Recommendation: do not restructure packages.** Add new packages alongside the existing
ones as features land.

---

## 2. What is fully implemented and working

These are the strong parts. They should be preserved and extended, not rewritten.

| Area | Assessment |
| --- | --- |
| `Generator` seam | Clean two-method interface (`capability()` / `generate()`). The right abstraction. `capability()` is contractually non-throwing and the ladder honours that. |
| Generator ladder | Ordering, preferred-id promotion, `forceTemplate`, `allowNetwork` gating, and terminal fallback to templates all work and are tested. |
| Bounded repair | Exactly one repair pass, deterministic, no network. Correctly bounded — no generate-repair loop. Satisfies §18's "keep repair bounded". |
| HTML sanitisation | `sanitize-html` with an explicit tag allowlist, scheme allowlist (`http`/`https`/`mailto`), `allowProtocolRelative: false`, and forced `rel="noopener noreferrer"` on `target="_blank"`. Solid. |
| Webview CSP | `default-src 'none'` with per-render nonces on both `style-src` and `script-src`. No `unsafe-inline`. Correct. |
| SecretStorage | API key never touches settings or disk. Correct. |
| Workspace Trust | Declared `untrustedWorkspaces: limited`; untrusted sessions force the template generator. Correct. |
| CLI overwrite safety | LCS line diff shown, confirmation required, `--force` / `--non-interactive` semantics are coherent. Genuinely good. |
| Deterministic output | `composeMarkdown` is provably deterministic and tested as such. No randomness anywhere in the template path. |
| Test suite | 70 tests, no network, no API keys required, `MockGenerator` exercises fall-through properly. |
| CI / packaging | Node 20/22/24 matrix, separate e2e job, VSIX package + verify scripts, security workflow, Dependabot, issue/PR templates, CODEOWNERS. |
| Documentation honesty | The README's Limitations section correctly discloses that PDF/DOCX/streaming are not implemented and that no mocked UI screenshots ship. This is rarer than it should be and deserves credit. |

---

## 3. Defects and inconsistencies found

Ordered by severity. These are real bugs in the current code, not missing features.

### 3.1 Fallback reasons are silently discarded — **high**

`packages/agent/src/ladder.ts` swallows every generator failure:

```ts
} catch {
  fellBackFrom.push(generator.id);
  continue;
}
```

The user is told *that* a generator was skipped but never *why*. An expired API key, a
429, a network outage, and a malformed response are indistinguishable — all surface as a
bare generator id in `meta.fellBackFrom`. This is the single biggest UX defect in the
codebase and it directly contradicts §4's "Each error should explain what failed, which
provider or stage failed" and §18's requirement that each attempt record a result status
and fallback reason.

### 3.2 `docforge.config.json` is written but never read — **high**

`runInit` writes a config file. `loadConfig` only merges `DEFAULT_CONFIG` + environment +
explicit overrides — it never looks for the file. `samples/demo-workspace/` even ships a
`docforge.config.json` that has no effect whatsoever. `docforge init` currently produces a
decorative artefact.

### 3.3 No cancellation anywhere in the pipeline — **high**

`Generator.generate(spec)` takes no cancellation parameter, so cancellation cannot be
threaded through by construction.

- `LmApiGenerator` creates a `CancellationTokenSource`, passes its token to
  `sendRequest`, and disposes it in `finally` — but never calls `cancel()`. The token is
  inert; it exists only to satisfy the signature.
- `ByokGenerator.generate` calls `fetch` with no `signal` and no timeout. A hung provider
  connection hangs the extension indefinitely with no way out.
- `withProgress` is invoked without `cancellable: true`, so no cancel affordance is shown.

§12 requires cancellation tokens throughout the pipeline; §17 lists cancellation as an
advertised capability. Neither is possible without a signature change.

### 3.4 Regenerate has a race condition — **medium**

`showPreview`'s message handler awaits `generateWithProgress` and then assigns `current`.
Clicking **Regenerate** twice starts two generations; whichever resolves last wins,
regardless of which the user started last. The buttons are never disabled. §12 explicitly
calls out preventing race conditions on rapid regeneration.

### 3.5 Webview messages are unvalidated — **medium**

```ts
async (message: { type: string }) => {
  if (message.type === 'insert') { ... }
```

The type annotation is a compile-time assertion over an untrusted runtime value with no
corresponding check. Impact is currently contained (the webview loads only nonce'd
first-party script under a strict CSP, and the handler ignores unknown types), so this is
defence-in-depth rather than a live vulnerability — but §7 requires a shared message
schema with validation of all inbound messages, and the current code is one careless
`postMessage` handler away from being a real problem.

### 3.6 Cost and cache reporting are dead code — **medium**

`@dfg/reporting` exports `estimateTokens` and `estimateCostUsd`. Neither is called
anywhere. `summarizeResult` prints `meta.costUsd`, which nothing ever populates.
`DocMeta.cached` is likewise never set — there is no cache in the codebase at all, though
`DocForgeConfig.cacheDir` is defined and defaulted. Three fields advertise capability the
system does not have.

`ByokGenerator` does capture real `usage` from both providers and sets `meta.tokens`, so
the input is available — it is simply never carried through to cost.

### 3.7 BYOK error messages embed raw response bodies — **medium (security-adjacent)**

```ts
throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
```

The body is interpolated verbatim and propagates to `showErrorMessage`. Provider error
bodies can echo request context. There is no redaction pass anywhere in the codebase
despite §3's "Redaction of credentials from logs" being listed as a preserved principle.

### 3.8 `config.aiEnabled` is never consulted — **low**

`DocForgeConfig.aiEnabled` defaults to `false` and is set to `true` when a key is present,
but `buildCliLadder` and `runCreate` ignore it entirely; `allowNetwork` comes from the
`--no-ai` flag alone. The field is inert.

### 3.9 `retainContextWhenHidden: true` — **low**

Set on the preview panel. VS Code's own guidance is to avoid it because the hidden webview
keeps its full renderer context alive. With no unsaved webview state to protect, this is
pure memory cost.

### 3.10 CLI `--output` has no path containment — **low**

`resolve(io.cwd, opts.output)` happily resolves `../../etc/foo`. For a user-invoked CLI
writing where the user asked, this is defensible, but §19 asks for an explicit
path-traversal review and the current behaviour is undocumented.

### 3.11 Repository clutter — **low**

Seven `vitest.config.ts.timestamp-*.mjs` files and several `.DS_Store` files sit in the
working directory. They are gitignored (status is clean) but they are noise, and the
timestamp files indicate Vitest was interrupted repeatedly.

---

## 4. README claims vs. implementation

Checked every claim in both READMEs. The documentation is **substantially honest** — the
Limitations sections are accurate and the "no placeholder screenshots" policy is real.
Three discrepancies:

| Claim | Reality |
| --- | --- |
| Root README feature list: "Live preview, generator picker, Insert / Save, and **diff + approval before overwrite**" | Diff + approval exists in the **CLI only**. The extension's Save uses a native save dialog with no diff and no DocForge-level approval. The bullet reads as if it covers both UIs. |
| Root README badge: "70 tests passing" | Accurate today, but a hand-maintained count in a badge will drift on the next commit. |
| `docs/ARCHITECTURE.md`: "Generators implement the `Generator` seam: … `generator-lm-api` and `generator-extension`" | No such packages exist. These live at `apps/vscode-extension/src/generators/{lmApi,extensionApi}.ts`. The text names them as if they were packages. |

---

## 5. Gap analysis against the brief

Coverage of the 30-section brief, by section. "Partial" means a foundation exists that can
be built on rather than replaced.

| § | Area | Status |
| --- | --- | --- |
| 3 | Core principles (deterministic-first, fallback, provenance, local-first, provider-neutral, secure) | **Largely met.** Provenance is the weakest — it reports the winner but not the journey. |
| 4 | Command experience (10 commands, context menus, status bar) | **Partial** — 3 commands, 1 keybinding, no context/explorer/title menus, no status bar item. |
| 4 | Document creation wizard (12 collected fields) | **Partial** — 2 sequential prompts (prompt, format) + a generator pick. No tone/length/audience/template/destination steps. |
| 4 | Preview → document studio (19 listed capabilities) | **Partial** — renders, Insert, Save, Regenerate, provenance. No streaming, TOC, outline, side-by-side, export, print, theme toggle, metadata panel, or explicit loading/cancel/error states. |
| 4 | Error experience | **Missing** — see 3.1. |
| 4 | Settings groups + migration | **Missing** — 6 flat settings, no grouping, no `order`, no deprecation/migration logic. |
| 5 | Selection-based AI editing (14 operations) | **Missing entirely.** |
| 6 | Section-level regeneration + Markdown-aware section parser | **Missing entirely.** `extractSections` returns H2 text only — no boundaries, no ranges. |
| 7 | Document Studio panel | **Missing entirely.** |
| 8 | Workspace-aware generation (context selection, gitignore filtering, secret redaction, chunking) | **Missing entirely.** No file reading of any kind outside the CLI's own output path. |
| 9 | Prompt/template library (3 scopes, metadata, variables, CRUD, import/export) | **Missing.** `DocSpec.variables` exists and is threaded through; only the `letter` preset reads it (`recipient`, `sender`). |
| 10 | Deterministic templates | **Partial** — 6 of the 21 requested types. Existing prose is placeholder-heavy: every section emits "Replace this placeholder with the specifics of X". Heuristics extract title/name/bullets/keywords but not stack, install steps, risks, milestones, owners, dates, or metrics. No snapshot tests. |
| 11 | Export formats (PDF, DOCX, txt, JSON, RTF) | **Missing.** md + html only. No document model to export *from* — `DocResult.content` is a string. |
| 12 | Streaming + cancellation | **Missing.** See 3.3. |
| 13 | History + prompt caching | **Missing.** `meta.cached` and `cacheDir` are vestigial. |
| 14 | Token / cost / context visibility | **Partial** — tokens captured from BYOK; cost helpers exist but are unwired. No pricing overrides, no thresholds, no warnings, no estimated-vs-exact labelling. |
| 15 | Document validation pipeline (13 checks, Problems panel) | **Partial** — `lintMarkdown` covers 4 structural rules and feeds repair. No diagnostics integration, no severity config, no link/alt/fence/front-matter checks. |
| 16 | Accessibility + content quality checks | **Missing.** |
| 17 | Capability-aware provider system + typed provider errors | **Missing.** `Capability` carries `available` / `requiresNetwork` only — no streaming, context limit, structured output, or cost-reporting flags. No provider error taxonomy. |
| 18 | Observable fallback/repair pipeline | **Partial** — repair is correctly bounded; the attempt trail is not recorded. See 3.1. |
| 19 | Security hardening + threat model | **Partial** — sanitisation, CSP, SecretStorage, and Trust are solid. No redaction, no path containment, no prompt-injection consideration (no workspace ingestion yet), no threat-model document. |
| 20 | Performance | **Partial** — `activationEvents: []` with lazy command activation is correct, and no provider SDKs are bundled (raw `fetch`). No measurements captured. |
| 21 | Testing (unit / integration / e2e) | **Partial** — good unit coverage of pure packages. **Zero tests for `apps/vscode-extension`** — `extension.ts`, `webview.ts`, and both editor generators are entirely untested. No `@vscode/test-electron`, no integration or e2e layer. |
| 22 | CLI parity (10 commands) | **Partial** — 4 of 10 (`create`, `doctor`, `init`, `configure`). Missing `rewrite`, `improve`, `validate`, `export`, `templates`, `prompts`, `history`, `providers`. |
| 23 | Open-source readiness | **Strong.** README, ARCHITECTURE, CAPTURE, TROUBLESHOOTING, RELEASE, SECURITY, SUPPORT, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, THIRD_PARTY_NOTICES, issue/PR templates, CODEOWNERS, Dependabot all present. Missing: threat model, prompt/template authoring guides, provider-development guide, roadmap file. |
| 24 | Marketplace readiness | **Partial** — metadata, icon, gallery banner, categories, keywords, VSIX build + content audit all present. Release checklist exists in `docs/RELEASE.md`. |
| 25 | CI/CD | **Partial** — typecheck, lint, test, build, smoke, VSIX, security workflow. Missing: coverage thresholds, license checks, markdown lint, doc-link checking. |
| 26 | Architecture expectations | **Met.** Strict TS, `noUncheckedIndexedAccess`, explicit interfaces, Zod at the boundary, DI via constructor options, small modules. Missing only: cancellation tokens, structured error types. |
| 27 | UX standards | **Partial** — theme variables and progress indicators are used; no keyboard nav in the webview, no empty states, no cancellation. |

### Honest summary

The repository is a **well-built foundation at roughly 15–20% of the brief's scope**. Its
architecture, security posture, and test discipline are sound enough that everything the
brief asks for can be added incrementally. Nothing needs to be torn down.

The three things blocking every later phase, and therefore the correct first work:

1. **No cancellation in the `Generator` signature** — blocks streaming (§12), the Studio
   (§7), and capability advertisement (§17). Changing an interface gets more expensive
   with every generator added, so it must happen first.
2. **No error taxonomy** — blocks the error experience (§4), observable fallback (§18),
   and provider health in the resolver (§17).
3. **No attempt recording** — blocks the Studio's validation/provenance panel (§7),
   token/cost visibility (§14), and history (§13).

These are exactly Phase 1. See `docs/PLAN.md`.
