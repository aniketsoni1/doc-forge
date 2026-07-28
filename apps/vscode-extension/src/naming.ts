import type { DocFormat } from '@dfg/core';

/** File extension for a document format. */
export function extensionFor(format: DocFormat): string {
  return format === 'html' ? 'html' : 'md';
}

/**
 * Derive a safe default filename from a document title.
 *
 * Pure and `vscode`-free so the slug rules - which decide what path the save
 * dialog proposes - can be unit-tested directly. Path separators and traversal
 * sequences collapse into the separator character, so a title can never steer
 * the default outside the chosen folder.
 */
export function defaultFileName(title: string, format: DocFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'document'}.${extensionFor(format)}`;
}

/** The VS Code language id matching a document format. */
export function languageFor(format: DocFormat): string {
  return format === 'html' ? 'html' : 'markdown';
}

/** Save-dialog filters for a format. */
export function filtersFor(format: DocFormat): Record<string, string[]> {
  return format === 'html' ? { HTML: ['html'] } : { Markdown: ['md'] };
}

/**
 * Map a VS Code language id onto a DocForge format.
 *
 * Anything that is not HTML is treated as Markdown: plain text and MDX are
 * close enough that Markdown-aware handling helps rather than harms, and it
 * keeps the fallback predictable.
 */
export function formatForLanguage(languageId: string): DocFormat {
  return languageId === 'html' ? 'html' : 'md';
}

/** Languages where selection editing and section regeneration are offered. */
export const EDITABLE_LANGUAGES: readonly string[] = [
  'markdown',
  'html',
  'plaintext',
  'quarto',
  'mdx'
];
