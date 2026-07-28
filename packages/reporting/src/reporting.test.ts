import { afterEach, describe, expect, it } from 'vitest';
import type { DocResult } from '@dfg/core';
import {
  clearPricingOverrides,
  estimateCostUsd,
  estimateTokens,
  formatProvenance,
  formatUsd,
  priceFor,
  setPricingOverrides,
  summarizeResult
} from './index';

afterEach(() => clearPricingOverrides());

const result = (meta: DocResult['meta']): DocResult => ({
  content: '# X',
  format: 'md',
  generatorUsed: 'byok:anthropic',
  warnings: [],
  meta
});

describe('estimateTokens', () => {
  it('approximates four characters per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('never reports zero for non-empty input', () => {
    expect(estimateTokens('')).toBe(1);
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output separately', () => {
    const cost = estimateCostUsd(1_000_000, 1_000_000, { inputPerMTok: 3, outputPerMTok: 15 });
    expect(cost).toBe(18);
  });

  it('rounds to six decimal places', () => {
    const cost = estimateCostUsd(1, 1, { inputPerMTok: 3, outputPerMTok: 15 });
    expect(cost).toBeCloseTo(0.000018, 6);
  });
});

describe('priceFor', () => {
  it('resolves a dated model id to its family', () => {
    expect(priceFor('anthropic', 'claude-3-5-sonnet-latest')).toEqual({
      inputPerMTok: 3,
      outputPerMTok: 15
    });
  });

  it('prefers the most specific prefix', () => {
    expect(priceFor('openai', 'gpt-4o-mini')?.inputPerMTok).toBe(0.15);
    expect(priceFor('openai', 'gpt-4o-2024-08-06')?.inputPerMTok).toBe(2.5);
  });

  it('returns undefined for an unknown model rather than guessing zero', () => {
    expect(priceFor('anthropic', 'some-future-model')).toBeUndefined();
  });

  it('honours user overrides over the built-in table', () => {
    setPricingOverrides({ 'claude-3-5-sonnet': { inputPerMTok: 1, outputPerMTok: 2 } });
    expect(priceFor('anthropic', 'claude-3-5-sonnet-latest')).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 2
    });
  });

  it('lets an override introduce an unknown model', () => {
    setPricingOverrides({ 'my-local-model': { inputPerMTok: 0, outputPerMTok: 0 } });
    expect(priceFor('custom', 'my-local-model-v2')).toEqual({
      inputPerMTok: 0,
      outputPerMTok: 0
    });
  });
});

describe('formatUsd', () => {
  it('uses more precision for tiny amounts', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0001234)).toBe('$0.0001');
    expect(formatUsd(1.5)).toBe('$1.50');
  });
});

describe('summarizeResult', () => {
  it('marks estimated token counts with a tilde', () => {
    expect(summarizeResult(result({ tokens: 120, exactUsage: false }))).toContain('~120 tokens');
  });

  it('does not mark provider-reported counts', () => {
    const summary = summarizeResult(result({ tokens: 120, exactUsage: true }));
    expect(summary).toContain('120 tokens');
    expect(summary).not.toContain('~120');
  });

  it('always labels cost as an estimate', () => {
    expect(summarizeResult(result({ costUsd: 0.0123 }))).toContain('est.');
  });

  it('includes duration, repair, and cache flags when present', () => {
    const summary = summarizeResult(result({ durationMs: 42, repaired: true, cached: true }));
    expect(summary).toContain('42ms');
    expect(summary).toContain('repaired');
    expect(summary).toContain('cached');
  });

  it('stays terse when there is no metadata', () => {
    expect(summarizeResult(result({}))).toBe('MD via byok:anthropic');
  });
});

describe('formatProvenance', () => {
  it('names the generator that ran', () => {
    expect(
      formatProvenance({
        id: 'template',
        available: true,
        label: 'Built-in templates',
        requiresNetwork: false
      })
    ).toBe('Generating with: Built-in templates');
  });
});
