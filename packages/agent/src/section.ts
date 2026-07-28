import type { DocFormat, Generator } from '@dfg/core';
import { DocForgeError } from '@dfg/core';
import { replaceSectionIn, sectionBody, type Section } from '@dfg/document-model';
import type { GenerationAttempt } from './attempts';
import { runTransform } from './edit';
import type { Transform, TransformContext } from '@dfg/transforms';

export interface SectionRequest {
  /** The whole document. */
  source: string;
  /** The section to regenerate, from a parsed outline of `source`. */
  section: Section;
  format: DocFormat;
  /** Optional user steer, e.g. "make it shorter". */
  instruction?: string;
  generators: Generator[];
  allowNetwork?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  now?: () => number;
}

export interface SectionResult {
  /** The full document with only this section's body replaced. */
  document: string;
  /** The section body before the change, for diffing. */
  originalBody: string;
  /** The regenerated body. */
  newBody: string;
  producedBy: string;
  attempts: GenerationAttempt[];
  warnings: string[];
}

/**
 * A transform that rewrites one section, given its heading and its neighbours'
 * titles for context.
 *
 * Passing surrounding structure matters: without it a model tends to restate
 * the whole document's premise in every section. It is told explicitly not to
 * repeat the heading, because the heading is the user's anchor and
 * `replaceSectionIn` keeps it.
 */
function sectionTransform(section: Section, instruction: string | undefined): Transform {
  return {
    id: 'custom',
    label: `Regenerate "${section.title}"`,
    description: 'Rewrite a single section',
    kind: 'ai',
    formats: ['md', 'html'],
    prompt: (ctx: TransformContext) =>
      [
        `Rewrite the body of the section titled "${section.title}".`,
        section.path.length > 0
          ? `It sits under: ${section.path.join(' > ')}.`
          : 'It is a top-level section.',
        instruction ? `Additional instruction: ${instruction}` : '',
        `Do NOT repeat the "${section.title}" heading itself - return only the body beneath it.`,
        'Do not add content that belongs to neighbouring sections.',
        ctx.format === 'html'
          ? 'Return valid HTML using the same element vocabulary as the input.'
          : 'Return Markdown. Subheadings must be deeper than the section heading.',
        'Return ONLY the section body. No preamble, no explanation, no code fences.',
        '',
        'Current body:',
        ctx.selection
      ]
        .filter(Boolean)
        .join('\n')
  };
}

/**
 * Regenerate a single section, leaving the rest of the document untouched.
 *
 * The replacement is spliced at the parser's recorded offsets, so neighbouring
 * sections are preserved byte for byte rather than by careful string matching.
 */
export async function regenerateSection(request: SectionRequest): Promise<SectionResult> {
  const originalBody = sectionBody(request.source, request.section);
  if (!originalBody.trim()) {
    throw new DocForgeError(
      'empty_section',
      `Section "${request.section.title}" has no body to regenerate.`
    );
  }

  const edit = await runTransform({
    transform: sectionTransform(request.section, request.instruction),
    context: {
      selection: originalBody,
      format: request.format,
      ...(request.instruction ? { instruction: request.instruction } : {})
    },
    generators: request.generators,
    ...(request.allowNetwork === undefined ? {} : { allowNetwork: request.allowNetwork }),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onChunk ? { onChunk: request.onChunk } : {}),
    ...(request.now ? { now: request.now } : {})
  });

  return {
    document: replaceSectionIn(request.source, request.section, edit.text, request.format),
    originalBody,
    newBody: edit.text,
    producedBy: edit.producedBy,
    attempts: edit.attempts,
    warnings: edit.warnings
  };
}
