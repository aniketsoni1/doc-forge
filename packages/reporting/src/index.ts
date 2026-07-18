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

/** The user-facing provenance string, e.g. "Generating with: Built-in templates". */
export function formatProvenance(capability: Capability): string {
  return `Generating with: ${capability.label}`;
}

/** A compact one-line summary of a finished generation. */
export function summarizeResult(result: DocResult): string {
  const parts = [`${result.format.toUpperCase()} via ${result.generatorUsed}`];
  if (result.meta.sections?.length) parts.push(`${result.meta.sections.length} sections`);
  if (typeof result.meta.tokens === 'number') parts.push(`${result.meta.tokens} tokens`);
  if (typeof result.meta.costUsd === 'number') parts.push(`$${result.meta.costUsd.toFixed(4)}`);
  if (result.meta.repaired) parts.push('repaired');
  if (result.meta.cached) parts.push('cached');
  return parts.join(' · ');
}
