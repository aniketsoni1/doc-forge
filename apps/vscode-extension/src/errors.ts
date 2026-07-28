import type { GenerationAttempt } from '@dfg/agent';

/** A user-facing error broken into the parts §4 of the brief requires. */
export interface ActionableError {
  /** One-line summary shown in the notification. */
  message: string;
  /** What the user should do next. */
  recovery: string;
  /** True when DocForge still produced a document from a later generator. */
  usedFallback: boolean;
  /** Reassurance that nothing was lost. */
  dataPreserved: string;
}

/**
 * Turn a failure plus its attempt trail into an explanation rather than a bare
 * message. Kept free of `vscode` imports so it is unit-testable.
 */
export function describeFailure(
  err: unknown,
  attempts: readonly GenerationAttempt[] = []
): ActionableError {
  const failures = attempts.filter(
    (a) => a.status === 'failed_error' || a.status === 'failed_validation'
  );
  const last = failures[failures.length - 1];

  const base = err instanceof Error ? err.message : String(err);
  const stage = last ? `${last.label ?? last.generatorId} failed` : 'Generation failed';

  return {
    message: last?.errorMessage ? `${stage}: ${last.errorMessage}` : `${stage}: ${base}`,
    recovery: last?.recovery ?? 'Run DocForge: Run Diagnostics, or try the offline templates.',
    usedFallback: false,
    dataPreserved: 'No files were changed.'
  };
}

/**
 * A short note explaining why the winning generator was not the first choice.
 * Returns undefined when the first choice won, so the UI stays quiet.
 */
export function describeFallback(attempts: readonly GenerationAttempt[]): string | undefined {
  const passedOver = attempts.filter(
    (a) => a.status === 'failed_error' || a.status === 'failed_validation'
  );
  if (passedOver.length === 0) return undefined;
  const first = passedOver[0];
  if (!first) return undefined;
  const more = passedOver.length > 1 ? ` (+${passedOver.length - 1} more)` : '';
  return `Fell back: ${first.label ?? first.generatorId} - ${first.errorMessage ?? first.status}${more}`;
}

/** Format the whole trail for the output channel. */
export function formatDiagnostics(attempts: readonly GenerationAttempt[]): string {
  if (attempts.length === 0) return 'No generation attempts recorded.';
  return attempts
    .map((a, i) => {
      const lines = [`${i + 1}. ${a.label ?? a.generatorId} → ${a.status} (${a.durationMs}ms)`];
      if (a.errorCode) lines.push(`   cause: ${a.errorCode}`);
      if (a.errorMessage) lines.push(`   detail: ${a.errorMessage}`);
      if (a.validationIssues?.length) lines.push(`   validation: ${a.validationIssues.join('; ')}`);
      if (a.repairAttempted) {
        lines.push(`   repair: ${a.repairSucceeded ? 'succeeded' : 'failed'}`);
      }
      if (a.recovery) lines.push(`   next: ${a.recovery}`);
      return lines.join('\n');
    })
    .join('\n');
}
