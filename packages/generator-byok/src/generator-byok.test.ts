import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError, parseDocSpec } from '@dfg/core';
import { clearPricingOverrides } from '@dfg/reporting';
import { ByokGenerator } from './index';

afterEach(() => clearPricingOverrides());

function mockFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  })) as unknown as typeof fetch;
}

/** A fetch that never settles until the request signal aborts. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const fail = (): void => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    })) as unknown as typeof fetch;
}

const anthropicOk = {
  content: [{ type: 'text', text: '# Hello\n\nWorld.\n' }],
  usage: { input_tokens: 10, output_tokens: 20 }
};

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

describe('ByokGenerator error mapping', () => {
  const generate = (status: number): Promise<unknown> =>
    new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: mockFetch({ error: 'nope' }, false, status)
    }).generate(parseDocSpec({ prompt: 'x' }));

  it.each([
    [401, 'auth'],
    [429, 'rate_limit'],
    [404, 'unsupported_model'],
    [413, 'context_too_large'],
    [500, 'unavailable'],
    [400, 'invalid_response']
  ])('maps HTTP %i onto the %s code', async (status, code) => {
    await expect(generate(status)).rejects.toMatchObject({
      name: 'ProviderError',
      providerCode: code
    });
  });

  it('redacts the API key from an echoing error body', async () => {
    const key = 'sk-ant-api03-SECRETVALUE0000000000';
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: key,
      fetchImpl: mockFetch({ error: `bad key ${key}` }, false, 401)
    });
    const err = await gen.generate(parseDocSpec({ prompt: 'x' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).not.toContain('SECRETVALUE');
    expect((err as Error).message).toContain('[redacted]');
  });

  it('truncates a very long error body', async () => {
    const gen = new ByokGenerator({
      provider: 'openai',
      apiKey: 'sk-test',
      fetchImpl: mockFetch('x'.repeat(5000), false, 500)
    });
    const err = await gen.generate(parseDocSpec({ prompt: 'x' })).catch((e: unknown) => e);
    expect((err as Error).message.length).toBeLessThan(400);
  });

  it('rejects an empty document as an invalid response', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: mockFetch({ content: [{ type: 'text', text: '   ' }] })
    });
    await expect(gen.generate(parseDocSpec({ prompt: 'x' }))).rejects.toMatchObject({
      providerCode: 'invalid_response'
    });
  });

  it('classifies a transport failure as a network problem', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
    });
    await expect(gen.generate(parseDocSpec({ prompt: 'x' }))).rejects.toMatchObject({
      providerCode: 'network'
    });
  });
});

describe('ByokGenerator cancellation', () => {
  it('advertises cancellation and cost reporting', async () => {
    const cap = await new ByokGenerator({ apiKey: 'sk-test' }).capability();
    expect(cap.features?.cancellation).toBe(true);
    expect(cap.features?.costReporting).toBe(true);
    expect(cap.features?.offline).toBe(false);
  });

  it('aborts an in-flight request when the caller cancels', async () => {
    const controller = new AbortController();
    const gen = new ByokGenerator({ apiKey: 'sk-test', fetchImpl: hangingFetch() });
    const pending = gen.generate(parseDocSpec({ prompt: 'x' }), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ providerCode: 'cancelled' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const gen = new ByokGenerator({ apiKey: 'sk-test', fetchImpl: hangingFetch() });
    await expect(
      gen.generate(parseDocSpec({ prompt: 'x' }), { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ providerCode: 'cancelled' });
  });

  it('times out on its own so a hung connection cannot hang the host', async () => {
    const gen = new ByokGenerator({
      apiKey: 'sk-test',
      timeoutMs: 10,
      fetchImpl: hangingFetch()
    });
    // A timeout is reported as a network problem, not a user cancellation.
    await expect(gen.generate(parseDocSpec({ prompt: 'x' }))).rejects.toMatchObject({
      providerCode: 'network'
    });
  });
});

describe('ByokGenerator usage reporting', () => {
  it('reports provider-supplied counts as exact', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: mockFetch(anthropicOk)
    });
    const res = await gen.generate(parseDocSpec({ prompt: 'greeting' }));
    expect(res.meta.exactUsage).toBe(true);
    expect(res.meta.inputTokens).toBe(10);
    expect(res.meta.outputTokens).toBe(20);
  });

  it('estimates and flags usage when the API omits it', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      fetchImpl: mockFetch({ content: [{ type: 'text', text: '# Hi\n\nthere\n' }] })
    });
    const res = await gen.generate(parseDocSpec({ prompt: 'greeting' }));
    expect(res.meta.exactUsage).toBe(false);
    expect(res.meta.tokens).toBeGreaterThan(0);
  });

  it('derives a cost for a known model', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet-latest',
      fetchImpl: mockFetch(anthropicOk)
    });
    const res = await gen.generate(parseDocSpec({ prompt: 'x' }));
    expect(res.meta.costUsd).toBeCloseTo((10 / 1e6) * 3 + (20 / 1e6) * 15, 9);
    expect(res.meta.model).toBe('claude-3-5-sonnet-latest');
  });

  it('omits cost for an unknown model rather than implying it is free', async () => {
    const gen = new ByokGenerator({
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'some-unreleased-model',
      fetchImpl: mockFetch(anthropicOk)
    });
    const res = await gen.generate(parseDocSpec({ prompt: 'x' }));
    expect(res.meta.costUsd).toBeUndefined();
    expect(res.meta.tokens).toBe(30);
  });
});
