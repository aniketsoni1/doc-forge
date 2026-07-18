import type { DocFormat } from '@dfg/core';
import { renderHtmlDocument } from './scaffold';

/** A renderable preview of a generated document. */
export interface PreviewModel {
  title: string;
  format: DocFormat;
  /** Sanitized HTML fragment. */
  bodyHtml: string;
  /** Full themed standalone document wrapping {@link bodyHtml}. */
  documentHtml: string;
}

export interface BuildPreviewInput {
  title: string;
  format: DocFormat;
  /** A fragment that has already been sanitized by the caller. */
  safeBodyHtml: string;
}

/**
 * Assemble a {@link PreviewModel} from an already-sanitized fragment. Pure: this
 * package never sanitizes (that is `@dfg/sanitize`'s job) nor performs I/O.
 */
export function buildPreviewModel(input: BuildPreviewInput): PreviewModel {
  return {
    title: input.title,
    format: input.format,
    bodyHtml: input.safeBodyHtml,
    documentHtml: renderHtmlDocument({ title: input.title, bodyHtml: input.safeBodyHtml })
  };
}
