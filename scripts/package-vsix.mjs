// Packages the VS Code extension into artifacts/docforge-<version>.vsix and
// writes a SHA-256 checksum. Version comes from the root package.json so the
// manifest, tag, and VSIX filename stay in sync.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const extDir = resolve(root, 'apps/vscode-extension');
const outFile = resolve(root, `artifacts/docforge-${version}.vsix`);

mkdirSync(resolve(root, 'artifacts'), { recursive: true });

execFileSync('npx', ['@vscode/vsce', 'package', '--no-dependencies', '--out', outFile], {
  cwd: extDir,
  stdio: 'inherit'
});

const hash = createHash('sha256').update(readFileSync(outFile)).digest('hex');
writeFileSync(`${outFile}.sha256`, `${hash}  docforge-${version}.vsix\n`);
console.log(`\nPackaged ${outFile}`);
console.log(`SHA-256 ${hash}`);
