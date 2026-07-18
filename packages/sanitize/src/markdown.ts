/**
 * Deterministic Markdown normalization and a tiny lint pass. Pure and
 * dependency-free: DocForge only needs stable, predictable cleanup, not a full
 * CommonMark linter.
 */

/** Normalize Markdown: strip trailing spaces, collapse blank runs, single final newline. */
export function normalizeMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const cleaned = lines.map((line) => {
    // Ensure ATX headings have a space after the hashes.
    const heading = /^(#{1,6})([^#\s])/.exec(line);
    const withHeadingSpace = heading ? line.replace(/^(#{1,6})/, '$1 ') : line;
    return withHeadingSpace.replace(/[ \t]+$/g, '');
  });

  // Collapse 3+ blank lines to a single blank line.
  const out: string[] = [];
  let blankRun = 0;
  for (const line of cleaned) {
    if (line === '') {
      blankRun += 1;
      if (blankRun <= 1) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return `${out.join('\n').replace(/\n+$/g, '')}\n`;
}

export interface MarkdownLintIssue {
  rule: string;
  message: string;
}

/** Report a small set of structural issues used by the validation/repair loop. */
export function lintMarkdown(markdown: string): MarkdownLintIssue[] {
  const issues: MarkdownLintIssue[] = [];
  const lines = markdown.split('\n');

  const h1Count = lines.filter((l) => /^#\s/.test(l)).length;
  if (h1Count === 0) {
    issues.push({ rule: 'require-h1', message: 'Document has no top-level (#) heading.' });
  }
  if (h1Count > 1) {
    issues.push({ rule: 'single-h1', message: `Document has ${h1Count} top-level headings; expected 1.` });
  }
  if (/\t/.test(markdown)) {
    issues.push({ rule: 'no-hard-tabs', message: 'Document contains hard tabs.' });
  }
  if (/[ \t]+\n/.test(markdown)) {
    issues.push({ rule: 'no-trailing-spaces', message: 'Document contains trailing whitespace.' });
  }
  return issues;
}

/** Convenience: true when the Markdown passes {@link lintMarkdown}. */
export function isMarkdownClean(markdown: string): boolean {
  return lintMarkdown(markdown).length === 0;
}
