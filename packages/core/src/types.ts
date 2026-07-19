/**
 * Normalized domain model shared by every DocForge generator and UI.
 * These are plain contracts: no I/O, no editor imports.
 */

export type DocFormat = 'md' | 'html';
export type DocTone = 'neutral' | 'formal' | 'friendly' | 'technical' | 'marketing';
export type DocLength = 'short' | 'medium' | 'long';

/** A fully-normalized generation request (all defaults resolved). */
export interface DocSpec {
  /** Free-text description of the document the user wants. */
  prompt: string;
  /** Output format. */
  format: DocFormat;
  /** Desired voice. */
  tone: DocTone;
  /** Rough target size. */
  length: DocLength;
  /** Optional preset id (readme | blog | report | landing | changelog | letter). */
  template?: string;
  /** Optional explicit document title; otherwise derived from the prompt. */
  title?: string;
  /** Named substitutions available to templates and presets. */
  variables: Record<string, string>;
}

/** Provenance and accounting metadata attached to a generated document. */
export interface DocMeta {
  /** Detected/estimated section headings, in order. */
  sections?: string[];
  /** Token count reported or estimated for an AI generation. */
  tokens?: number;
  /** Estimated cost in USD for an AI generation. */
  costUsd?: number;
  /** True when the result came from the prompt cache. */
  cached?: boolean;
  /** True when a bounded repair pass was applied. */
  repaired?: boolean;
  /** Generator ids the ladder tried and rejected before this one succeeded. */
  fellBackFrom?: string[];
}

/** The output of a generation. */
export interface DocResult {
  /** Final document body (Markdown source or sanitized HTML). */
  content: string;
  format: DocFormat;
  /** Stable id of the generator that produced this, e.g. `template`, `byok:anthropic`. */
  generatorUsed: string;
  /** Non-fatal notes for the user (e.g. "no AI model available; used templates"). */
  warnings: string[];
  meta: DocMeta;
}

/** A generator's self-report of whether it can run right now. */
export interface Capability {
  /** Stable generator family id: `lm-api` | `extension` | `byok` | `template`. */
  id: string;
  available: boolean;
  /** Human-facing provenance label, e.g. "Copilot (VS Code LM API)". */
  label: string;
  /** Optional extra detail (model name, reason unavailable). */
  detail?: string;
  /** Whether using this generator performs a network call. */
  requiresNetwork: boolean;
}

/**
 * The single generation seam. Every path - AI or deterministic - implements this.
 * Implementations must never throw from {@link capability}; only from {@link generate}.
 */
export interface Generator {
  readonly id: string;
  capability(): Promise<Capability>;
  generate(spec: DocSpec): Promise<DocResult>;
}
