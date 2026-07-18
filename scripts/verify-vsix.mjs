// Audits a packaged VSIX without any external dependencies: lists contents,
// checks required metadata/assets, rejects source/secrets/oversized files, and
// verifies the manifest. Pure Node (works on Node 20+, any OS).
import { readFileSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = resolve(root, 'artifacts');

function findVsix() {
  const explicit = process.argv[2];
  if (explicit) return resolve(explicit);
  const hit = readdirSync(artifactsDir).find((f) => f.endsWith('.vsix'));
  if (!hit) throw new Error('No .vsix found in artifacts/. Run `npm run package:vsix` first.');
  return resolve(artifactsDir, hit);
}

/** Minimal ZIP central-directory reader. Returns [{ name, size, method, offset }]. */
function listZip(buf) {
  const EOCD = 0x06054b50;
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== EOCD) eocd--;
  if (eocd < 0) throw new Error('Not a ZIP/VSIX file (no EOCD).');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Bad central directory record.');
    const method = buf.readUInt16LE(ptr + 10);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const offset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.push({ name, size, method, offset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const fnLen = buf.readUInt16LE(entry.offset + 26);
  const extraLen = buf.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + fnLen + extraLen;
  const compBuf = buf.subarray(start, start + (entry.method === 0 ? entry.size : buf.length - start));
  return entry.method === 0 ? compBuf.subarray(0, entry.size) : inflateRawSync(compBuf);
}

const vsixPath = findVsix();
const buf = readFileSync(vsixPath);
const entries = listZip(buf);
const names = entries.map((e) => e.name);
const problems = [];
const ok = [];

const required = [
  'extension/package.json',
  'extension/dist/extension.cjs',
  'extension/media/icon.png',
  'extension/readme.md',
  'extension/LICENSE.txt',
  'extension/changelog.md'
];
for (const r of required) {
  if (names.includes(r)) ok.push(`present: ${r}`);
  else problems.push(`MISSING required file: ${r}`);
}

// Reject source, maps, and raw design assets leaking into the package.
const forbidden = entries.filter((e) =>
  /\.(ts|map)$/.test(e.name) || /\.svg$/.test(e.name) || e.name.includes('/src/')
);
for (const f of forbidden) problems.push(`FORBIDDEN file in VSIX: ${f.name}`);

// Reject anything that looks like a secret.
const secretName = /(\.env|id_rsa|\.pem|secret|credentials)/i;
for (const e of entries) if (secretName.test(e.name)) problems.push(`POSSIBLE secret file: ${e.name}`);

// Total size sanity.
const totalKB = buf.length / 1024;
if (totalKB > 5120) problems.push(`VSIX too large: ${totalKB.toFixed(0)} KB`);
else ok.push(`size ok: ${totalKB.toFixed(1)} KB`);

// Manifest checks + secret scan of the bundle.
const manifest = JSON.parse(extractEntry(buf, entries.find((e) => e.name === 'extension/package.json')).toString('utf8'));
for (const field of ['name', 'publisher', 'version', 'engines', 'icon', 'repository', 'main']) {
  if (manifest[field]) ok.push(`manifest.${field} ok`);
  else problems.push(`manifest missing ${field}`);
}
const bundle = extractEntry(buf, entries.find((e) => e.name === 'extension/dist/extension.cjs')).toString('utf8');
for (const pat of [/sk-ant-[A-Za-z0-9]/, /sk-[A-Za-z0-9]{20,}/, /BEGIN (?:RSA )?PRIVATE KEY/]) {
  if (pat.test(bundle)) problems.push(`bundle appears to contain a secret matching ${pat}`);
}

console.log(`\nVSIX: ${vsixPath}`);
console.log(`Files (${entries.length}):`);
for (const e of entries) console.log(`  ${(e.size + ' B').padStart(10)}  ${e.name}`);
console.log('\nChecks:');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.log(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\nVSIX verification FAILED with ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nVSIX verification passed.');
