# Contributing to DocForge

Thanks for your interest in improving DocForge! This is a deterministic-first
document generator with a small, typed core and two thin UIs (CLI + VS Code).

## Getting started

```bash
git clone https://github.com/aniketsoni1/doc-forge.git
cd docforge
npm install
npm run verify   # typecheck (src + extension) + lint + tests + smoke
```

There is **no build step in development** - a path-alias monorepo (`@dfg/* →
packages/*/src`) is resolved by tsx, Vitest, and esbuild directly.

## Ground rules

- **TypeScript strict**, `noUncheckedIndexedAccess`, ESM everywhere.
- **The template path stays deterministic and fully tested.** Mock the
  `Generator` interface for AI paths so CI never depends on a network or model.
- **Layering:** generators depend on `@dfg/core` contracts; `@dfg/render`,
  `@dfg/templates`, and `@dfg/sanitize` are pure (no I/O, no `vscode` imports);
  `@dfg/agent` is the only orchestration seam.
- **All model HTML is sanitized** before it is written or shown in a webview.
- Keep changes minimal and typed. Add or update tests for behavior changes.

## Common commands

| Command | What it does |
| --- | --- |
| `npm run verify` | Typecheck + lint + unit tests + smoke |
| `npm test` | Vitest once |
| `npm run docforge -- create "..."` | Run the CLI from source |
| `npm run build` | Bundle CLI and extension |
| `npm run package:vsix` | Build `artifacts/docforge-<version>.vsix` |
| `npm run verify:vsix` | Audit the packaged VSIX |

## Pull requests

1. Fork and branch from `main`.
2. Run `npm run verify` and make sure it is green.
3. Describe the change and link any related issue.
4. Be kind in review - see `CODE_OF_CONDUCT.md`.

By contributing you agree your contributions are licensed under Apache-2.0.
