import type { DocResult, DocSpec } from '@dfg/core';
import { buildPreviewModel, renderMarkdown, type PreviewModel } from '@dfg/render';
import { sanitizeDocumentHtml } from '@dfg/sanitize';

export interface FinalDocument {
  title: string;
  /** The exact string to write to disk: Markdown source, or a full HTML document. */
  deliverable: string;
  /** Renderable preview for a webview. */
  preview: PreviewModel;
  /** Notes surfaced during finalization (e.g. sanitization removed content). */
  warnings: string[];
}

function firstMarkdownH1(markdown: string): string | undefined {
  const m = /^#\s+(.*)$/m.exec(markdown);
  return m?.[1]?.trim();
}

function firstHtmlHeading(html: string): string | undefined {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m?.[1]) return undefined;
  return m[1].replace(/<[^>]+>/g, '').trim() || undefined;
}

export function resolveTitle(spec: DocSpec, result: DocResult): string {
  if (spec.title) return spec.title;
  const fromContent =
    result.format === 'md' ? firstMarkdownH1(result.content) : firstHtmlHeading(result.content);
  return fromContent ?? 'Document';
}

/**
 * Turn a raw generator result into a writable deliverable plus a preview,
 * sanitizing all HTML centrally (model output is untrusted).
 */
export function finalizeDocument(spec: DocSpec, result: DocResult): FinalDocument {
  const title = resolveTitle(spec, result);
  const warnings: string[] = [];

  if (result.format === 'md') {
    const { html } = sanitizeDocumentHtml(renderMarkdown(result.content));
    const preview = buildPreviewModel({ title, format: 'md', safeBodyHtml: html });
    return { title, deliverable: result.content, preview, warnings };
  }

  const { html, modified } = sanitizeDocumentHtml(result.content);
  if (modified) warnings.push('Some unsafe HTML was removed during sanitization.');
  const preview = buildPreviewModel({ title, format: 'html', safeBodyHtml: html });
  return { title, deliverable: preview.documentHtml, preview, warnings };
}
