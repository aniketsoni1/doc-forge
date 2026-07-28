import { describe, expect, it } from 'vitest';
import {
  addHeadings,
  applyDeterministic,
  bulletItems,
  bulletsToProse,
  executiveSummary,
  getTransform,
  isBulletList,
  isOffline,
  listTransforms,
  missingInput,
  offlineTransforms,
  paragraphs,
  proseToBullets,
  sentences,
  tidyWhitespace,
  transformsForFormat,
  type TransformContext
} from './index';

const ctx = (selection: string, extra: Partial<TransformContext> = {}): TransformContext => ({
  selection,
  format: 'md',
  ...extra
});

describe('sentence splitting', () => {
  it('splits on terminal punctuation', () => {
    expect(sentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('does not split on common abbreviations', () => {
    expect(sentences('Use a tool, e.g. ripgrep, for speed.')).toEqual([
      'Use a tool, e.g. ripgrep, for speed.'
    ]);
    expect(sentences('Dr. Smith arrived. She spoke.')).toEqual([
      'Dr. Smith arrived.',
      'She spoke.'
    ]);
  });

  it('does not split on initials', () => {
    expect(sentences('Written by J. R. Tolkien here.')).toHaveLength(1);
  });

  it('handles text with no terminator', () => {
    expect(sentences('no full stop')).toEqual(['no full stop']);
  });

  it('returns nothing for empty input', () => {
    expect(sentences('   ')).toEqual([]);
  });
});

describe('paragraphs', () => {
  it('splits on blank lines and drops empties', () => {
    expect(paragraphs('one\n\ntwo\n\n\n\nthree')).toEqual(['one', 'two', 'three']);
  });
});

describe('bullet detection', () => {
  it('recognises dash, star, plus and numbered lists', () => {
    expect(isBulletList('- a\n- b')).toBe(true);
    expect(isBulletList('* a\n+ b')).toBe(true);
    expect(isBulletList('1. a\n2) b')).toBe(true);
  });

  it('rejects prose and mixed content', () => {
    expect(isBulletList('just prose')).toBe(false);
    expect(isBulletList('- a\nprose')).toBe(false);
    expect(isBulletList('')).toBe(false);
  });

  it('extracts item text without the marker', () => {
    expect(bulletItems('- alpha\n- beta\n1. gamma')).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('proseToBullets', () => {
  it('makes one bullet per sentence', () => {
    expect(proseToBullets('First point. Second point.')).toBe('- First point.\n- Second point.');
  });

  it('is idempotent on an existing list', () => {
    const list = '- a\n- b';
    expect(proseToBullets(list)).toBe(list);
    expect(proseToBullets(proseToBullets(list))).toBe(list);
  });

  it('spans multiple paragraphs', () => {
    expect(proseToBullets('One.\n\nTwo.').split('\n')).toHaveLength(2);
  });

  it('leaves unsplittable text alone', () => {
    expect(proseToBullets('   ')).toBe('');
  });
});

describe('bulletsToProse', () => {
  it('joins items into sentences with a closing connective', () => {
    const out = bulletsToProse('- alpha\n- beta\n- gamma');
    expect(out).toBe('Alpha. Beta. Finally, gamma.');
  });

  it('terminates items that lack punctuation', () => {
    expect(bulletsToProse('- one\n- two')).toBe('One. Finally, two.');
  });

  it('handles a single item', () => {
    expect(bulletsToProse('- only one')).toBe('Only one.');
  });

  it('leaves non-list text untouched', () => {
    expect(bulletsToProse('plain prose')).toBe('plain prose');
  });

  it('round-trips the item text through prose and back', () => {
    const items = bulletItems(proseToBullets(bulletsToProse('- alpha\n- beta')));
    expect(items.join(' ')).toContain('Alpha');
    expect(items.join(' ')).toContain('beta');
  });
});

describe('addHeadings', () => {
  it('adds a heading above each paragraph', () => {
    const out = addHeadings('The system stores documents locally.\n\nExport runs offline.');
    expect(out.split('\n').filter((l) => l.startsWith('## '))).toHaveLength(2);
    expect(out).toContain('The system stores documents locally.');
  });

  it('derives the heading from meaningful words', () => {
    const out = addHeadings('The deployment pipeline runs nightly.');
    expect(out.split('\n')[0]).toMatch(/^## \w/);
    expect(out.split('\n')[0]).not.toContain('The ');
  });

  it('skips blocks that already have a heading', () => {
    const out = addHeadings('## Existing\n\nbody');
    expect(out.match(/^## /gm)).toHaveLength(1);
  });

  it('skips list blocks', () => {
    expect(addHeadings('- a\n- b')).toBe('- a\n- b');
  });

  it('respects the requested level', () => {
    expect(addHeadings('Some content here.', 3)).toContain('### ');
  });

  it('falls back to a generic title when nothing survives filtering', () => {
    expect(addHeadings('It is on the at by.')).toContain('## Section');
  });
});

describe('executiveSummary', () => {
  it('takes the leading sentence of each paragraph', () => {
    const out = executiveSummary('Alpha one. More detail.\n\nBeta two. More detail.');
    expect(out).toContain('## Executive Summary');
    expect(out).toContain('- Alpha one.');
    expect(out).toContain('- Beta two.');
    expect(out).not.toContain('More detail.');
  });

  it('caps the number of points', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Point ${i}.`).join('\n\n');
    const bullets = executiveSummary(text).split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(5);
  });

  it('reads the first item of a list block', () => {
    expect(executiveSummary('- first item\n- second item')).toContain('- first item.');
  });

  it('is extractive: every point appears in the source', () => {
    const source = 'The build is reproducible. Details follow.\n\nExports are offline.';
    const summary = executiveSummary(source);
    for (const point of summary.split('\n').filter((l) => l.startsWith('- '))) {
      const text = point.replace(/^- /, '').replace(/\.$/, '');
      expect(source).toContain(text);
    }
  });
});

describe('tidyWhitespace', () => {
  it('trims trailing spaces and collapses blank runs', () => {
    expect(tidyWhitespace('a   \n\n\n\nb')).toBe('a\n\nb');
  });

  it('removes space before punctuation', () => {
    expect(tidyWhitespace('word , next .')).toBe('word, next.');
  });
});

describe('registry', () => {
  it('covers the operations named in the brief', () => {
    const ids = listTransforms().map((t) => t.id);
    for (const id of [
      'improve-clarity',
      'fix-grammar',
      'make-professional',
      'make-concise',
      'expand-detail',
      'simplify-language',
      'change-tone',
      'to-bullets',
      'bullets-to-prose',
      'add-headings',
      'executive-summary',
      'rewrite-for-audience',
      'translate',
      'document-code',
      'custom'
    ]) {
      expect(ids, `missing ${id}`).toContain(id);
    }
  });

  it('marks deterministic transforms as offline-capable', () => {
    const offline = offlineTransforms().map((t) => t.id);
    expect(offline).toEqual(
      expect.arrayContaining(['to-bullets', 'bullets-to-prose', 'add-headings', 'executive-summary'])
    );
    for (const t of offlineTransforms()) {
      expect(isOffline(t)).toBe(true);
      expect(t.apply).toBeTypeOf('function');
    }
  });

  it('gives every AI transform a prompt and no apply', () => {
    for (const t of listTransforms().filter((t) => t.kind === 'ai')) {
      expect(t.prompt, t.id).toBeTypeOf('function');
      expect(t.apply, t.id).toBeUndefined();
    }
  });

  it('filters by format', () => {
    const html = transformsForFormat('html').map((t) => t.id);
    expect(html).not.toContain('to-bullets');
    expect(html).toContain('improve-clarity');
  });

  it('builds prompts that demand only the rewritten text', () => {
    const t = getTransform('improve-clarity')!;
    const prompt = t.prompt!(ctx('Some text.'));
    expect(prompt).toContain('Some text.');
    expect(prompt).toMatch(/only/i);
    expect(prompt).toMatch(/Markdown structure/);
  });

  it('mentions HTML structure for html selections', () => {
    const prompt = getTransform('make-concise')!.prompt!(ctx('x', { format: 'html' }));
    expect(prompt).toContain('HTML structure');
  });

  it('threads required inputs into the prompt', () => {
    expect(getTransform('translate')!.prompt!(ctx('hi', { language: 'French' }))).toContain('French');
    expect(getTransform('change-tone')!.prompt!(ctx('hi', { tone: 'formal' }))).toContain('formal');
    expect(
      getTransform('rewrite-for-audience')!.prompt!(ctx('hi', { audience: 'executives' }))
    ).toContain('executives');
  });

  it('reports missing required input', () => {
    expect(missingInput(getTransform('translate')!, ctx('x'))).toBe('language');
    expect(missingInput(getTransform('translate')!, ctx('x', { language: 'de' }))).toBeUndefined();
    expect(missingInput(getTransform('custom')!, ctx('x', { instruction: '  ' }))).toBe('instruction');
    expect(missingInput(getTransform('improve-clarity')!, ctx('x'))).toBeUndefined();
  });

  it('runs a deterministic transform through the registry', () => {
    const out = applyDeterministic(getTransform('to-bullets')!, ctx('One. Two.'));
    expect(out).toBe('- One.\n- Two.');
  });

  it('refuses to run an AI transform deterministically', () => {
    expect(() => applyDeterministic(getTransform('improve-clarity')!, ctx('x'))).toThrow(
      /requires an AI generator/
    );
  });

  it('is deterministic: same input, same output', () => {
    for (const t of offlineTransforms()) {
      const input = ctx('First sentence here. Second one follows.');
      expect(applyDeterministic(t, input)).toBe(applyDeterministic(t, input));
    }
  });
});
