# Troubleshooting

**`docforge` uses templates even though I have Copilot / a key.**
Run `docforge doctor`. The CLI only has the BYO-key and template generators (the
LM API and extension paths are editor-only). Set `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`, or use the VS Code extension for Copilot via the LM API.

**The extension always uses the offline generator.**
Check Workspace Trust (untrusted workspaces are template-only), `docforge.enableAi`,
and that a model is available (`vscode.lm`) or an API key is set via
**DocForge: Set API Key**. The preview's provenance line shows which path ran.

**HTML output lost some tags.**
That is the sanitizer doing its job — scripts, inline handlers, and unsafe URLs
are removed. A "Some unsafe HTML was removed" warning is expected for model HTML.

**`npm run lint` seems slow.**
Lint targets explicit globs (`packages/**/*.ts`, `apps/**/*.ts`,
`scripts/**/*.mjs`). Run a subset, e.g. `npx eslint packages/core/src`.

**VSIX packaging fails.**
Use Node 20+ and run `npm run build:ext` first. `npm run verify:vsix` lists the
packaged contents and the failing check.
