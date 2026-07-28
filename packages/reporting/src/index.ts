import type { Capability, DocResult } from '@dfg/core';

/** Very rough token estimate (~4 chars/token) for cost display when the API omits usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface CostModel {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: CostModel
): number {
  const cost =
    (inputTokens / 1_000_000) * model.inputPerMTok +
    (outputTokens / 1_000_000) * model.outputPerMTok;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Indicative list prices, in USD per million tokens.
 *
 * Provider pricing changes without notice, so these are a *default* only: hosts
 * are expected to let users override them (see {@link setPricingOverrides}) and
 * every figure derived from them must be presented as an estimate, never as a
 * bill. Keys match as prefixes so dated model ids resolve to their family.
 */
const DEFAULT_PRICES: ReadonlyArray<{ prefix: string; price: CostModel }> = [
  { prefix: 'claude-3-5-sonnet', price: { inputPerMTok: 3, outputPerMTok: 15 } },
  { prefix: 'claude-3-5-haiku', price: { inputPerMTok: 0.8, outputPerMTok: 4 } },
  { prefix: 'claude-3-opus', price: { inputPerMTok: 15, outputPerMTok: 75 } },
  { prefix: 'claude-3-haiku', price: { inputPerMTok: 0.25, outputPerMTok: 1.25 } },
  { prefix: 'gpt-4o-mini', price: { inputPerMTok: 0.15, outputPerMTok: 0.6 } },
  { prefix: 'gpt-4o', price: { inputPerMTok: 2.5, outputPerMTok: 10 } },
  { prefix: 'gpt-4-turbo', price: { inputPerMTok: 10, outputPerMTok: 30 } }
];

let overrides: Record<string, CostModel> = {};

/**
 * Replace or extend the built-in price table, e.g. from user settings. Keys are
 * model-id prefixes; a longer (more specific) key always wins.
 */
export function setPricingOverrides(next: Record<string, CostModel>): void {
  overrides = { ...next };
}

/** Clear any configured overrides. */
export function clearPricingOverrides(): void {
  overrides = {};
}

function longestPrefixMatch(id: string, keys: string[]): string | undefined {
  return keys
    .filter((key) => id.startsWith(key.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Look up indicative pricing for a model. Returns undefined when the model is
 * unknown, in which case callers must omit cost rather than imply it is zero.
 */
export function priceFor(_provider: string, model: string): CostModel | undefined {
  const id = model.toLowerCase();
  const overrideKey = longestPrefixMatch(id, Object.keys(overrides));
  if (overrideKey) return overrides[overrideKey];

  const match = DEFAULT_PRICES.filter((entry) => id.startsWith(entry.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0];
  return match?.price;
}

/** Format a USD amount at a sensible precision for very small numbers. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/** The user-facing provenance string, e.g. "Generating with: Built-in templates". */
export function formatProvenance(capability: Capability): string {
  return `Generating with: ${capability.label}`;
}

/**
 * A compact one-line summary of a finished generation. Token and cost figures
 * carry a `~` when DocForge estimated rather than measured them, so an estimate
 * is never presented as an exact number.
 */
export function summarizeResult(result: DocResult): string {
  const meta = result.meta;
  const parts = [`${result.format.toUpperCase()} via ${result.generatorUsed}`];
  if (meta.sections?.length) parts.push(`${meta.sections.length} sections`);

  const approx = meta.exactUsage === false ? '~' : '';
  if (typeof meta.tokens === 'number') parts.push(`${approx}${meta.tokens} tokens`);
  if (typeof meta.costUsd === 'number') parts.push(`~${formatUsd(meta.costUsd)} est.`);
  if (typeof meta.durationMs === 'number') parts.push(`${meta.durationMs}ms`);
  if (meta.repaired) parts.push('repaired');
  if (meta.cached) parts.push('cached');
  return parts.join(' · ');
}
