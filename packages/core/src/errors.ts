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
