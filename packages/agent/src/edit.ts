import type { DocFormat, GenerateOptions, Generator } from '@dfg/core';
import { DocForgeError, isAbortError, toProviderError } from '@dfg/core';
import { normalizeMarkdown, sanitizeDocumentHtml } from '@dfg/sanitize';
import {
  applyDeterministic,
  missingInput,
  type Transform,
  type TransformContext
} from '@dfg/transforms';
import type { GenerationAttempt } from './attempts';

/**
 * Running a transform over a *fragment* rather than a whole document.
 *
 * This deliberately does not reuse the document ladder: that path validates
 * output as a complete document (it insists on an H1, wraps HTML in a page
 * scaffold) which is exactly wrong for a three-sentence selection. What it does
 * share is the seam, the fallback discipline, and the attempt trail.
 */

export interface EditRequest {
  transform: Transform;
  context: TransformContext;
  /** Ordered generators, highest priority first. */
  generators: Generator[];
  /** Skip AI generators entirely. */
  forceDeterministic?: boolean;
  /** When false, generators requiring the network are skipped. Default true. */
  allowNetwork?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  now?: () => number;
}

export interface EditResult {
  /** The rewritten text, ready to be diffed against the original. */
  text: string;
  /** The original selection, always preserved for diffing and rejection. */
  original: string;
  /** Label of whatever produced the result. */
  producedBy: string;
  /** True when no model was involved. */
  deterministic: boolean;
  attempts: GenerationAttempt[];
  warnings: string[];
}

/** Strip a wrapping code fence a model may have added around the whole answer. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fence?.[1] ?? trimmed;
}

/**
 * Clean a rewritten fragment.
 *
 * Model output is untrusted here exactly as it is for a whole document: HTML is
 * sanitized against the same allowlist, so a selection rewrite can never be the
 * hole through which script survives.
 */
function finalizeFragment(text: string, format: DocFormat): { text: string; warnings: string[] } {
  if (format === 'html') {
    const { html, modified } = sanitizeDocumentHtml(text);
    return {
      text: html.trim(),
      warnings: modified ? ['Some unsafe HTML was removed from the rewritten text.'] : []
    };
  }
  return { text: normalizeMarkdown(text).trim(), warnings: [] };
}

/**
 * Apply a transform to a selection, preferring AI when the transform needs it
 * and falling back to a clear failure rather than a silently worse result.
 */
export async function runTransform(request: EditRequest): Promise<EditResult> {
  const { transform, context } = request;
  const original = context.selection;

  const missing = missingInput(transform, context);
  if (missing) {
    throw new DocForgeError('transform_input_required', `This transform needs a ${missing}.`);
  }
  if (!original.trim()) {
    throw new DocForgeError('empty_selection', 'Select some text first.');
  }

  const now = request.now ?? ((): number => Date.now());
  const attempts: GenerationAttempt[] = [];

  // Deterministic transforms never touch a provider.
  if (transform.kind === 'deterministic') {
    const started = now();
    const text = applyDeterministic(transform, context);
    attempts.push({
      generatorId: 'deterministic',
      label: 'Built-in text transform',
      status: 'succeeded',
      durationMs: Math.max(0, now() - started)
    });
    return {
      text,
      original,
      producedBy: 'Built-in text transform',
      deterministic: true,
      attempts,
      warnings: []
    };
  }

  if (request.forceDeterministic) {
    throw new DocForgeError(
      'transform_needs_ai',
      `"${transform.label}" needs an AI provider. Offline, use one of the built-in transforms instead.`
    );
  }

  const prompt = transform.prompt?.(context);
  if (!prompt) {
    throw new DocForgeError('transform_misconfigured', `Transform "${transform.id}" has no prompt.`);
  }

  const allowNetwork = request.allowNetwork ?? true;
  const spec = {
    prompt,
    format: context.format,
    tone: context.tone ?? ('neutral' as const),
    length: 'medium' as const,
    variables: {}
  };

  for (const generator of request.generators) {
    if (request.signal?.aborted) {
      throw new DocForgeError('cancelled', 'Edit was cancelled.');
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
      const options: GenerateOptions = {
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onChunk ? { onChunk: request.onChunk } : {})
      };
      const result = await generator.generate(spec, options);
      const cleaned = finalizeFragment(stripFence(result.content), context.format);

      if (!cleaned.text.trim()) {
        attempts.push({
          generatorId: generator.id,
          label: capability.label,
          status: 'failed_validation',
          durationMs: elapsed(),
          fallbackReason: 'the rewritten text was empty'
        });
        continue;
      }

      attempts.push({
        generatorId: generator.id,
        label: capability.label,
        status: 'succeeded',
        durationMs: elapsed()
      });

      return {
        text: cleaned.text,
        original,
        producedBy: capability.label,
        deterministic: false,
        attempts,
        warnings: cleaned.warnings
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
      if (cancelled) {
        throw new DocForgeError('cancelled', 'Edit was cancelled.', { cause: err });
      }
      continue;
    }
  }

  // No provider could do it. Say so plainly, and never return the unchanged
  // selection dressed up as a result.
  const trail = attempts
    .map((a) => `${a.label ?? a.generatorId} (${a.fallbackReason ?? a.status})`)
    .join(', ');
  throw new DocForgeError(
    'no_generator',
    trail
      ? `No AI provider could apply "${transform.label}". Tried: ${trail}.`
      : `"${transform.label}" needs an AI provider, and none is available.`
  );
}
