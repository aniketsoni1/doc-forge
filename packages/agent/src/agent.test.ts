import { describe, expect, it } from 'vitest';
import { parseDocSpec } from '@dfg/core';
import { MockGenerator } from '@dfg/testing';
import { createTemplateGenerator } from '@dfg/generator-template';
import { probeCapabilities, resolveAndGenerate } from './ladder';
import { finalizeDocument } from './finalize';
import { repairResult, validateResult } from './validate';

const template = createTemplateGenerator();
const spec = (over: Record<string, unknown> = {}) =>
  parseDocSpec({ prompt: 'Write a README for a tool called Acme', ...over });

describe('validate + repair', () => {
  it('flags Markdown without an H1 and repairs it', () => {
    const bad = { content: 'just body text', format: 'md' as const, generatorUsed: 'x', warnings: [], meta: {} };
    expect(validateResult(bad).length).toBeGreaterThan(0);
    const fixed = repairResult(bad);
    expect(validateResult(fixed)).toEqual([]);
    expect(fixed.meta.repaired).toBe(true);
  });

  it('accepts valid Markdown', () => {
    const ok = { content: '# Title\n\nBody.\n', format: 'md' as const, generatorUsed: 'x', warnings: [], meta: {} };
    expect(validateResult(ok)).toEqual([]);
  });
});

describe('finalizeDocument', () => {
  it('keeps Markdown as the deliverable and builds a preview', () => {
    const doc = finalizeDocument(spec(), {
      content: '# Acme\n\nHello.\n',
      format: 'md',
      generatorUsed: 'template',
      warnings: [],
      meta: {}
    });
    expect(doc.deliverable).toContain('# Acme');
    expect(doc.preview.documentHtml).toContain('<!doctype html>');
    expect(doc.title).toBe('Acme');
  });

  it('wraps an HTML fragment into a full document deliverable', () => {
    const doc = finalizeDocument(spec({ format: 'html' }), {
      content: '<h1>Acme</h1><p>hi</p>',
      format: 'html',
      generatorUsed: 'template',
      warnings: [],
      meta: {}
    });
    expect(doc.deliverable.startsWith('<!doctype html>')).toBe(true);
    expect(doc.deliverable).toContain('<h1>Acme</h1>');
  });

  it('sanitizes unsafe HTML and warns', () => {
    const doc = finalizeDocument(spec({ format: 'html' }), {
      content: '<h1>Acme</h1><script>alert(1)</script>',
      format: 'html',
      generatorUsed: 'byok:anthropic',
      warnings: [],
      meta: {}
    });
    expect(doc.deliverable).not.toContain('<script');
    expect(doc.warnings.some((w) => /sanitiz/i.test(w))).toBe(true);
  });
});

describe('resolveAndGenerate ladder', () => {
  it('uses the first available generator and reports provenance', async () => {
    const ai = new MockGenerator({ id: 'ai', label: 'Copilot (VS Code LM API)', content: '# Acme\n\nAI body.\n' });
    const outcome = await resolveAndGenerate(spec(), { generators: [ai, template] });
    expect(outcome.result.generatorUsed).toBe('ai');
    expect(outcome.provenance).toBe('Generating with: Copilot (VS Code LM API)');
  });

  it('skips an unavailable generator', async () => {
    const ai = new MockGenerator({ id: 'ai', available: false });
    const outcome = await resolveAndGenerate(spec(), { generators: [ai, template] });
    expect(outcome.result.generatorUsed).toBe('template');
  });

  it('falls through when a generator throws, ending at the template', async () => {
    const ai = new MockGenerator({ id: 'ai', throwOnGenerate: true });
    const byok = new MockGenerator({ id: 'byok', throwOnGenerate: new Error('quota') });
    const outcome = await resolveAndGenerate(spec(), { generators: [ai, byok, template] });
    expect(outcome.result.generatorUsed).toBe('template');
    expect(outcome.result.meta.fellBackFrom).toEqual(['ai', 'byok']);
  });

  it('repairs then keeps a fixable result instead of falling through', async () => {
    const ai = new MockGenerator({ id: 'ai', content: 'no heading here, just prose' });
    const outcome = await resolveAndGenerate(spec(), { generators: [ai, template] });
    expect(outcome.result.generatorUsed).toBe('ai');
    expect(outcome.result.meta.repaired).toBe(true);
    expect(ai.calls.length).toBe(1);
  });

  it('forceTemplate ignores AI generators', async () => {
    const ai = new MockGenerator({ id: 'ai', content: '# X\n\nbody\n' });
    const outcome = await resolveAndGenerate(spec(), { generators: [ai, template], forceTemplate: true });
    expect(outcome.result.generatorUsed).toBe('template');
    expect(ai.calls.length).toBe(0);
  });

  it('allowNetwork=false skips network generators', async () => {
    const net = new MockGenerator({ id: 'byok', requiresNetwork: true, content: '# X\n\nbody\n' });
    const outcome = await resolveAndGenerate(spec(), { generators: [net, template], allowNetwork: false });
    expect(outcome.result.generatorUsed).toBe('template');
  });

  it('preferredId moves a generator to the front', async () => {
    const a = new MockGenerator({ id: 'a', content: '# A\n\nx\n' });
    const b = new MockGenerator({ id: 'b', content: '# B\n\nx\n' });
    const outcome = await resolveAndGenerate(spec(), { generators: [a, b], preferredId: 'b' });
    expect(outcome.result.generatorUsed).toBe('b');
  });
});

describe('probeCapabilities', () => {
  it('reports availability for each generator', async () => {
    const caps = await probeCapabilities([template, new MockGenerator({ id: 'ai', available: false })]);
    expect(caps.find((c) => c.id === 'template')?.available).toBe(true);
    expect(caps.find((c) => c.id === 'ai')?.available).toBe(false);
  });
});
