import { describe, expect, it } from 'vitest';
import { DocForgeError } from '@dfg/core';
import { MockGenerator, abortError } from '@dfg/testing';
import { getTransform } from '@dfg/transforms';
import { parseMarkdownOutline, findBySlug } from '@dfg/document-model';
import { runTransform } from './edit';
import { regenerateSection } from './section';

const generators = (...g: MockGenerator[]): MockGenerator[] => g;

describe('runTransform: deterministic path', () => {
  it('runs offline with no generators at all', async () => {
    const result = await runTransform({
      transform: getTransform('to-bullets')!,
      context: { selection: 'One. Two.', format: 'md' },
      generators: []
    });
    expect(result.text).toBe('- One.\n- Two.');
    expect(result.deterministic).toBe(true);
    expect(result.producedBy).toBe('Built-in text transform');
  });

  it('always preserves the original for diffing', async () => {
    const selection = 'One. Two.';
    const result = await runTransform({
      transform: getTransform('to-bullets')!,
      context: { selection, format: 'md' },
      generators: []
    });
    expect(result.original).toBe(selection);
  });

  it('records an attempt even offline', async () => {
    const result = await runTransform({
      transform: getTransform('executive-summary')!,
      context: { selection: 'Alpha point. Detail.', format: 'md' },
      generators: []
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.status).toBe('succeeded');
  });
});

describe('runTransform: AI path', () => {
  it('uses the first available generator', async () => {
    const gen = new MockGenerator({ id: 'ai', label: 'Mock AI', content: 'Rewritten text.' });
    const result = await runTransform({
      transform: getTransform('improve-clarity')!,
      context: { selection: 'original text', format: 'md' },
      generators: generators(gen)
    });
    expect(result.text).toBe('Rewritten text.');
    expect(result.deterministic).toBe(false);
    expect(result.producedBy).toBe('Mock AI');
  });

  it('passes the selection to the model inside the prompt', async () => {
    const gen = new MockGenerator({ id: 'ai', content: 'ok' });
    await runTransform({
      transform: getTransform('improve-clarity')!,
      context: { selection: 'THE SELECTED TEXT', format: 'md' },
      generators: generators(gen)
    });
    expect(gen.calls[0]?.prompt).toContain('THE SELECTED TEXT');
  });

  it('strips a wrapping code fence from the answer', async () => {
    const gen = new MockGenerator({ id: 'ai', content: '```md\nClean text.\n```' });
    const result = await runTransform({
      transform: getTransform('make-concise')!,
      context: { selection: 'x', format: 'md' },
      generators: generators(gen)
    });
    expect(result.text).toBe('Clean text.');
  });

  it('falls through a failing generator to the next', async () => {
    const broken = new MockGenerator({ id: 'broken', throwOnGenerate: new Error('boom') });
    const good = new MockGenerator({ id: 'good', label: 'Good', content: 'Result.' });
    const result = await runTransform({
      transform: getTransform('fix-grammar')!,
      context: { selection: 'x', format: 'md' },
      generators: generators(broken, good)
    });
    expect(result.producedBy).toBe('Good');
    expect(result.attempts[0]?.status).toBe('failed_error');
    expect(result.attempts[0]?.errorMessage).toContain('boom');
  });

  it('rejects an empty rewrite and tries the next generator', async () => {
    const empty = new MockGenerator({ id: 'empty', content: '   ' });
    const good = new MockGenerator({ id: 'good', content: 'Real text.' });
    const result = await runTransform({
      transform: getTransform('fix-grammar')!,
      context: { selection: 'x', format: 'md' },
      generators: generators(empty, good)
    });
    expect(result.text).toBe('Real text.');
    expect(result.attempts[0]?.status).toBe('failed_validation');
  });

  it('sanitizes HTML rewrites against the same allowlist as documents', async () => {
    const gen = new MockGenerator({
      id: 'ai',
      content: '<p>safe</p><script>alert(1)</script>'
    });
    const result = await runTransform({
      transform: getTransform('improve-clarity')!,
      context: { selection: '<p>x</p>', format: 'html' },
      generators: generators(gen)
    });
    expect(result.text).toContain('<p>safe</p>');
    expect(result.text).not.toContain('<script');
    expect(result.warnings.join(' ')).toMatch(/unsafe HTML/i);
  });

  it('skips network generators when the network is disallowed', async () => {
    const net = new MockGenerator({ id: 'net', requiresNetwork: true });
    const local = new MockGenerator({ id: 'local', content: 'Local result.' });
    const result = await runTransform({
      transform: getTransform('fix-grammar')!,
      context: { selection: 'x', format: 'md' },
      generators: generators(net, local),
      allowNetwork: false
    });
    expect(result.attempts[0]?.status).toBe('skipped_offline');
    expect(result.text).toBe('Local result.');
  });
});

describe('runTransform: failure modes', () => {
  it('refuses an empty selection', async () => {
    await expect(
      runTransform({
        transform: getTransform('to-bullets')!,
        context: { selection: '   ', format: 'md' },
        generators: []
      })
    ).rejects.toThrow(/Select some text/);
  });

  it('demands required input before running', async () => {
    await expect(
      runTransform({
        transform: getTransform('translate')!,
        context: { selection: 'hello', format: 'md' },
        generators: [new MockGenerator({ id: 'ai' })]
      })
    ).rejects.toThrow(/needs a language/);
  });

  it('explains that an AI transform cannot run offline, rather than degrading it', async () => {
    await expect(
      runTransform({
        transform: getTransform('improve-clarity')!,
        context: { selection: 'text', format: 'md' },
        generators: [],
        forceDeterministic: true
      })
    ).rejects.toThrow(/needs an AI provider/);
  });

  it('names what it tried when no provider can run', async () => {
    const gone = new MockGenerator({ id: 'gone', label: 'Gone', available: false });
    await expect(
      runTransform({
        transform: getTransform('improve-clarity')!,
        context: { selection: 'text', format: 'md' },
        generators: generators(gone)
      })
    ).rejects.toThrow(/Gone/);
  });

  it('never returns the unchanged selection as though it were a result', async () => {
    const broken = new MockGenerator({ id: 'broken', throwOnGenerate: true });
    await expect(
      runTransform({
        transform: getTransform('improve-clarity')!,
        context: { selection: 'untouched', format: 'md' },
        generators: generators(broken)
      })
    ).rejects.toBeInstanceOf(DocForgeError);
  });

  it('stops on cancellation instead of falling back', async () => {
    const cancelling = new MockGenerator({ id: 'c', throwOnGenerate: abortError() });
    const good = new MockGenerator({ id: 'good', content: 'should not be used' });
    await expect(
      runTransform({
        transform: getTransform('improve-clarity')!,
        context: { selection: 'x', format: 'md' },
        generators: generators(cancelling, good)
      })
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(good.calls).toHaveLength(0);
  });

  it('forwards the abort signal to the generator', async () => {
    const controller = new AbortController();
    const gen = new MockGenerator({ id: 'ai', content: 'ok' });
    await runTransform({
      transform: getTransform('improve-clarity')!,
      context: { selection: 'x', format: 'md' },
      generators: generators(gen),
      signal: controller.signal
    });
    expect(gen.lastOptions?.signal).toBe(controller.signal);
  });
});

describe('regenerateSection', () => {
  const doc = `# Guide

Intro.

## Setup

Old setup text.

## Usage

Usage text.
`;

  const sectionFor = (slug: string) => findBySlug(parseMarkdownOutline(doc), slug)!;

  it('replaces only the target section', async () => {
    const gen = new MockGenerator({ id: 'ai', label: 'Mock', content: 'Brand new setup.' });
    const result = await regenerateSection({
      source: doc,
      section: sectionFor('setup'),
      format: 'md',
      generators: generators(gen)
    });

    expect(result.document).toContain('Brand new setup.');
    expect(result.document).not.toContain('Old setup text.');
    // Neighbours survive untouched.
    expect(result.document).toContain('## Usage\n\nUsage text.');
    expect(result.document).toContain('# Guide\n\nIntro.');
    expect(result.document).toContain('## Setup');
  });

  it('reports the original body for diffing', async () => {
    const gen = new MockGenerator({ id: 'ai', content: 'new' });
    const result = await regenerateSection({
      source: doc,
      section: sectionFor('usage'),
      format: 'md',
      generators: generators(gen)
    });
    expect(result.originalBody.trim()).toBe('Usage text.');
    expect(result.newBody).toBe('new');
  });

  it('tells the model not to repeat the heading', async () => {
    const gen = new MockGenerator({ id: 'ai', content: 'body' });
    await regenerateSection({
      source: doc,
      section: sectionFor('setup'),
      format: 'md',
      generators: generators(gen)
    });
    const prompt = gen.calls[0]?.prompt ?? '';
    expect(prompt).toContain('Setup');
    expect(prompt).toMatch(/do NOT repeat/i);
    expect(prompt).toContain('Old setup text.');
  });

  it('passes an extra instruction through', async () => {
    const gen = new MockGenerator({ id: 'ai', content: 'shorter' });
    await regenerateSection({
      source: doc,
      section: sectionFor('setup'),
      format: 'md',
      instruction: 'make it much shorter',
      generators: generators(gen)
    });
    expect(gen.calls[0]?.prompt).toContain('make it much shorter');
  });

  it('gives the model the ancestor path for nested sections', async () => {
    const nested = '# Top\n\n## Parent\n\n### Child\n\nchild body\n';
    const section = findBySlug(parseMarkdownOutline(nested), 'child')!;
    const gen = new MockGenerator({ id: 'ai', content: 'new child' });
    await regenerateSection({
      source: nested,
      section,
      format: 'md',
      generators: generators(gen)
    });
    expect(gen.calls[0]?.prompt).toContain('Top > Parent');
  });

  it('leaves the document parseable and structurally intact', async () => {
    const gen = new MockGenerator({ id: 'ai', content: 'replacement body' });
    const result = await regenerateSection({
      source: doc,
      section: sectionFor('setup'),
      format: 'md',
      generators: generators(gen)
    });
    const before = parseMarkdownOutline(doc).flat.map((s) => s.title);
    const after = parseMarkdownOutline(result.document).flat.map((s) => s.title);
    expect(after).toEqual(before);
  });

  it('refuses a section with no body', async () => {
    const empty = '# A\n\n## Empty\n\n## Next\n\nbody\n';
    const section = findBySlug(parseMarkdownOutline(empty), 'empty')!;
    await expect(
      regenerateSection({
        source: empty,
        section,
        format: 'md',
        generators: [new MockGenerator({ id: 'ai' })]
      })
    ).rejects.toThrow(/no body/);
  });

  it('preserves a code fence in a neighbouring section', async () => {
    const src = '# T\n\n## Code\n\n```js\nconst x = 1;\n```\n\n## Prose\n\nold prose\n';
    const section = findBySlug(parseMarkdownOutline(src), 'prose')!;
    const gen = new MockGenerator({ id: 'ai', content: 'new prose' });
    const result = await regenerateSection({
      source: src,
      section,
      format: 'md',
      generators: generators(gen)
    });
    expect(result.document).toContain('```js\nconst x = 1;\n```');
    expect(result.document).toContain('new prose');
  });
});
