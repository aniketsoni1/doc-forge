// Headless smoke test of the deterministic pipeline the extension and CLI share.
// Verifies: Markdown + HTML generation via the offline fallback, sanitization,
// preview rendering, deliverable shape, and graceful fall-through when no AI is
// available. Run with: npx tsx scripts/smoke.mjs
import { parseDocSpec } from '@dfg/core';
import { resolveAndGenerate } from '@dfg/agent';
import { createTemplateGenerator } from '@dfg/generator-template';
import { MockGenerator } from '@dfg/testing';

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}

const template = createTemplateGenerator();

// 1. Markdown via the offline template generator.
const md = await resolveAndGenerate(parseDocSpec({ prompt: 'README for a tool called Acme', format: 'md' }), {
  generators: [template]
});
check('markdown uses the template generator', md.result.generatorUsed === 'template');
check('markdown deliverable has an H1', /^#\s/m.test(md.document.deliverable));
check('markdown provenance is present', md.provenance.startsWith('Generating with:'));

// 2. HTML via the offline template generator, sanitized + scaffolded.
const html = await resolveAndGenerate(parseDocSpec({ prompt: 'Report on Q3 sales', format: 'html' }), {
  generators: [template]
});
check('html deliverable is a full document', html.document.deliverable.startsWith('<!doctype html>'));
check('html preview has a body fragment', html.document.preview.bodyHtml.includes('<h1>'));

// 3. Sanitization removes injected script (simulating untrusted AI HTML).
const evil = new MockGenerator({ id: 'ai', format: 'html', content: '<h1>Hi</h1><script>alert(1)</script>' });
const sanitized = await resolveAndGenerate(parseDocSpec({ prompt: 'x', format: 'html' }), { generators: [evil, template] });
check('sanitization strips <script>', !sanitized.document.deliverable.includes('<script'));

// 4. Graceful fall-through when the AI path fails, ending at the template.
const broken = new MockGenerator({ id: 'ai', throwOnGenerate: true });
const fallback = await resolveAndGenerate(parseDocSpec({ prompt: 'anything' }), { generators: [broken, template] });
check('falls back to template when AI throws', fallback.result.generatorUsed === 'template');
check('records the fallback provenance', fallback.result.meta.fellBackFrom?.includes('ai') ?? false);

// 5. --no-ai equivalent never touches AI generators.
const forced = await resolveAndGenerate(parseDocSpec({ prompt: 'anything' }), {
  generators: [new MockGenerator({ id: 'ai', content: '# Nope\n' }), template],
  forceTemplate: true
});
check('forceTemplate ignores AI generators', forced.result.generatorUsed === 'template');

console.log(failures === 0 ? '\nSmoke test passed.' : `\nSmoke test FAILED (${failures}).`);
process.exit(failures === 0 ? 0 : 1);
