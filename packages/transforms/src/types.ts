import type { DocFormat, DocTone } from '@dfg/core';

/** Stable identifiers for the selection operations offered to users. */
export type TransformId =
  | 'improve-clarity'
  | 'fix-grammar'
  | 'make-professional'
  | 'make-concise'
  | 'expand-detail'
  | 'simplify-language'
  | 'change-tone'
  | 'to-bullets'
  | 'bullets-to-prose'
  | 'add-headings'
  | 'executive-summary'
  | 'rewrite-for-audience'
  | 'translate'
  | 'document-code'
  | 'custom';

/** What a transform needs to know about the text it is rewriting. */
export interface TransformContext {
  /** The exact selected text. */
  selection: string;
  /** Format of the surrounding document, so structure can be preserved. */
  format: DocFormat;
  /** Target tone, for `change-tone`. */
  tone?: DocTone;
  /** Target audience, for `rewrite-for-audience`. */
  audience?: string;
  /** Target language, for `translate`. */
  language?: string;
  /** Free-text instruction, for `custom`. */
  instruction?: string;
  /** Language id of the source file, for `document-code`. */
  languageId?: string;
}

/**
 * How a transform can be carried out.
 *
 * `deterministic` transforms are pure text manipulation and always available -
 * they are the offline half of the promise that DocForge never hard-fails.
 * `ai` transforms need a model and degrade to a clear explanation when none is
 * present, rather than silently producing something worse.
 */
export type TransformKind = 'deterministic' | 'ai';

export interface Transform {
  id: TransformId;
  /** Command-palette label. */
  label: string;
  /** One-line description for the picker. */
  description: string;
  kind: TransformKind;
  /** Formats this transform understands. */
  formats: DocFormat[];
  /**
   * Rewrite the text without a model. Present only for deterministic
   * transforms, and for those it must be pure and repeatable.
   */
  apply?: (ctx: TransformContext) => string;
  /** Build the model instruction for AI transforms. */
  prompt?: (ctx: TransformContext) => string;
  /** Extra input this transform needs before it can run. */
  requires?: 'tone' | 'audience' | 'language' | 'instruction';
}

/** True when the transform can run with no provider and no network. */
export function isOffline(transform: Transform): boolean {
  return transform.kind === 'deterministic';
}
