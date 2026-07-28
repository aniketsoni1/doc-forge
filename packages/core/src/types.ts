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
  /** Total token count reported or estimated for an AI generation. */
  tokens?: number;
  /** Input tokens, when the provider reports them separately. */
  inputTokens?: number;
  /** Output tokens, when the provider reports them separately. */
  outputTokens?: number;
  /** Cost in USD. Always an estimate unless {@link exactUsage} is true. */
  costUsd?: number;
  /**
   * True when token counts came from the provider, false when DocForge estimated
   * them. Hosts must label estimated figures as estimates.
   */
  exactUsage?: boolean;
  /** Model id that produced the document, when applicable. */
  model?: string;
  /** Wall-clock duration of the successful generation, in milliseconds. */
  durationMs?: number;
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

/**
 * What a generator can do, beyond simply running. Optional so that adding a
 * capability never breaks an existing implementation; absent means "no".
 */
export interface GeneratorFeatures {
  /** Emits partial output progressively. */
  streaming?: boolean;
  /** Honours an AbortSignal passed to `generate`. */
  cancellation?: boolean;
  /** Reports real token usage (rather than an estimate). */
  costReporting?: boolean;
  /** Accepts a separate system prompt. */
  systemPrompt?: boolean;
  /** Can enumerate the models available to it. */
  modelDiscovery?: boolean;
  /** Works with no network connection. */
  offline?: boolean;
  /** Approximate maximum input tokens, when known. */
  maxContextTokens?: number;
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
  /** Optional feature advertisement used by the resolver and the UI. */
  features?: GeneratorFeatures;
}

/** Per-call options threaded through the whole generation pipeline. */
export interface GenerateOptions {
  /**
   * Cooperative cancellation. Implementations that advertise
   * {@link GeneratorFeatures.cancellation} must abort in-flight work when this
   * fires and reject with an `AbortError`.
   */
  signal?: AbortSignal;
  /** Called with incremental text by generators that advertise streaming. */
  onChunk?: (chunk: string) => void;
}

/**
 * The single generation seam. Every path - AI or deterministic - implements this.
 * Implementations must never throw from {@link capability}; only from {@link generate}.
 */
export interface Generator {
  readonly id: string;
  capability(): Promise<Capability>;
  generate(spec: DocSpec, options?: GenerateOptions): Promise<DocResult>;
}
