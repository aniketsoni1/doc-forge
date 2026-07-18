# Release checklist

Keep the manifest version, CHANGELOG, git tag, npm package, and VSIX filename in
sync.

1. Update `version` in root `package.json`, `apps/cli/src/version.ts`, and
   `apps/vscode-extension/package.json` (all must match).
2. Update `CHANGELOG.md` (root) and `apps/vscode-extension/CHANGELOG.md`.
3. `npm run verify` — typecheck (src + ext) + lint + tests + smoke.
4. `npm run build` — CLI and extension bundles.
5. `npm run package:vsix && npm run verify:vsix` — build + audit the VSIX.
6. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
7. CI (`release.yml`, `extension.yml`) runs the gates, attaches the VSIX +
   checksum to the GitHub Release, and publishes **only if** the relevant secrets
   are set:
   - `NPM_TOKEN` → npm publish of the CLI
   - `VSCE_PAT` → VS Code Marketplace
   - `OVSX_PAT` → Open VSX
8. A missing publishing secret **skips** that publish without failing the release.

Marketplace authentication: prefer a current, least-privilege Azure DevOps PAT
scoped to Marketplace publish for `VSCE_PAT`. If Microsoft's federated/secure
publishing is available for your publisher, use it instead of a long-lived token.
