import { Parser } from 'htmlparser2';
import type { DocumentOutline, Section } from './types';
import { slugify } from './markdown';

/**
 * HTML outline extraction using a real tokenizer.
 *
 * The brief is explicit that HTML must not be sectioned by regular expression
 * alone, and for good reason: `<h2>` inside a comment, a `<pre>` block, or an
 * attribute value all defeat a pattern match, and a wrong offset here means
 * corrupting the document on replace. htmlparser2 is already in the dependency
 * tree via sanitize-html, so this costs nothing at install or bundle time.
 */

const HEADING = /^h([1-6])$/i;

interface RawHeading {
  level: number;
  title: string;
  start: number;
  bodyStart: number;
}

/**
 * Scan HTML for heading elements, recording exact source offsets.
 *
 * Text inside `<script>`, `<style>`, comments and CDATA is ignored by the
 * tokenizer, so those cannot produce phantom headings.
 */
function scanHeadings(html: string): RawHeading[] {
  const headings: RawHeading[] = [];

  let current: { level: number; start: number; text: string[] } | undefined;
  let depth = 0;

  const parser = new Parser(
    {
      onopentag(name) {
        const match = HEADING.exec(name);
        if (match?.[1] && !current) {
          current = {
            level: Number(match[1]),
            // startIndex points at '<' of the opening tag.
            start: parser.startIndex,
            text: []
          };
          depth = 0;
          return;
        }
        if (current) depth += 1;
      },
      ontext(text) {
        if (current) current.text.push(text);
      },
      onclosetag(name) {
        if (!current) return;
        const match = HEADING.exec(name);
        if (match?.[1] && depth === 0) {
          headings.push({
            level: current.level,
            title: current.text.join('').replace(/\s+/g, ' ').trim(),
            start: current.start,
            // endIndex points at '>' of the closing tag.
            bodyStart: parser.endIndex + 1
          });
          current = undefined;
          return;
        }
        if (depth > 0) depth -= 1;
      }
    },
    { decodeEntities: true, recognizeSelfClosing: true }
  );

  parser.write(html);
  parser.end();

  return headings;
}

/** Parse an HTML document or fragment into a section tree with source ranges. */
export function parseHtmlOutline(source: string): DocumentOutline {
  const raw = scanHeadings(source);
  const seen = new Map<string, number>();

  const flat: Section[] = raw.map((h) => {
    const base = slugify(h.title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return {
      level: h.level,
      title: h.title,
      slug: count === 0 ? base : `${base}-${count}`,
      headingStart: h.start,
      bodyStart: h.bodyStart,
      end: source.length,
      path: [],
      children: []
    };
  });

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
 * Replace an HTML section's body by splicing at recorded offsets. The caller is
 * responsible for having sanitized `replacement` - this module does no
 * sanitisation, so that responsibility stays in exactly one place.
 */
export function replaceHtmlSection(
  source: string,
  section: Section,
  replacement: string,
  options: { keepHeading?: boolean } = {}
): string {
  const start = (options.keepHeading ?? true) ? section.bodyStart : section.headingStart;
  return `${source.slice(0, start)}\n${replacement.trim()}\n${source.slice(section.end)}`;
}
