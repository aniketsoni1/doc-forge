/**
 * A structural view of a document: headings as addressable ranges rather than
 * strings to search for.
 *
 * Every offset is a character index into the *original* source, so a section can
 * be replaced by splicing without re-serialising - and therefore without
 * disturbing a single byte outside the target range. That property is what makes
 * section regeneration safe, and it is asserted directly in the tests.
 */

/** A heading and everything beneath it, up to the next heading of equal or lower level. */
export interface Section {
  /** Heading level, 1-6. */
  level: number;
  /** Heading text with markup stripped. */
  title: string;
  /** URL-safe anchor derived from the title; unique within the document. */
  slug: string;
  /** Offset of the first character of the heading. */
  headingStart: number;
  /** Offset just past the heading line, where the body begins. */
  bodyStart: number;
  /** Offset just past the last character of this section, children included. */
  end: number;
  /** Titles of this section's ancestors, outermost first. */
  path: string[];
  /** Directly nested subsections. */
  children: Section[];
}

/** The parsed structure of a whole document. */
export interface DocumentOutline {
  /** Top-level sections, in document order. */
  sections: Section[];
  /** Every section, flattened in document order - convenient for pickers. */
  flat: Section[];
  /** Content before the first heading (front matter, lead paragraph). */
  preamble: { start: number; end: number; text: string };
  /** The source this outline describes. */
  source: string;
}

/** Body text of a section, excluding its own heading line. */
export function sectionBody(source: string, section: Section): string {
  return source.slice(section.bodyStart, section.end);
}

/** The full text of a section, heading line included. */
export function sectionText(source: string, section: Section): string {
  return source.slice(section.headingStart, section.end);
}

/** Find a section by slug. */
export function findBySlug(outline: DocumentOutline, slug: string): Section | undefined {
  return outline.flat.find((s) => s.slug === slug);
}

/**
 * The innermost section containing `offset`, or undefined when the offset falls
 * in the preamble. Used to answer "which section is my cursor in?".
 */
export function sectionAt(outline: DocumentOutline, offset: number): Section | undefined {
  let match: Section | undefined;
  for (const section of outline.flat) {
    if (offset >= section.headingStart && offset < section.end) {
      // `flat` is in document order, so a later match is always more deeply nested.
      if (!match || section.level > match.level) match = section;
    }
  }
  return match;
}
