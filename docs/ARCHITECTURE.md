# Architecture

DocForge is a path-alias monorepo (`@dfg/* → packages/*/src`) with one shared
TypeScript core and two thin UIs. There is no per-package build in development;
tsx, Vitest, and esbuild resolve the aliases directly.

![Architecture](../assets/architecture.png)

## Layering rules

- **`@dfg/core`** - the domain model (`DocSpec`, `DocResult`, `Capability`, the
  `Generator` interface), Zod schemas, a `ToolDescriptor` permission model, and
  error types. No I/O.
- **`@dfg/render`, `@dfg/templates`, `@dfg/sanitize`** - pure libraries. No I/O,
  no `vscode` imports. Markdown→HTML, deterministic templates + prompt
  heuristics, and the sanitizer/linter respectively.
- **Generators** implement the `Generator` seam: the packages
  `@dfg/generator-template` (deterministic, always available) and
  `@dfg/generator-byok` (Anthropic/OpenAI), plus two editor-only generators that
  live inside the extension app rather than as packages, because they import
  `vscode`: `src/generators/lmApi.ts` and `src/generators/extensionApi.ts`.
- **`@dfg/agent`** - the only orchestration seam. It resolves the generator
  ladder, validates output, runs one bounded repair, finalizes/sanitizes, builds
  the preview, reports provenance, and records a `GenerationAttempt` for every
  candidate so the fallback path is observable rather than silent.
- **Apps** - `apps/cli` and `apps/vscode-extension` assemble their own ladder and
  call `@dfg/agent`. The CLI ladder is BYO-key → template; the extension ladder
  adds the editor-only LM API and extension paths in front.

## Generation workflow

![Workflow](../assets/workflow.png)

1. Input becomes a Zod-validated `DocSpec`.
2. The agent probes each generator's `capability()` and picks the first available
   one (honoring `--no-ai`/Workspace Trust and any preferred generator).
3. It runs `generate()`, validates (markdown lint for MD; sanitize + parse for
   HTML), and on failure does **one** bounded repair pass.
4. If it still fails (or the generator threw), it falls through to the next
   generator - always ending at the deterministic template generator. The
   failure is normalized into a `ProviderError` with a machine-readable code
   (`auth`, `rate_limit`, `network`, `context_too_large`, …) and recorded as a
   `GenerationAttempt`, so the host can explain the fallback instead of just
   naming the winner.
5. It finalizes: sanitizes HTML centrally, wraps the body in a themed, printable
   document scaffold, and produces a preview model plus a provenance string.

## Cancellation

`Generator.generate(spec, options)` accepts an optional `AbortSignal`. The
extension bridges VS Code's `CancellationToken` onto it and the BYOK generator
passes it to `fetch` alongside an internal timeout, so a hung provider connection
can never hang the editor. A cancellation deliberately **stops** the ladder
rather than falling through to templates: the user asked to stop, not to receive
a different document.

## The document model

`@dfg/document-model` parses Markdown and HTML into a tree of sections, each
carrying **exact character offsets** into the original source. Everything
structural is built on it: section regeneration, the outline picker, and (later)
validation.

Offsets rather than strings is the load-bearing decision. Replacing a section
splices at recorded positions, so neighbouring content is preserved byte for
byte instead of by careful pattern matching. The test suite asserts that
invariant directly for every section of a document containing the constructs
that break naive approaches.

Those constructs are the reason this is a scanner and not a regular expression:

- `#` inside a fenced or indented code block is not a heading. Getting this
  wrong silently corrupts code samples.
- Fences must be closed by the same character, at least as long as the opener.
- Setext headings (`===` / `---`) are headings; a `---` in front matter is not.
- For HTML, headings are found with `htmlparser2`, so `<h2>` inside a comment,
  a `<script>`, or an attribute value cannot produce a phantom section.

## Editing

`@dfg/transforms` is a registry of selection operations. Each declares whether
it is `deterministic` (pure text manipulation, always available offline) or `ai`
(needs a provider). The UI reads that flag to label the picker, so "works
offline" is a property of the data rather than a claim in the docs.

The deterministic transforms are deliberately structural, not semantic. The
summary transform is *extractive* - it selects existing sentences rather than
synthesising a new one - because that is a thing software can honestly do
without a model.

`@dfg/agent`'s `runTransform` runs a transform over a *fragment*. It does not
reuse the document ladder, which validates output as a whole document (insisting
on an H1, wrapping HTML in a page scaffold) - wrong for a three-sentence
selection. It does share the seam, the fallback discipline, the attempt trail,
and the sanitizer: a rewritten HTML fragment goes through the same allowlist as
a generated document, so selection editing cannot become the hole that script
survives.

## Streaming

Streaming output is shown in the preview as a **draft**, rendered into a `<pre>`
via `textContent`. Streamed text has not been sanitized or validated yet, so it
is never assigned as HTML and never written to disk. Only the finalized result -
after sanitisation, validation and any repair - can be saved.

## Configuration precedence

Lowest to highest: built-in defaults → `docforge.config.json` → environment
variables → explicit flags or editor settings. The environment beats the file so
a checked-in project config never overrides a developer's own machine setup.

## Why the VS Code Language Model API first

`vscode.lm.selectChatModels(...)` is the sanctioned, vendor-neutral way to use
Copilot and other providers from an extension. Preferring it avoids brittle
coupling to any single extension's internals. The best-effort "extension" path is
strictly guarded behind a documented, opt-in `generateDocument` API.
