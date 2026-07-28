import { redactSecrets } from './redact';

/** Base class for all DocForge errors so hosts can branch on `.code`. */
export class DocForgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DocForgeError';
    this.code = code;
  }
}

/** Raised when a generator was asked to run but is not available. */
export class GeneratorUnavailableError extends DocForgeError {
  constructor(generatorId: string, detail?: string) {
    super(
      'generator_unavailable',
      `Generator "${generatorId}" is not available${detail ? `: ${detail}` : ''}.`
    );
    this.name = 'GeneratorUnavailableError';
  }
}

/** Raised when produced output fails validation (lint/sanitize/parse). */
export class DocValidationError extends DocForgeError {
  readonly issues: string[];
  constructor(issues: string[]) {
    super('doc_validation_failed', `Generated document failed validation: ${issues.join('; ')}`);
    this.name = 'DocValidationError';
    this.issues = issues;
  }
}

/**
 * The closed set of reasons a generator can fail. Every provider adapter maps its
 * native failures onto one of these, so hosts can react - and users can be told
 * *why* a fallback happened - without string-matching provider messages.
 */
export type ProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'unsupported_model'
  | 'context_too_large'
  | 'invalid_response'
  | 'cancelled'
  | 'unavailable'
  | 'content_rejected'
  | 'unknown';

/** Short, actionable guidance shown alongside each failure. */
const RECOVERY: Record<ProviderErrorCode, string> = {
  auth: 'Check the API key (DocForge: Set API Key, or the *_API_KEY environment variable).',
  rate_limit: 'Wait and retry, or switch to another provider.',
  network: 'Check the network connection; DocForge still works offline with built-in templates.',
  unsupported_model: 'Choose a different model in the DocForge settings.',
  context_too_large: 'Shorten the prompt or request a shorter document.',
  invalid_response:
    'The provider returned something DocForge could not use; retry or switch provider.',
  cancelled: 'Cancelled - nothing was written.',
  unavailable: 'This generator is not usable right now; DocForge will try the next one.',
  content_rejected: 'The provider declined this prompt; rephrase and retry.',
  unknown: 'Retry, or run DocForge: Run Diagnostics for details.'
};

/** Whether retrying the same generator could plausibly succeed. */
const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
  'rate_limit',
  'network',
  'unavailable',
  'unknown'
]);

export interface ProviderErrorOptions {
  /** Stable id of the generator that failed, e.g. `byok:anthropic`. */
  generatorId: string;
  /** HTTP status, when the failure came from an HTTP provider. */
  status?: number;
  cause?: unknown;
  /** Override the default recovery hint. */
  recovery?: string;
}

/**
 * A generator failure with a machine-readable cause. The message is redacted on
 * construction, so a `ProviderError` is always safe to log or show to the user.
 */
export class ProviderError extends DocForgeError {
  readonly providerCode: ProviderErrorCode;
  readonly generatorId: string;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly recovery: string;

  constructor(code: ProviderErrorCode, message: string, options: ProviderErrorOptions) {
    super(`provider_${code}`, redactSecrets(message), { cause: options.cause });
    this.name = 'ProviderError';
    this.providerCode = code;
    this.generatorId = options.generatorId;
    this.status = options.status;
    this.retryable = RETRYABLE.has(code);
    this.recovery = options.recovery ?? RECOVERY[code];
  }

  /** One line combining what failed with what to do about it. */
  describe(): string {
    return `${this.message} ${this.recovery}`;
  }
}

/** Map an HTTP status from a chat-completions style API onto a provider code. */
export function providerCodeFromStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'unsupported_model';
  if (status === 413 || status === 422) return 'context_too_large';
  if (status >= 500) return 'unavailable';
  if (status === 400) return 'invalid_response';
  return 'unknown';
}

/** True when an unknown thrown value represents an abort or timeout. */
export function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Normalize any thrown value into a {@link ProviderError} so that every failure
 * the ladder records carries a code rather than a bare string.
 */
export function toProviderError(err: unknown, generatorId: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (isAbortError(err)) {
    return new ProviderError('cancelled', 'Generation was cancelled.', { generatorId, cause: err });
  }
  if (err instanceof GeneratorUnavailableError) {
    return new ProviderError('unavailable', err.message, { generatorId, cause: err });
  }
  if (err instanceof DocValidationError) {
    return new ProviderError('invalid_response', err.message, { generatorId, cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  // `fetch` surfaces connectivity problems as an opaque TypeError.
  const code: ProviderErrorCode = /fetch failed|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(
    message
  )
    ? 'network'
    : 'unknown';
  return new ProviderError(code, message || 'Unknown generator failure.', {
    generatorId,
    cause: err
  });
}
