import { describe, expect, it } from 'vitest';
import {
  findBySlug,
  parseHtmlOutline,
  parseMarkdownOutline,
  parseOutline,
  replaceHtmlSection,
  replaceSection,
  replaceSectionIn,
  sectionAt,
  sectionBody,
  sectionText,
  slugify,
  headingText
} from './index';

const doc = `# Title

Intro paragraph.

## Alpha

Alpha body.

### Alpha One

Nested body.

## Beta

Beta body.
`;

describe('parseMarkdownOutline', () => {
  it('finds every heading in document order', () => {
    const outline = parseMarkdownOutline(doc);
    expect(outline.flat.map((s) => s.title)).toEqual([
      'Title',
      'Alpha',
      'Alpha One',
      'Beta'
    ]);
    expect(outline.flat.map((s) => s.level)).toEqual([1, 2, 3, 2]);
  });

  it('nests sections and records ancestor paths', () => {
    const outline = parseMarkdownOutline(doc);
    expect(outline.sections).toHaveLength(1);
    const title = outline.sections[0];
    expect(title?.children.map((c) => c.title)).toEqual(['Alpha', 'Beta']);
    expect(title?.children[0]?.children.map((c) => c.title)).toEqual(['Alpha One']);
    expect(findBySlug(outline, 'alpha-one')?.path).toEqual(['Title', 'Alpha']);
  });

  it('ends a section at the next heading of equal or lower level', () => {
    const outline = parseMarkdownOutline(doc);
    const alpha = findBySlug(outline, 'alpha');
    const beta = findBySlug(outline, 'beta');
    // Alpha owns its nested child, and stops exactly where Beta starts.
    expect(alpha?.end).toBe(beta?.headingStart);
    expect(sectionText(doc, alpha!)).toContain('Alpha One');
    expect(sectionText(doc, alpha!)).not.toContain('Beta body');
  });

  it('captures the body without the heading line', () => {
    const outline = parseMarkdownOutline(doc);
    const body = sectionBody(doc, findBySlug(outline, 'beta')!);
    expect(body.trim()).toBe('Beta body.');
  });

  it('records the preamble before the first heading', () => {
    const outline = parseMarkdownOutline('lead in\n\n# One\n\nbody\n');
    expect(outline.preamble.text).toBe('lead in\n\n');
    expect(outline.sections[0]?.title).toBe('One');
  });

  it('handles a document with no headings at all', () => {
    const outline = parseMarkdownOutline('just prose\n');
    expect(outline.flat).toEqual([]);
    expect(outline.preamble.text).toBe('just prose\n');
  });

  it('handles an empty document', () => {
    const outline = parseMarkdownOutline('');
    expect(outline.flat).toEqual([]);
    expect(outline.preamble.text).toBe('');
  });
});

describe('parseMarkdownOutline: constructs that defeat a naive regex', () => {
  it('ignores # inside a fenced code block', () => {
    const src = [
      '# Real',
      '',
      '```bash',
      '# not a heading',
      '## also not',
      '```',
      '',
      '## Also Real',
      ''
    ].join('\n');
    expect(parseMarkdownOutline(src).flat.map((s) => s.title)).toEqual(['Real', 'Also Real']);
  });

  it('ignores # inside a tilde fence', () => {
    const src = '# Real\n\n~~~\n# nope\n~~~\n\n## Second\n';
    expect(parseMarkdownOutline(src).flat.map((s) => s.title)).toEqual(['Real', 'Second']);
  });

  it('requires the closing fence to match the opener', () => {
    // The ``` inside a ~~~ block does not close it, so the # stays hidden.
    const src = '# Real\n\n~~~\n```\n# hidden\n~~~\n\n## Second\n';
    expect(parseMarkdownOutline(src).flat.map((s) => s.title)).toEqual(['Real', 'Second']);
  });

  it('handles a longer closing fence', () => {
    const src = '# Real\n\n````\n# hidden\n````\n\n## Second\n';
    expect(parseMarkdownOutline(src).flat.map((s) => s.title)).toEqual(['Real', 'Second']);
  });

  it('ignores # inside an indented code block', () => {
    const src = '# Real\n\n    # indented, not a heading\n\n## Second\n';
    expect(parseMarkdownOutline(src).flat.map((s) => s.title)).toEqual(['Real', 'Second']);
  });

  it('skips YAML front matter', () => {
    const src = '---\ntitle: Something\n---\n\n# Real\n\nbody\n';
    const outline = parseMarkdownOutline(src);
    expect(outline.flat.map((s) => s.title)).toEqual(['Real']);
    expect(outline.preamble.text).toContain('title: Something');
  });

  it('does not treat a --- inside front matter as a setext underline', () => {
    const src = '---\na: 1\n---\n\n# Only\n';
    expect(parseMarkdownOutline(src).flat).toHaveLength(1);
  });

  it('recognises setext headings', () => {
    const src = 'Title Here\n==========\n\nbody\n\nSub Heading\n-----------\n\nmore\n';
    const outline = parseMarkdownOutline(src);
    expect(outline.flat.map((s) => [s.title, s.level])).toEqual([
      ['Title Here', 1],
      ['Sub Heading', 2]
    ]);
  });

  it('gives a setext section a body that excludes its underline', () => {
    const src = 'Title\n=====\n\nbody text\n';
    const outline = parseMarkdownOutline(src);
    expect(sectionBody(src, outline.flat[0]!).trim()).toBe('body text');
  });

  it('strips the ATX closing sequence from the title', () => {
    expect(parseMarkdownOutline('## Closed ##\n').flat[0]?.title).toBe('Closed');
  });

  it('requires a space after the hashes', () => {
    expect(parseMarkdownOutline('#NotAHeading\n').flat).toHaveLength(0);
  });

  it('allows up to three leading spaces', () => {
    expect(parseMarkdownOutline('   # Indented\n').flat[0]?.title).toBe('Indented');
  });

  it('treats a bare # as an empty heading rather than crashing', () => {
    const outline = parseMarkdownOutline('#\n\nbody\n');
    expect(outline.flat[0]?.title).toBe('');
    expect(outline.flat[0]?.slug).toBe('section');
  });
});

