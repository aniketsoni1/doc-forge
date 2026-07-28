import type { Transform, TransformContext, TransformId } from './types';
import {
  addHeadings,
  bulletsToProse,
  executiveSummary,
  proseToBullets,
  tidyWhitespace
} from './text';

/** Shared preamble so every AI transform returns text, not commentary. */
function base(ctx: TransformContext, instruction: string): string {
  const structure =
    ctx.format === 'html'
      ? 'Preserve the existing HTML structure and tags.'
      : 'Preserve the existing Markdown structure: headings, lists, code fences and links.';
  return [
    instruction,
    structure,
    'Return ONLY the rewritten text. No preamble, no explanation, no code fences.',
    '',
    'Text:',
    ctx.selection
  ].join('\n');
}

const TRANSFORMS: readonly Transform[] = [
  {
    id: 'improve-clarity',
    label: 'Improve Clarity',
    description: 'Rewrite for clearer, more direct phrasing',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) => base(ctx, 'Rewrite the text below to be clearer and easier to follow, keeping its meaning and roughly its length.')
  },
  {
    id: 'fix-grammar',
    label: 'Fix Grammar',
    description: 'Correct grammar, spelling and punctuation only',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) => base(ctx, 'Correct only grammar, spelling and punctuation in the text below. Do not reword, restructure or change the meaning.')
  },
  {
    id: 'make-professional',
    label: 'Make Professional',
    description: 'Raise the register to formal business English',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) => base(ctx, 'Rewrite the text below in a professional, formal register suitable for a business audience.')
  },
  {
    id: 'make-concise',
    label: 'Make Concise',
    description: 'Shorten without losing substance',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) => base(ctx, 'Rewrite the text below to be significantly shorter while keeping every substantive point. Remove padding and repetition.')
  },
  {
    id: 'expand-detail',
    label: 'Expand with Detail',
    description: 'Add depth and supporting explanation',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) => base(ctx, 'Expand the text below with additional relevant detail and supporting explanation. Do not invent specific facts, figures or citations.')
  },
  {
    id: 'simplify-language',
    label: 'Simplify Language',
    description: 'Plain language, shorter sentences',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) => base(ctx, 'Rewrite the text below in plain language with shorter sentences and no jargon. Explain any term that must be kept.')
  },
  {
    id: 'change-tone',
    label: 'Change Tone',
    description: 'Rewrite in a chosen tone',
    kind: 'ai',
    formats: ['md', 'html'],
    requires: 'tone',
    prompt: (ctx) => base(ctx, `Rewrite the text below in a ${ctx.tone ?? 'neutral'} tone, keeping its meaning.`)
  },
  {
    id: 'rewrite-for-audience',
    label: 'Rewrite for Audience',
    description: 'Retarget the text at a specific reader',
    kind: 'ai',
    formats: ['md', 'html'],
    requires: 'audience',
    prompt: (ctx) => base(ctx, `Rewrite the text below for this audience: ${ctx.audience ?? 'a general reader'}. Adjust vocabulary and assumed background accordingly.`)
  },
  {
    id: 'translate',
    label: 'Translate',
    description: 'Translate into another language',
    kind: 'ai',
    formats: ['md', 'html'],
    requires: 'language',
    prompt: (ctx) => base(ctx, `Translate the text below into ${ctx.language ?? 'English'}. Keep code, identifiers and URLs untranslated.`)
  },
  {
    id: 'document-code',
    label: 'Document Code',
    description: 'Write documentation for the selected code',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx) =>
      [
        `Write clear documentation for the following ${ctx.languageId ?? 'code'}.`,
        'Cover what it does, its parameters and return value, and any notable behaviour.',
        'Do not restate the code line by line.',
        'Return ONLY the documentation in Markdown. No preamble, no code fences around the whole answer.',
        '',
        'Code:',
        ctx.selection
      ].join('\n')
  },
  {
    id: 'custom',
    label: 'Apply Custom Instruction',
    description: 'Rewrite following your own instruction',
    kind: 'ai',
    formats: ['md', 'html'],
    requires: 'instruction',
    prompt: (ctx) => base(ctx, `Apply this instruction to the text below: ${ctx.instruction ?? 'improve it'}.`)
  },

  // Deterministic: structural, offline, always available.
  {
    id: 'to-bullets',
    label: 'Convert to Bullet Points',
    description: 'One bullet per sentence - works offline',
    kind: 'deterministic',
    formats: ['md'],
    apply: (ctx) => proseToBullets(ctx.selection)
  },
  {
    id: 'bullets-to-prose',
    label: 'Convert Bullets to Prose',
    description: 'Join list items into a paragraph - works offline',
    kind: 'deterministic',
    formats: ['md'],
    apply: (ctx) => bulletsToProse(ctx.selection)
  },
  {
    id: 'add-headings',
    label: 'Add Headings',
    description: 'Insert a heading above each paragraph - works offline',
    kind: 'deterministic',
    formats: ['md'],
    apply: (ctx) => addHeadings(tidyWhitespace(ctx.selection))
  },
  {
    id: 'executive-summary',
    label: 'Generate Executive Summary',
    description: 'Extractive summary of the leading points - works offline',
    kind: 'deterministic',
    formats: ['md'],
    apply: (ctx) => executiveSummary(ctx.selection)
  }
];

/** Every transform, in menu order. */
export function listTransforms(): readonly Transform[] {
  return TRANSFORMS;
}

/** Transforms applicable to a format. */
export function transformsForFormat(format: 'md' | 'html'): Transform[] {
  return TRANSFORMS.filter((t) => t.formats.includes(format));
}

/** Transforms that need no provider. */
export function offlineTransforms(): Transform[] {
  return TRANSFORMS.filter((t) => t.kind === 'deterministic');
}

export function getTransform(id: TransformId): Transform | undefined {
  return TRANSFORMS.find((t) => t.id === id);
}

/**
 * Run a deterministic transform. Throws for AI transforms, which must go
 * through a generator - the caller is expected to branch on `kind` rather than
 * discover the difference here.
 */
export function applyDeterministic(transform: Transform, ctx: TransformContext): string {
  if (!transform.apply) {
    throw new Error(`Transform "${transform.id}" requires an AI generator.`);
  }
  return transform.apply(ctx);
}

/** Which extra input a transform still needs, if any. */
export function missingInput(
  transform: Transform,
  ctx: TransformContext
): Transform['requires'] | undefined {
  switch (transform.requires) {
    case 'tone':
      return ctx.tone ? undefined : 'tone';
    case 'audience':
      return ctx.audience?.trim() ? undefined : 'audience';
    case 'language':
      return ctx.language?.trim() ? undefined : 'language';
    case 'instruction':
      return ctx.instruction?.trim() ? undefined : 'instruction';
    default:
      return undefined;
  }
}
