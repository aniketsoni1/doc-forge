import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Map `@dfg/<pkg>` to `packages/<pkg>/src`, mirroring the `paths` entry in
 * tsconfig.base.json.
 *
 * This was previously done by vite-tsconfig-paths. That plugin declares `vite`
 * as a `*` peer, which pinned an old, separately-vulnerable Vite alongside the
 * one Vitest already ships. Since every import is a bare `@dfg/<pkg>` specifier,
 * the mapping is a handful of aliases - not worth a dependency, let alone a
 * duplicated toolchain.
 */
const packagesDir = fileURLToPath(new URL('./packages', import.meta.url));

const alias = Object.fromEntries(
  readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`@dfg/${entry.name}`, `${packagesDir}/${entry.name}/src/index.ts`])
);

export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      // The extension's `vscode`-importing modules cannot run outside the
      // editor; its pure modules (protocol, errors, naming, webview) are
      // deliberately kept free of that import so they are testable here.
      include: [
        'packages/**/src/**/*.ts',
        'apps/vscode-extension/src/protocol.ts',
        'apps/vscode-extension/src/errors.ts',
        'apps/vscode-extension/src/naming.ts',
        'apps/vscode-extension/src/webview.ts'
      ],
      exclude: ['**/*.test.ts', 'packages/testing/**']
    }
  }
});
