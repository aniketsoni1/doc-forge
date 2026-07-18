# Architecture

DocForge is a path-alias monorepo (`@dfg/* → packages/*/src`) with one shared
TypeScript core and two thin UIs. There is no per-package build in development;
tsx, Vitest, and esbuild resolve the aliases directly.

![Architecture](../assets/architecture.png)

## Layering rules

- **`@dfg/core`** — the domain model (`DocSpec`, `DocResult`, `Capability`, the
  `Generator` interface), Zod schemas, a `ToolDescriptor` permission model, and
  error types. No I/O.
- **`@dfg/render`, `@dfg/templates`, `@dfg/sanitize`** — pure libraries. No I/O,
  no `vscode` imports. Markdown→HTML, deterministic templates + prompt
  heuristics, and the sanitizer/linter respectively.
- **Generators** implement the `Generator` seam: `generator-template`
  (deterministic, always available), `generator-byok` (Anthropic/OpenAI),
  `generator-lm-api` and `generator-extension` (editor-only, live in the
  extension app).
- **`@dfg/agent`** — the only orchestration seam. It resolves the generator
  ladder, validates output, runs one bounded repair, finalizes/sanitizes, builds
  the preview, and reports provenance.
- **Apps** — `apps/cli` and `apps/vscode-extension` assemble their own ladder and
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
   generator — always ending at the deterministic template generator.
5. It finalizes: sanitizes HTML centrally, wraps the body in a themed, printable
   document scaffold, and produces a preview model plus a provenance string.

## Why the VS Code Language Model API first

`vscode.lm.selectChatModels(...)` is the sanctioned, vendor-neutral way to use
Copilot and other providers from an extension. Preferring it avoids brittle
coupling to any single extension's internals. The best-effort "extension" path is
strictly guarded behind a documented, opt-in `generateDocument` API.
