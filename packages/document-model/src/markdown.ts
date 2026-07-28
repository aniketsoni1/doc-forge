import type { DocumentOutline, Section } from './types';

/**
 * A line-oriented Markdown heading scanner.
 *
 * The whole point of this module is that `# ` inside a fenced or indented code
 * block is *not* a heading. A regex over the raw source gets that wrong, and
 * getting it wrong means section regeneration silently corrupts code samples -
 * which is exactly the failure the brief asks us to avoid. So we scan line by
 * line and track fence state.
 */

interface RawHeading {
  level: number;
  title: string;
  /** Offset of the first character of the heading construct. */
  start: number;
  /** Offset just past the heading construct, including its trailing newline. */
  bodyStart: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FRONT_MATTER = /^---[ \t]*$/;

/** Strip inline markup so a heading reads as plain text. */
export function headingText(raw: string): string {
  return raw
    // ATX closing sequence: "## Title ##"
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/_([^_]*)_/g, '$1')
    // [text](url) and ![alt](src)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** GitHub-style anchor slug. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** Make slugs unique the way GitHub does: append -1, -2, … on collision. */
function uniqueSlug(base: string, seen: Map<string, number>): string {
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/**
 * Scan the source for headings, skipping anything inside a code fence, an
 * indented code block, or a YAML front-matter block.
 */
function scanHeadings(source: string): RawHeading[] {
  const headings: RawHeading[] = [];
  const lines = source.split('\n');

  let offset = 0;
  let fence: string | undefined;
  let inFrontMatter = false;

  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineStart = lineOffsets[i] ?? 0;
    // +1 for the newline, except on a final line with no trailing newline.
    const nextStart = Math.min(lineStart + line.length + 1, source.length);

    // Front matter only counts at the very top of the document.
    if (i === 0 && FRONT_MATTER.test(line)) {
      inFrontMatter = true;
      continue;
    }
    if (inFrontMatter) {
      if (FRONT_MATTER.test(line)) inFrontMatter = false;
      continue;
    }

    if (fence !== undefined) {
      // A closing fence must be the same character, and at least as long.
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close?.[1] && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open?.[1]) {
      // An info string may not contain a backtick for a backtick fence.
      if (!(open[1][0] === '`' && open[2]?.includes('`'))) {
        fence = open[1];
        continue;
      }
    }

    // Four-space indent is a code block, not a heading - but only when it does
    // not continue a list item. Treating any 4-space indent as code is the
    // conservative choice: we skip it rather than risk a false heading.
    if (/^ {4,}\S/.test(line)) continue;

    const atx = ATX.exec(line);
    if (atx?.[1]) {
      headings.push({
        level: atx[1].length,
        title: headingText(atx[2] ?? ''),
        start: lineStart,
        bodyStart: nextStart
      });
      continue;
    }

    // Setext: a non-blank line followed by === (h1) or --- (h2). The underline
    // must not itself be a valid ATX heading or a thematic break we already
    // consumed, and the text line must not be blank.
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== '' && SETEXT_UNDERLINE.test(next)) {
      const marker = next.trim()[0];
      // A `---` under a blank-ish line is a thematic break; under text it is h2.
      const level = marker === '=' ? 1 : 2;
      const underlineStart = lineOffsets[i + 1] ?? 0;
      const underlineEnd = Math.min(
        underlineStart + (next.length ?? 0) + 1,
        source.length
      );
      headings.push({
        level,
        title: headingText(line),
        start: lineStart,
        bodyStart: underlineEnd
      });
      i += 1; // consume the underline
      continue;
    }
  }

  return headings;
}

/**
 * Parse Markdown into a section tree with exact character ranges.
 *
 * A section ends where the next heading of equal or lower level begins, so
 * `end` always covers the section's own children and nothing more.
 */
export function parseMarkdownOutline(source: string): DocumentOutline {
  const raw = scanHeadings(source);
  const seen = new Map<string, number>();

  const flat: Section[] = raw.map((h) => ({
    level: h.level,
    title: h.title,
    slug: uniqueSlug(slugify(h.title), seen),
    headingStart: h.start,
    bodyStart: h.bodyStart,
    end: source.length,
    path: [],
    children: []
  }));

  // A section ends at the next heading of equal or lower level.
  for (let i = 0; i < flat.length; i++) {
    const current = flat[i];
    if (!current) continue;
    for (let j = i + 1; j < flat.length; j++) {
      const candidate = flat[j];
      if (candidate && candidate.level <= current.level) {
        current.end = candidate.headingStart;
        break;
      }
    }
  }

  // Build the tree and ancestor paths with an explicit stack.
  const roots: Section[] = [];
  const stack: Section[] = [];
  for (const section of flat) {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= section.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    section.path = parent ? [...parent.path, parent.title] : [];
    if (parent) parent.children.push(section);
    else roots.push(section);
    stack.push(section);
  }

  const firstStart = flat[0]?.headingStart ?? source.length;
  return {
    sections: roots,
    flat,
    preamble: { start: 0, end: firstStart, text: source.slice(0, firstStart) },
    source
  };
}

/**
 * Replace one section's body, leaving every other byte of the document exactly
 * as it was.
 *
 * `keepHeading` (the default) rewrites only the body beneath the heading, which
 * is what "regenerate this section" means to a user - the heading is their
 * anchor and should survive.
 */
export function replaceSection(
  source: string,
  section: Section,
  replacement: string,
  options: { keepHeading?: boolean } = {}
): string {
  const keepHeading = options.keepHeading ?? true;
  const start = keepHeading ? section.bodyStart : section.headingStart;
  const before = source.slice(0, start);
  const after = source.slice(section.end);

  // Normalise the seam so the splice cannot weld two blocks together or leave a
  // runaway gap, without touching anything outside the replaced range.
  let body = replacement.replace(/\s+$/, '');
  if (keepHeading && !body.startsWith('\n')) body = `\n${body.replace(/^\n+/, '')}`;
  const trailing = after.length > 0 ? '\n\n' : '\n';

  return `${before}${body}${trailing}${after.replace(/^\n+/, '')}`;
}
