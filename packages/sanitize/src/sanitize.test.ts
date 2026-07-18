import { describe, expect, it } from 'vitest';
import { sanitizeDocumentHtml } from './html';
import { normalizeMarkdown, lintMarkdown, isMarkdownClean } from './markdown';

describe('sanitizeDocumentHtml', () => {
  it('strips <script> tags', () => {
    const { html, modified } = sanitizeDocumentHtml('<p>ok</p><script>alert(1)</script>');
    expect(html).toBe('<p>ok</p>');
    expect(modified).toBe(true);
  });

  it('strips inline event handlers', () => {
    const { html } = sanitizeDocumentHtml('<p onclick="steal()">hi</p>');
    expect(html).not.toContain('onclick');
    expect(html).toContain('hi');
  });

  it('drops javascript: hrefs but keeps safe ones', () => {
    expect(sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>').html).not.toContain('javascript:');
    expect(sanitizeDocumentHtml('<a href="https://x.dev">x</a>').html).toContain('href="https://x.dev"');
  });

  it('adds rel=noopener to target=_blank links', () => {
    const { html } = sanitizeDocumentHtml('<a href="https://x.dev" target="_blank">x</a>');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('reports no modification for already-clean fragments', () => {
    expect(sanitizeDocumentHtml('<p>clean</p>').modified).toBe(false);
  });

  it('removes data: image sources', () => {
    const { html } = sanitizeDocumentHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="x" />');
    expect(html).not.toContain('data:');
  });
});

describe('normalizeMarkdown', () => {
  it('trims trailing whitespace and collapses blank runs', () => {
    expect(normalizeMarkdown('# Hi   \n\n\n\nbody')).toBe('# Hi\n\nbody\n');
  });

  it('adds a space after heading hashes', () => {
    expect(normalizeMarkdown('##Heading')).toBe('## Heading\n');
  });
});

describe('lintMarkdown', () => {
  it('flags a missing H1', () => {
    expect(lintMarkdown('no heading').some((i) => i.rule === 'require-h1')).toBe(true);
  });

  it('flags multiple H1s', () => {
    expect(lintMarkdown('# a\n# b').some((i) => i.rule === 'single-h1')).toBe(true);
  });

  it('passes a well-formed doc', () => {
    expect(isMarkdownClean('# Title\n\nSome body text.\n')).toBe(true);
  });
});
