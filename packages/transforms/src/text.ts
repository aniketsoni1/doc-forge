/**
 * Deterministic text manipulation.
 *
 * These are the transforms DocForge can honestly do without a model: they are
 * structural rather than semantic. Nothing here pretends to understand the
 * text - `bulletsToProse` rearranges punctuation, it does not rewrite meaning.
 * Keeping that line sharp is what lets the UI promise "works offline" for some
 * operations without overselling the rest.
 */

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Split text into blank-line-separated blocks, preserving order. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split a paragraph into sentences.
 *
 * Abbreviation-aware enough to avoid the obvious embarrassments (e.g. "e.g.",
 * "Dr.", "vs."), which is the difference between a useful bullet list and a
 * shredded one.
 */
export function sentences(text: string): string[] {
  const ABBREVIATIONS = new Set([
    'e.g', 'i.e', 'etc', 'vs', 'cf', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
    'st', 'no', 'fig', 'al', 'inc', 'ltd', 'co', 'approx'
  ]);

  const out: string[] = [];
  let current = '';

  const parts = text.replace(/\s+/g, ' ').trim().split(/([.!?]+\s+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? '';
    const terminator = parts[i + 1] ?? '';
    current += body + terminator;

    const lastWord = body.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z.]/g, '') ?? '';
    const isAbbrev = ABBREVIATIONS.has(lastWord.replace(/\.$/, ''));
    // A single capital letter before a dot is probably an initial.
    const isInitial = /\b[A-Z]$/.test(body);

    if (terminator && !isAbbrev && !isInitial) {
      out.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/** True when every non-empty line looks like a list item. */
export function isBulletList(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines.length > 0 && lines.every((l) => BULLET.test(l));
}

/** Extract the item text from a bullet or numbered list. */
export function bulletItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => BULLET.exec(line)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

function ensureTerminated(text: string): string {
  const trimmed = text.trim().replace(/[;,]$/, '');
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function lowerFirst(text: string): string {
  // Leave acronyms and proper-noun-looking words alone.
  if (/^[A-Z]{2,}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Turn prose into a bullet list, one bullet per sentence. */
export function proseToBullets(text: string): string {
  if (isBulletList(text)) return text.trim();
  const items = paragraphs(text).flatMap((p) => sentences(p));
  if (items.length === 0) return text.trim();
  return items.map((s) => `- ${s.replace(/\s+/g, ' ').trim()}`).join('\n');
}

/**
 * Turn a bullet list back into a paragraph.
 *
 * Joins items into flowing sentences with a light connective before the last
 * item, which reads better than a run of full stops.
 */
export function bulletsToProse(text: string): string {
  const items = bulletItems(text);
  if (items.length === 0) return text.trim();
  // A bullet is a fragment; promoted to a sentence it needs a capital.
  if (items.length === 1) return upperFirst(ensureTerminated(items[0] ?? ''));

  const body = items.slice(0, -1).map((i) => upperFirst(ensureTerminated(i)));
  const last = items[items.length - 1] ?? '';
  const lastSentence = `Finally, ${lowerFirst(ensureTerminated(last))}`;
  return [...body, lastSentence].join(' ');
}

/**
 * Insert headings above paragraph groups, deriving each from the first few
 * meaningful words of the block it introduces.
 */
export function addHeadings(text: string, level = 2): string {
  const blocks = paragraphs(text);
  if (blocks.length === 0) return text.trim();
  const hashes = '#'.repeat(Math.min(6, Math.max(1, level)));

  const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'with',
    'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been',
    'it', 'its', 'as', 'by', 'at', 'from', 'we', 'you', 'they'
  ]);

  const isHeading = (block: string): boolean => /^#{1,6}\s/.test(block);

  return blocks
    .map((block, index) => {
      // Skip a heading itself, a list, and - crucially - the block right after a
      // heading: that text already has one, and adding another would orphan it.
      if (isHeading(block) || BULLET.test(block.split('\n')[0] ?? '')) return block;
      if (index > 0 && isHeading(blocks[index - 1] ?? '')) return block;
      const words = (sentences(block)[0] ?? block)
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()))
        .slice(0, 5);
      const title = words.length > 0 ? words.map(upperFirst).join(' ') : 'Section';
      return `${hashes} ${title}\n\n${block}`;
    })
    .join('\n\n');
}

/**
 * An extractive summary: the leading sentence of each paragraph, capped.
 *
 * Extractive rather than abstractive is the honest choice offline - it selects
 * existing sentences instead of inventing a synthesis it cannot actually
 * perform, so nothing in the output is text the author did not write.
 */
export function executiveSummary(text: string, maxPoints = 5): string {
  const blocks = paragraphs(text);
  const points = blocks
    .map((block) => (isBulletList(block) ? bulletItems(block)[0] : sentences(block)[0]))
    .filter((s): s is string => Boolean(s))
    .slice(0, maxPoints);

  if (points.length === 0) return text.trim();
  return ['## Executive Summary', '', ...points.map((p) => `- ${ensureTerminated(p)}`)].join('\n');
}

/** Collapse runs of whitespace and normalise stray spacing before punctuation. */
export function tidyWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/\s+([,.;:!?])/g, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
