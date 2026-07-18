// Bundles the DocForge CLI into a single self-contained CJS file.
// No per-package build in dev; this is only for distribution.
import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/cli/index.cjs');

await mkdir(resolve(root, 'dist/cli'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'apps/cli/src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
  tsconfig: resolve(root, 'tsconfig.base.json'),
  logLevel: 'info'
});

await chmod(outfile, 0o755);
console.log('Built', outfile);