describe('heading text and slugs', () => {
  it('strips inline markup', () => {
    expect(headingText('`code` and **bold** and _em_')).toBe('code and bold and em');
    expect(headingText('[Link](https://example.com)')).toBe('Link');
  });

  it('slugifies like an anchor', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out');
  });

  it('keeps unicode letters', () => {
    expect(slugify('Café Niño')).toBe('café-niño');
  });

  it('falls back for a title with no slug-able characters', () => {
    expect(slugify('!!!')).toBe('section');
  });

  it('disambiguates duplicate headings', () => {
    const outline = parseMarkdownOutline('## Same\n\na\n\n## Same\n\nb\n');
    expect(outline.flat.map((s) => s.slug)).toEqual(['same', 'same-1']);
  });
});

describe('sectionAt', () => {
  const outline = parseMarkdownOutline(doc);

  it('returns the innermost containing section', () => {
    const nested = findBySlug(outline, 'alpha-one')!;
    expect(sectionAt(outline, nested.bodyStart + 2)?.slug).toBe('alpha-one');
  });

  it('returns the enclosing section for a position in its own body', () => {
    const beta = findBySlug(outline, 'beta')!;
    expect(sectionAt(outline, beta.bodyStart + 2)?.slug).toBe('beta');
  });

  it('returns undefined inside the preamble', () => {
    const withPreamble = parseMarkdownOutline('lead\n\n# One\n');
    expect(sectionAt(withPreamble, 1)).toBeUndefined();
  });
});

describe('replaceSection', () => {
  it('replaces only the target body and leaves neighbours byte-identical', () => {
    const outline = parseMarkdownOutline(doc);
    const alpha = findBySlug(outline, 'alpha')!;
    const out = replaceSection(doc, alpha, 'Replaced content.');

    expect(out).toContain('Replaced content.');
    // Everything before and after the section survives exactly.
    expect(out.startsWith('# Title\n\nIntro paragraph.\n')).toBe(true);
    expect(out).toContain('## Beta\n\nBeta body.');
    expect(out).not.toContain('Alpha body.');
    expect(out).not.toContain('Nested body.');
  });

  it('keeps the heading by default', () => {
    const outline = parseMarkdownOutline(doc);
    const out = replaceSection(doc, findBySlug(outline, 'beta')!, 'New beta.');
    expect(out).toContain('## Beta');
    expect(out).toContain('New beta.');
  });

  it('can replace the heading too', () => {
    const outline = parseMarkdownOutline(doc);
    const out = replaceSection(doc, findBySlug(outline, 'beta')!, '## Renamed\n\nBody.', {
      keepHeading: false
    });
    expect(out).toContain('## Renamed');
    expect(out).not.toContain('## Beta');
  });

  it('round-trips: replacing a section with its own body is a no-op in content', () => {
    const outline = parseMarkdownOutline(doc);
    const beta = findBySlug(outline, 'beta')!;
    const out = replaceSection(doc, beta, sectionBody(doc, beta));
    expect(parseMarkdownOutline(out).flat.map((s) => s.title)).toEqual(
      outline.flat.map((s) => s.title)
    );
    expect(out).toContain('Beta body.');
  });

  it('preserves a code fence living in a sibling section', () => {
    const src = '# T\n\n## Code\n\n```js\nconst x = 1;\n```\n\n## Prose\n\nold\n';
    const outline = parseMarkdownOutline(src);
    const out = replaceSection(src, findBySlug(outline, 'prose')!, 'new');
    expect(out).toContain('```js\nconst x = 1;\n```');
    expect(out).toContain('new');
    expect(out).not.toContain('old');
  });

  it('replaces the last section without leaving a dangling separator', () => {
    const outline = parseMarkdownOutline(doc);
    const out = replaceSection(doc, findBySlug(outline, 'beta')!, 'Final.');
    expect(out.endsWith('Final.\n')).toBe(true);
  });

  it('never alters a byte outside the replaced range', () => {
    // The safety property the whole design rests on, asserted directly for
    // every section in a document that contains the awkward constructs.
    const src = [
      '---',
      'title: Front',
      '---',
      '',
      'Preamble text.',
      '',
      '# Title',
      '',
      '## Code',
      '',
      '```js',
      '# not a heading',
      '```',
      '',
      'Setext Sub',
      '----------',
      '',
      'tail',
      '',
      '## Last',
      '',
      'end',
      ''
    ].join('\n');

    const outline = parseMarkdownOutline(src);
    expect(outline.flat.length).toBeGreaterThan(3);

    for (const section of outline.flat) {
      const out = replaceSection(src, section, 'REPLACED');
      const prefix = src.slice(0, section.bodyStart);
      const suffix = src.slice(section.end);

      expect(out.startsWith(prefix)).toBe(true);
      // The tail survives modulo the leading blank lines the seam normalises.
      expect(out.endsWith(suffix.replace(/^\n+/, ''))).toBe(true);
      expect(out).toContain('REPLACED');
    }
  });

  it('leaves the document parseable after replacement', () => {
    const outline = parseMarkdownOutline(doc);
    const out = replaceSection(doc, findBySlug(outline, 'alpha')!, '### Fresh\n\nbody');
    const reparsed = parseMarkdownOutline(out);
    expect(reparsed.flat.map((s) => s.title)).toEqual(['Title', 'Alpha', 'Fresh', 'Beta']);
  });
});

