import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { parseFrontMatter, serializeFrontMatter } from './frontmatter';
import { renderHtmlDocument, escapeHtml } from './scaffold';
import { buildPreviewModel } from './preview';

describe('renderMarkdown', () => {
  it('renders headings and lists deterministically', () => {
    const html = renderMarkdown('# Title\n\n- a\n- b\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>a</li>');
    expect(renderMarkdown('# Title\n\n- a\n- b\n')).toBe(html);
  });

  it('linkifies bare URLs', () => {
    expect(renderMarkdown('see https://example.com')).toContain('href="https://example.com"');
  });
});

describe('front-matter', () => {
  it('round-trips flat scalars', () => {
    const src = '---\ntitle: Hello\nauthor: Aniket\n---\n\nBody text\n';
    const fm = parseFrontMatter(src);
    expect(fm.data).toEqual({ title: 'Hello', author: 'Aniket' });
    expect(fm.body).toBe('Body text\n');
    const round = serializeFrontMatter(fm.data, fm.body);
    expect(parseFrontMatter(round).data).toEqual(fm.data);
  });

  it('returns the input unchanged when no front-matter present', () => {
    expect(parseFrontMatter('no matter here').data).toEqual({});
  });

  it('quotes values containing colons', () => {
    const out = serializeFrontMatter({ url: 'https://x.dev' }, 'body');
    expect(out).toContain('url: "https://x.dev"');
  });
});

describe('scaffold', () => {
  it('escapes the title', () => {
    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
  });

  it('produces a complete themed document', () => {
    const doc = renderHtmlDocument({ title: 'Report', bodyHtml: '<p>hi</p>' });
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<title>Report</title>');
    expect(doc).toContain('prefers-color-scheme');
    expect(doc).toContain('@media print');
    expect(doc).toContain('<p>hi</p>');
  });
});

describe('buildPreviewModel', () => {
  it('wraps a sanitized fragment', () => {
    const model = buildPreviewModel({ title: 'T', format: 'md', safeBodyHtml: '<p>ok</p>' });
    expect(model.bodyHtml).toBe('<p>ok</p>');
    expect(model.documentHtml).toContain('<p>ok</p>');
    expect(model.format).toBe('md');
  });
});
