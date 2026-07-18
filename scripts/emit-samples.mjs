// Emits genuine DocForge outputs into samples/ (deterministic template path) so
// the exact Markdown, themed HTML, and webview preview are viewable in a browser
// without running VS Code. Run: npx tsx scripts/emit-samples.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocSpec } from '@dfg/core';
import { resolveAndGenerate } from '@dfg/agent';
import { createTemplateGenerator } from '@dfg/generator-template';
import { renderWebviewHtml, createNonce } from '../apps/vscode-extension/src/webview.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const samples = resolve(root, 'samples');
const demo = resolve(samples, 'demo-workspace');
mkdirSync(demo, { recursive: true });

const template = createTemplateGenerator();
const gen = (spec) => resolveAndGenerate(parseDocSpec(spec), { generators: [template] });

const readme = await gen({ prompt: 'README for a CLI tool called Acme with features: fast, tiny, typed' });
writeFileSync(resolve(samples, 'acme-readme.md'), readme.document.deliverable);

const report = await gen({ prompt: 'Report on Q3 sales performance', format: 'html', tone: 'formal' });
writeFileSync(resolve(samples, 'q3-report.html'), report.document.deliverable);

const changelog = await gen({ prompt: 'Changelog for Acme with features: preview, sanitize, export', template: 'changelog' });
writeFileSync(resolve(samples, 'acme-changelog.md'), changelog.document.deliverable);

// The genuine webview preview page produced by the extension's renderer.
const webview = renderWebviewHtml({
  title: readme.document.title,
  bodyHtml: readme.document.preview.bodyHtml,
  provenance: readme.provenance,
  format: 'md',
  nonce: createNonce(),
  cspSource: 'vscode-resource:'
});
writeFileSync(resolve(samples, 'preview-webview.html'), webview);

// A tiny demo workspace for the VSIX smoke test / manual capture.
writeFileSync(
  resolve(demo, 'docforge.config.json'),
  `${JSON.stringify({ defaultFormat: 'md', tone: 'neutral', length: 'medium' }, null, 2)}\n`
);
writeFileSync(
  resolve(demo, 'WELCOME.md'),
  '# DocForge demo workspace\n\nRun **DocForge: New Document from Prompt** and try:\n\n- `README for a CLI tool called Acme with features: fast, tiny, typed`\n- `Report on Q3 sales performance` (choose HTML)\n\nWith no AI configured, DocForge uses the offline template generator.\n'
);
writeFileSync(
  resolve(demo, 'docforge-demo.code-workspace'),
  `${JSON.stringify({ folders: [{ path: '.' }], settings: { 'docforge.enableAi': false } }, null, 2)}\n`
);

console.log('Wrote samples/: acme-readme.md, q3-report.html, acme-changelog.md, preview-webview.html, demo-workspace/');
