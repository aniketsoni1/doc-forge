import type { ProviderErrorCode } from '@dfg/core';

/** How a single generator attempt ended. */
export type AttemptStatus =
  | 'succeeded'
  | 'succeeded_after_repair'
  | 'skipped_unavailable'
  | 'skipped_offline'
  | 'failed_validation'
  | 'failed_error'
  | 'cancelled';

/**
 * A record of one generator attempt. The ladder emits one per candidate so the
 * fallback path is observable and testable rather than silently swallowed.
 */
export interface GenerationAttempt {
  /** Generator id as declared by the implementation. */
  generatorId: string;
  /** Human label from `capability()`, when it was probed successfully. */
  label?: string;
  status: AttemptStatus;
  /** Milliseconds spent in this attempt. */
  durationMs: number;
  /** Validation issues seen before repair, if any. */
  validationIssues?: string[];
  /** True when a bounded repair pass ran. */
  repairAttempted?: boolean;
  /** True when repair produced a valid document. */
  repairSucceeded?: boolean;
  /** Machine-readable failure cause, for failed attempts. */
  errorCode?: ProviderErrorCode;
  /** Redacted, user-safe failure message. */
  errorMessage?: string;
  /** What the user can do about it. */
  recovery?: string;
  /** Why the ladder moved on. Absent on the successful attempt. */
  fallbackReason?: string;
}

const TERMINAL: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  'succeeded',
  'succeeded_after_repair'
]);

/** True when this attempt produced the final document. */
export function isSuccess(attempt: GenerationAttempt): boolean {
  return TERMINAL.has(attempt.status);
}

/** The attempts that did not produce a document, in order. */
export function failedAttempts(attempts: readonly GenerationAttempt[]): GenerationAttempt[] {
  return attempts.filter((a) => !isSuccess(a));
}

/**
 * A short, user-facing explanation of why the winning generator was not the first
 * choice. Returns undefined when nothing was skipped, so hosts can stay quiet in
 * the common case.
 */
export function explainFallback(attempts: readonly GenerationAttempt[]): string | undefined {
  const failed = failedAttempts(attempts).filter((a) => a.status !== 'skipped_unavailable');
  if (failed.length === 0) return undefined;
  return failed
    .map((a) => `${a.label ?? a.generatorId}: ${a.fallbackReason ?? a.status}`)
    .join('; ');
}

/** A multi-line diagnostic trail for logs and the `doctor` command. */
export function formatAttemptTrail(attempts: readonly GenerationAttempt[]): string {
  return attempts
    .map((a) => {
      const parts = [`${a.generatorId} → ${a.status} (${a.durationMs}ms)`];
      if (a.errorMessage) parts.push(`    ${a.errorCode ?? 'error'}: ${a.errorMessage}`);
      if (a.validationIssues?.length) parts.push(`    issues: ${a.validationIssues.join('; ')}`);
      if (a.recovery && !isSuccess(a)) parts.push(`    → ${a.recovery}`);
      return parts.join('\n');
    })
    .join('\n');
}
