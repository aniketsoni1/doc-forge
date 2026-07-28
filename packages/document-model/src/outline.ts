import type { DocFormat } from '@dfg/core';
import type { DocumentOutline, Section } from './types';
import { parseMarkdownOutline, replaceSection } from './markdown';
import { parseHtmlOutline, replaceHtmlSection } from './html';

/** Parse a document of either supported format into an outline. */
export function parseOutline(source: string, format: DocFormat): DocumentOutline {
  return format === 'html' ? parseHtmlOutline(source) : parseMarkdownOutline(source);
}

/** Replace a section in a document of either supported format. */
export function replaceSectionIn(
  source: string,
  section: Section,
  replacement: string,
  format: DocFormat,
  options: { keepHeading?: boolean } = {}
): string {
  return format === 'html'
    ? replaceHtmlSection(source, section, replacement, options)
    : replaceSection(source, section, replacement, options);
}
