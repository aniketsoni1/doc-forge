import { describe, expect, it } from 'vitest';
import { parseDocSpec } from '@dfg/core';
import { createTemplateGenerator } from './index';

const gen = createTemplateGenerator();

describe('TemplateGenerator', () => {
  it('is always available and offline', async () => {
    const cap = await gen.capability();
    expect(cap.available).toBe(true);
    expect(cap.requiresNetwork).toBe(false);
  });

  it('generates normalized Markdown', async () => {
    const res = await gen.generate(parseDocSpec({ prompt: 'README for a tool called Acme' }));
    expect(res.format).toBe('md');
    expect(res.generatorUsed).toBe('template');
    expect(res.content).toContain('# Acme');
    expect(res.content.endsWith('\n')).toBe(true);
    expect(res.meta.sections).toContain('Installation');
  });

  it('generates a sanitized HTML fragment (agent applies the scaffold)', async () => {
    const res = await gen.generate(parseDocSpec({ prompt: 'Report on sales', format: 'html' }));
    expect(res.format).toBe('html');
    expect(res.content).toContain('<h1>');
    expect(res.content).not.toContain('<script');
    expect(res.content).not.toContain('<!doctype');
  });

  it('is deterministic across runs', async () => {
    const spec = parseDocSpec({ prompt: 'Blog about TypeScript', template: 'blog' });
    const a = await gen.generate(spec);
    const b = await gen.generate(spec);
    expect(a.content).toBe(b.content);
  });
});
