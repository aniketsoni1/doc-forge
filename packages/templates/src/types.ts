import type { DocSpec } from '@dfg/core';
import type { PromptAnalysis } from './heuristics';

export interface TemplateContext {
  spec: DocSpec;
  analysis: PromptAnalysis;
}

export interface Template {
  /** Stable id, e.g. 'readme'. */
  id: string;
  /** Human label. */
  title: string;
  /** One-line description shown in pickers. */
  description: string;
  /** Alternate ids/keywords used for auto-selection. */
  aliases: string[];
  /** Build a complete Markdown document body (including the H1). */
  build(ctx: TemplateContext): string;
}

export interface TemplateSummary {
  id: string;
  title: string;
  description: string;
}
