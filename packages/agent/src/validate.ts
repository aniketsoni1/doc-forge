import type { DocResult } from '@dfg/core';
import { lintMarkdown, normalizeMarkdown, sanitizeDocumentHtml } from '@dfg/sanitize';
import { escapeHtml, renderMarkdown } from '@dfg/render';

/** Validate a raw generator result. Returns human-readable issues; empty = valid. */
export function validateResult(result: DocResult): string[] {
  if (result.format === 'md') {
    return lintMarkdown(result.content).map((i) => `${i.rule}: ${i.message}`);
  }
  const { html } = sanitizeDocumentHtml(result.content);
  const issues: string[] = [];
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    issues.push('html-empty: no safe HTML elements remain after sanitization');
  }
  return issues;
}

/** Keep the first ATX H1 and demote any subsequent ones to H2. */
function demoteExtraH1(markdown: string): string {
  let seen = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^#\s/.test(line)) {
        if (seen) return line.replace(/^#\s/, '## ');
        seen = true;
      }
      return line;
    })
    .join('\n');
}

/**
 * One bounded, deterministic repair pass applied before falling through to the
 * next generator. Never calls the network; just normalizes/sanitizes structure.
 */
export function repairResult(result: DocResult): DocResult {
  if (result.format === 'md') {
    let md = normalizeMarkdown(result.content);
    if (!/^#\s/m.test(md)) md = `# Document\n\n${md}`;
    md = demoteExtraH1(md);
    return { ...result, content: normalizeMarkdown(md), meta: { ...result.meta, repaired: true } };
  }
  const { html } = sanitizeDocumentHtml(result.content);
  const safe = /<[a-z][\s\S]*>/i.test(html)
    ? html
    : `<p>${escapeHtml(result.content).trim() || 'Document'}</p>`;
  // Fall back to rendering the raw text as Markdown if sanitization emptied it.
  const body = /<[a-z][\s\S]*>/i.test(safe) ? safe : sanitizeDocumentHtml(renderMarkdown(result.content)).html;
  return { ...result, content: body, meta: { ...result.meta, repaired: true } };
}