describe('parseHtmlOutline', () => {
  const html = `<h1>Title</h1>
<p>Intro.</p>
<h2>Alpha</h2>
<p>Alpha body.</p>
<h2>Beta</h2>
<p>Beta body.</p>`;

  it('finds headings with a real tokenizer', () => {
    const outline = parseHtmlOutline(html);
    expect(outline.flat.map((s) => s.title)).toEqual(['Title', 'Alpha', 'Beta']);
    expect(outline.flat.map((s) => s.level)).toEqual([1, 2, 2]);
  });

  it('extracts text through nested inline markup', () => {
    const outline = parseHtmlOutline('<h2>A <em>nested</em> <code>title</code></h2>');
    expect(outline.flat[0]?.title).toBe('A nested title');
  });

  it('ignores headings inside comments', () => {
    const outline = parseHtmlOutline('<!-- <h1>Ghost</h1> --><h2>Real</h2>');
    expect(outline.flat.map((s) => s.title)).toEqual(['Real']);
  });

  it('ignores heading-like text inside script and style', () => {
    const outline = parseHtmlOutline(
      '<script>var s = "<h1>x</h1>";</script><style>/* <h1>y</h1> */</style><h2>Real</h2>'
    );
    expect(outline.flat.map((s) => s.title)).toEqual(['Real']);
  });

  it('ignores heading-like text in an attribute value', () => {
    const outline = parseHtmlOutline('<div title="<h1>fake</h1>"></div><h2>Real</h2>');
    expect(outline.flat.map((s) => s.title)).toEqual(['Real']);
  });

  it('decodes entities in heading text', () => {
    expect(parseHtmlOutline('<h1>A &amp; B</h1>').flat[0]?.title).toBe('A & B');
  });

  it('sections stop at the next heading of equal or lower level', () => {
    const outline = parseHtmlOutline(html);
    const alpha = outline.flat[1];
    const beta = outline.flat[2];
    expect(alpha?.end).toBe(beta?.headingStart);
  });

  it('handles html with no headings', () => {
    expect(parseHtmlOutline('<p>nothing</p>').flat).toEqual([]);
  });

  it('replaces a section body without disturbing siblings', () => {
    const outline = parseHtmlOutline(html);
    const out = replaceHtmlSection(html, outline.flat[1]!, '<p>Replaced.</p>');
    expect(out).toContain('<p>Replaced.</p>');
    expect(out).toContain('<h2>Beta</h2>');
    expect(out).toContain('<p>Beta body.</p>');
    expect(out).not.toContain('Alpha body.');
    expect(out).toContain('<h2>Alpha</h2>');
  });
});

describe('format-agnostic helpers', () => {
  it('parseOutline dispatches on format', () => {
    expect(parseOutline('# Md\n', 'md').flat[0]?.title).toBe('Md');
    expect(parseOutline('<h1>Html</h1>', 'html').flat[0]?.title).toBe('Html');
  });

  it('replaceSectionIn dispatches on format', () => {
    const md = '# A\n\nold\n';
    const mdOut = replaceSectionIn(md, parseOutline(md, 'md').flat[0]!, 'new', 'md');
    expect(mdOut).toContain('new');

    const html = '<h1>A</h1><p>old</p>';
    const htmlOut = replaceSectionIn(
      html,
      parseOutline(html, 'html').flat[0]!,
      '<p>new</p>',
      'html'
    );
    expect(htmlOut).toContain('<p>new</p>');
    expect(htmlOut).not.toContain('<p>old</p>');
  });
});
