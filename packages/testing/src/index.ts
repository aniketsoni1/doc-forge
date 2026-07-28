import type {
  Capability,
  DocFormat,
  DocMeta,
  DocResult,
  DocSpec,
  GenerateOptions,
  Generator,
  GeneratorFeatures
} from '@dfg/core';

export interface MockGeneratorOptions {
  id?: string;
  label?: string;
  detail?: string;
  available?: boolean;
  requiresNetwork?: boolean;
  features?: GeneratorFeatures;
  format?: DocFormat;
  /** Content to return, or a builder. Ignored when throwing. */
  content?: string | ((spec: DocSpec) => string);
  /** Metadata to attach to the result (token counts, cost, model). */
  meta?: DocMeta;
  /** When set, generate() rejects (to exercise fall-through). */
  throwOnGenerate?: boolean | Error;
  /** Reject with an AbortError when the caller's signal is already aborted. */
  honorSignal?: boolean;
  /** Chunks handed to `onChunk` before resolving, to exercise streaming. */
  chunks?: string[];
  /** Records each spec passed to generate(). */
  calls?: DocSpec[];
}

/** An `AbortError` shaped like the one `fetch` and the DOM produce. */
export function abortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/** A configurable in-memory generator for exercising the agent ladder. */
export class MockGenerator implements Generator {
  readonly id: string;
  private readonly opts: MockGeneratorOptions;
  readonly calls: DocSpec[] = [];
  /** Options seen by the most recent `generate` call, for assertions. */
  lastOptions: GenerateOptions | undefined;

  constructor(opts: MockGeneratorOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.opts = opts;
  }

  capability(): Promise<Capability> {
    return Promise.resolve({
      id: this.id,
      available: this.opts.available ?? true,
      label: this.opts.label ?? `Mock (${this.id})`,
      ...(this.opts.detail ? { detail: this.opts.detail } : {}),
      requiresNetwork: this.opts.requiresNetwork ?? false,
      ...(this.opts.features ? { features: this.opts.features } : {})
    });
  }

  generate(spec: DocSpec, options: GenerateOptions = {}): Promise<DocResult> {
    this.calls.push(spec);
    this.lastOptions = options;

    if (this.opts.honorSignal && options.signal?.aborted) {
      return Promise.reject(abortError());
    }
    if (this.opts.throwOnGenerate) {
      const err =
        this.opts.throwOnGenerate instanceof Error
          ? this.opts.throwOnGenerate
          : new Error(`${this.id} failed`);
      return Promise.reject(err);
    }

    for (const chunk of this.opts.chunks ?? []) options.onChunk?.(chunk);

    const format = this.opts.format ?? spec.format;
    const content =
      typeof this.opts.content === 'function'
        ? this.opts.content(spec)
        : this.opts.content ?? `# ${spec.title ?? 'Mock'}\n\nContent from ${this.id}.\n`;
    return Promise.resolve({
      content,
      format,
      generatorUsed: this.id,
      warnings: [],
      meta: this.opts.meta ?? {}
    });
  }
}

export const SAMPLE_PROMPTS: readonly string[] = [
  'Write a README for a CLI tool called Acme',
  'Landing page for a note-taking app with features: fast, private, offline',
  'Report on quarterly sales performance',
  'Draft release notes for version 2.0',
  'Cover letter for a senior engineering role'
];
