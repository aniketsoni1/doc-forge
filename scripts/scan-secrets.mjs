#!/usr/bin/env node
/**
 * Dependency-free secret scan over tracked source files.
 *
 * This exists because a redaction library needs credential-shaped fixtures to
 * test against, and those fixtures look exactly like the thing scanners hunt
 * for. The project's rule is therefore stricter than "no real secrets": no
 * credential-shaped *literal* in the source at all. Fixtures are assembled at
 * runtime instead, which keeps the tests honest and leaves scanners nothing to
 * flag - ours or anyone else's.
 *
 * Run via `npm run scan:secrets`; also wired into `npm run verify`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RULES = [
  { name: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI key', pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', pattern: /\bAIza[A-Za-z0-9_-]{20,}/ },
  { name: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ }
];

const SCANNED = /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|html)$/;
const SKIP = /^(package-lock\.json|node_modules\/|dist\/|artifacts\/)/;

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && SCANNED.test(f) && !SKIP.test(f));

const findings = [];
for (const file of files) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  contents.split('\n').forEach((line, i) => {
    // An allowlist escape hatch for lines that must contain a sample.
    if (line.includes('scan-secrets:allow')) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file, line: i + 1, rule: rule.name, text: line.trim().slice(0, 100) });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Secret scan failed - credential-shaped literals found:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.text}`);
  }
  console.error(
    '\nAssemble test fixtures at runtime instead of writing them as literals,'
  );
  console.error('or append a `scan-secrets:allow` comment if the line is genuinely required.');
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} files, ${RULES.length} rules).`);
