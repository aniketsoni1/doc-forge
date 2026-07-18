import { describe, expect, it } from 'vitest';
import { parseDocSpec } from '@dfg/core';
import { ByokGenerator } from './index';

function mockFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  })) as unknown as typeof fetch;
}

describe('ByokGenerator capability', () => {
  it('is unavailable without a key', async () => {
    const cap = await new ByokGenerator({ provider: 'anthropic' }).capability();
    expect(cap.available).toBe(false);
    expect(cap.requiresNetwork).toBe(true);
  });

  it('is available with a key', async () => {
    const cap = await new ByokGenerator({ provider: 'anthropic', apiKey: 'sk-test' }).capability();
    expect(cap.available).toBe(true);
    expect(cap.label).toContain('anthropic');
  });
});

describe('ByokGenerator generate', () => {
  it('throws when no key is configured', async () => {
    await expect(new ByokGenerator().generate(parseDocSpec({ prompt: 'x' }))).rejects.toThrow();
  });

  it('parses an Anthropic response and reports tokens', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: mockFetch({
        content: [{ type: 'text', text: '# Hello\n\nWorld.\n' }],
        usage: { input_tokens: 10, output_tokens: 20 }
      })
    });
    const res = await gen.generate(parseDocSpec({ prompt: 'greeting' }));
    expect(res.content).toBe('# Hello\n\nWorld.');
    expect(res.generatorUsed).toBe('byok:anthropic');
    expect(res.meta.tokens).toBe(30);
  });

  it('strips a wrapping code fence and parses OpenAI responses', async () => {
    const gen = new ByokGenerator({
      provider: 'openai',
      apiKey: 'sk-test',
      fetchImpl: mockFetch({
        choices: [{ message: { content: '```md\n# Hi\n\nx\n```' } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 }
      })
    });
    const res = await gen.generate(parseDocSpec({ prompt: 'hi' }));
    expect(res.content).toBe('# Hi\n\nx');
    expect(res.meta.tokens).toBe(12);
  });

  it('throws on a non-OK HTTP response', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: mockFetch({ error: 'nope' }, false, 429)
    });
    await expect(gen.generate(parseDocSpec({ prompt: 'x' }))).rejects.toThrow(/429/);
  });
});
