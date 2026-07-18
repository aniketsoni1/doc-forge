import sanitizeHtml from 'sanitize-html';

/** Allowlisted tags for generated document bodies. No script/iframe/form/embed. */
export const ALLOWED_TAGS: readonly string[] = [
  'a', 'abbr', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd',
  'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol',
  'p', 'pre', 's', 'section', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
];

export interface SanitizeResult {
  /** The sanitized HTML fragment. */
  html: string;
  /** True when sanitization changed the input (something was stripped/altered). */
  modified: boolean;
}

const BASE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {
    a: ['href', 'title', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    code: ['class'],
    pre: ['class'],
    span: ['class'],
    div: ['class'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    ol: ['start'],
    '*': ['id']
  },
  // Links may only point somewhere safe; javascript:/data: are dropped.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Force safe rel on links that open a new tab.
  transformTags: {
    a: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs };
      if (out.target === '_blank') {
        out.rel = 'noopener noreferrer';
      }
      return { tagName, attribs: out };
    }
  },
  disallowedTagsMode: 'discard'
};

/**
 * Sanitize an untrusted HTML fragment against the DocForge allowlist. All model
 * output is treated as untrusted before it is written or shown in a webview.
 */
export function sanitizeDocumentHtml(dirty: string): SanitizeResult {
  const html = sanitizeHtml(dirty, BASE_OPTIONS);
  // Compare on a whitespace-normalized basis so trivial formatting differences
  // from the parser are not reported as "modified".
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return { html, modified: norm(html) !== norm(dirty) };
}
