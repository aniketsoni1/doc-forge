import type { Capability, DocFormat, DocResult, DocSpec, Generator } from '@dfg/core';

export interface MockGeneratorOptions {
  id?: string;
  label?: string;
  available?: boolean;
  requiresNetwork?: boolean;
  format?: DocFormat;
  /** Content to return, or a builder. Ignored when throwing. */
  content?: string | ((spec: DocSpec) => string);
  /** When set, generate() rejects (to exercise fall-through). */
  throwOnGenerate?: boolean | Error;
  /** Records each spec passed to generate(). */
  calls?: DocSpec[];
}

/** A configurable in-memory generator for exercising the agent ladder. */
export class MockGenerator implements Generator {
  readonly id: string;
  private readonly opts: MockGeneratorOptions;
  readonly calls: DocSpec[] = [];

  constructor(opts: MockGeneratorOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.opts = opts;
  }

  capability(): Promise<Capability> {
    return Promise.resolve({
      id: this.id,
      available: this.opts.available ?? true,
      label: this.opts.label ?? `Mock (${this.id})`,
      requiresNetwork: this.opts.requiresNetwork ?? false
    });
  }

  generate(spec: DocSpec): Promise<DocResult> {
    this.calls.push(spec);
    if (this.opts.throwOnGenerate) {
      const err =
        this.opts.throwOnGenerate instanceof Error
          ? this.opts.throwOnGenerate
          : new Error(`${this.id} failed`);
      return Promise.reject(err);
    }
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
      meta: {}
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
