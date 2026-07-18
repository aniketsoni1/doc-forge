import { describe, expect, it } from 'vitest';
import { parseDocSpec } from '@dfg/core';
import { analyzePrompt } from './heuristics';
import { composeMarkdown, resolveTemplate, listTemplates, getTemplate, extractSections } from './registry';

describe('analyzePrompt', () => {
  it('extracts a name from "called X"', () => {
    const a = analyzePrompt('Write a README for a CLI tool called Foobar');
    expect(a.name).toBe('Foobar');
  });

  it('extracts a feature list', () => {
    const a = analyzePrompt('Landing page with features: speed, safety, simplicity');
    expect(a.bullets).toEqual(['speed', 'safety', 'simplicity']);
  });

  it('derives a title when none is given', () => {
    const a = analyzePrompt('write a report about quarterly sales performance');
    expect(a.title.toLowerCase()).toContain('quarterly');
  });
});

describe('resolveTemplate', () => {
  it('honors an explicit template id', () => {
    expect(resolveTemplate(parseDocSpec({ prompt: 'anything', template: 'letter' })).id).toBe('letter');
  });

  it('resolves an alias', () => {
    expect(getTemplate('release-notes')?.id).toBe('changelog');
  });

  it('infers readme from the prompt', () => {
    expect(resolveTemplate(parseDocSpec({ prompt: 'Make a README for my project' })).id).toBe('readme');
  });

  it('infers changelog from the prompt', () => {
    expect(resolveTemplate(parseDocSpec({ prompt: 'Draft release notes for v2' })).id).toBe('changelog');
  });

  it('falls back to report', () => {
    expect(resolveTemplate(parseDocSpec({ prompt: 'zzz qqq' })).id).toBe('report');
  });
});

describe('composeMarkdown', () => {
  it('is deterministic', () => {
    const spec = parseDocSpec({ prompt: 'Write a README for a tool called Acme' });
    expect(composeMarkdown(spec).markdown).toBe(composeMarkdown(spec).markdown);
  });

  it('produces exactly one H1', () => {
    for (const t of listTemplates()) {
      const spec = parseDocSpec({ prompt: 'Document about widgets', template: t.id });
      const md = composeMarkdown(spec).markdown;
      const h1 = md.split('\n').filter((l) => /^#\s/.test(l)).length;
      expect(h1, `template ${t.id}`).toBe(1);
    }
  });

  it('includes requested features as bullets', () => {
    const spec = parseDocSpec({ prompt: 'README for Acme with features: fast, tiny, typed', template: 'readme' });
    const md = composeMarkdown(spec).markdown;
    expect(md).toContain('- fast');
    expect(md).toContain('- typed');
    expect(extractSections(md)).toContain('Features');
  });

  it('scales section count with length', () => {
    const short = composeMarkdown(parseDocSpec({ prompt: 'blog about cats', template: 'blog', length: 'short' }));
    const long = composeMarkdown(parseDocSpec({ prompt: 'blog about cats', template: 'blog', length: 'long' }));
    expect(extractSections(long.markdown).length).toBeGreaterThan(extractSections(short.markdown).length);
  });
});
