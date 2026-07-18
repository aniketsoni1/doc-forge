// Bundles the VS Code extension into a single CJS file. `vscode` is provided by
// the host and must remain external.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '../..');
const production = process.argv.includes('--production');

await build({
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(root, 'dist/extension.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  tsconfig: resolve(repoRoot, 'tsconfig.base.json'),
  logLevel: 'info'
});

console.log('Built dist/extension.cjs');
