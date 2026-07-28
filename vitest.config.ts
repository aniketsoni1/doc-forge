import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
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
