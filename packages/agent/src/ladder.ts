import type { Capability, DocResult, DocSpec, Generator } from '@dfg/core';
import { DocForgeError, isAbortError, toProviderError } from '@dfg/core';
import { formatProvenance } from '@dfg/reporting';
import { finalizeDocument, type FinalDocument } from './finalize';
import { repairResult, validateResult } from './validate';
import { explainFallback, type GenerationAttempt } from './attempts';

export interface LadderOptions {
  /** Ordered generators, highest priority first. Assembled by the host. */
  generators: Generator[];
  /** Force the deterministic template generator (CLI `--no-ai`). */
  forceTemplate?: boolean;
  /** Move a specific generator id/family to the front (picker / `--model`). */
  preferredId?: string;
  /** When false, generators that require the network are skipped. Default true. */
  allowNetwork?: boolean;
  /** Cooperative cancellation for the whole ladder run. */
  signal?: AbortSignal;
  /** Forwarded to streaming-capable generators. */
  onChunk?: (chunk: string) => void;
  /** Injectable clock, so attempt timings are deterministic in tests. */
  now?: () => number;
}

export interface GenerationOutcome {
  /** The raw result from the chosen generator (post-repair if repaired). */
  result: DocResult;
  /** Capability of the chosen generator. */
  capability: Capability;
  /** Writable deliverable + preview. */
  document: FinalDocument;
  /** "Generating with: …" provenance line. */
  provenance: string;
  /** Every attempt the ladder made, in order, including the successful one. */
  attempts: GenerationAttempt[];
  /** Human-readable reason the winner was not the first choice, if applicable. */
  fallbackSummary: string | undefined;
}

const isTemplateFamily = (g: Generator): boolean => g.id === 'template';

function order(generators: Generator[], preferredId?: string): Generator[] {
  if (!preferredId) return generators;
  const preferred = generators.filter(
    (g) => g.id === preferredId || g.id.startsWith(`${preferredId}:`)
  );
  const rest = generators.filter((g) => !preferred.includes(g));
  return [...preferred, ...rest];
}

/** Probe every generator's capability (never throws). */
export async function probeCapabilities(generators: Generator[]): Promise<Capability[]> {
  return Promise.all(
    generators.map(async (g) => {
      try {
        return await g.capability();
      } catch {
        return { id: g.id, available: false, label: g.id, requiresNetwork: false };
      }
    })
  );
}

/**
 * Resolve the best available generator and produce a document. Every failure -
 * unavailable, offline, error, or invalid output that a single repair can't fix -
 * falls through to the next generator, always ending at the template fallback.
 *
 * Unlike a plain try/catch chain, each attempt is recorded in
 * {@link GenerationOutcome.attempts} with a machine-readable cause, so hosts can
 * tell the user *why* a fallback happened instead of just naming the winner.
 */
export async function resolveAndGenerate(
  spec: DocSpec,
  options: LadderOptions
): Promise<GenerationOutcome> {
  const allowNetwork = options.allowNetwork ?? true;
  const now = options.now ?? ((): number => Date.now());
  let candidates = options.forceTemplate
    ? options.generators.filter(isTemplateFamily)
    : options.generators;
  candidates = order(candidates, options.preferredId);

  const attempts: GenerationAttempt[] = [];

  for (const generator of candidates) {
    if (options.signal?.aborted) {
      throw new DocForgeError('cancelled', 'Generation was cancelled.');
    }

    const started = now();
    const elapsed = (): number => Math.max(0, now() - started);

    const capability = await generator.capability().catch(() => undefined);

    if (!capability || !capability.available) {
      attempts.push({
        generatorId: generator.id,
        ...(capability?.label ? { label: capability.label } : {}),
        status: 'skipped_unavailable',
        durationMs: elapsed(),
        fallbackReason: capability?.detail ?? 'not available'
      });
      continue;
    }

    if (capability.requiresNetwork && !allowNetwork) {
      attempts.push({
        generatorId: generator.id,
        label: capability.label,
        status: 'skipped_offline',
        durationMs: elapsed(),
        fallbackReason: 'network generators are disabled for this run'
      });
      continue;
    }

    try {
      const generateOptions = {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onChunk ? { onChunk: options.onChunk } : {})
      };
      let result = await generator.generate(spec, generateOptions);

      const issues = validateResult(result);
      let repairAttempted = false;
      let repairSucceeded = false;

      if (issues.length > 0) {
        repairAttempted = true;
        const repaired = repairResult(result);
        const afterRepair = validateResult(repaired);
        if (afterRepair.length > 0) {
          attempts.push({
            generatorId: generator.id,
            label: capability.label,
            status: 'failed_validation',
            durationMs: elapsed(),
            validationIssues: issues,
            repairAttempted: true,
            repairSucceeded: false,
            fallbackReason: `output failed validation after repair (${afterRepair.join('; ')})`
          });
          continue;
        }
        repairSucceeded = true;
        result = repaired;
      }

      const durationMs = elapsed();
      const document = finalizeDocument(spec, result);
      const warnings = [...result.warnings, ...document.warnings];
      const fellBackFrom = attempts.map((a) => a.generatorId);

      attempts.push({
        generatorId: generator.id,
        label: capability.label,
        status: repairSucceeded ? 'succeeded_after_repair' : 'succeeded',
        durationMs,
        ...(issues.length ? { validationIssues: issues } : {}),
        ...(repairAttempted ? { repairAttempted, repairSucceeded } : {})
      });

      const finalResult: DocResult = {
        ...result,
        warnings,
        meta: {
          ...result.meta,
          durationMs,
          ...(fellBackFrom.length ? { fellBackFrom } : {})
        }
      };

      return {
        result: finalResult,
        capability,
        document,
        provenance: formatProvenance(capability),
        attempts,
        fallbackSummary: explainFallback(attempts)
      };
    } catch (err) {
      const providerError = toProviderError(err, generator.id);
      const cancelled = isAbortError(err) || providerError.providerCode === 'cancelled';

      attempts.push({
        generatorId: generator.id,
        label: capability.label,
        status: cancelled ? 'cancelled' : 'failed_error',
        durationMs: elapsed(),
        errorCode: providerError.providerCode,
        errorMessage: providerError.message,
        recovery: providerError.recovery,
        fallbackReason: providerError.message
      });

      // Cancellation is a user decision, not a generator defect: stop the ladder
      // rather than quietly falling back to a document nobody asked for.
      if (cancelled) {
        throw new DocForgeError('cancelled', 'Generation was cancelled.', { cause: err });
      }
      continue;
    }
  }

  const trail = attempts
    .map((a) => `${a.label ?? a.generatorId} (${a.fallbackReason ?? a.status})`)
    .join(', ');
  throw new DocForgeError(
    'no_generator',
    trail
      ? `No generator could produce a document. Tried: ${trail}.`
      : 'No generator could produce a document. Include the template generator in the ladder.'
  );
}
