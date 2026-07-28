/**
 * A small line differ shared by every surface that asks the user to approve a
 * change: CLI overwrite prompts, selection rewrites, and section regeneration.
 *
 * This was previously inlined in the CLI with picocolors baked in, which meant
 * the extension could not reuse it. Colour is now the caller's business - the
 * data model here is plain, so a terminal, a webview, and a test can each render
 * it however they like.
 */

export type DiffOp = 'equal' | 'add' | 'remove';

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the original, when the line exists there. */
  oldLine?: number;
  /** 1-based line number in the replacement, when the line exists there. */
  newLine?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

/**
 * Longest-common-subsequence line diff.
 *
 * O(n*m) in time and memory, which is the right trade for documents: they are
 * small, and an exact minimal diff reads far better to a human approving an
 * overwrite than a fast approximation would.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i] ?? '', oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: 'remove', text: a[i] ?? '', oldLine: i + 1 });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] ?? '', newLine: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ op: 'remove', text: a[i] ?? '', oldLine: ++i });
  while (j < m) out.push({ op: 'add', text: b[j] ?? '', newLine: ++j });

  return out;
}

/** Count changed and unchanged lines. */
export function diffStats(lines: readonly DiffLine[]): DiffStats {
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
  for (const line of lines) {
    if (line.op === 'add') stats.added += 1;
    else if (line.op === 'remove') stats.removed += 1;
    else stats.unchanged += 1;
  }
  return stats;
}

/** True when the two texts are identical. */
export function isUnchanged(oldText: string, newText: string): boolean {
  return oldText === newText;
}

export interface FormatOptions {
  /** Lines of unchanged context to keep around each change. Default 3. */
  context?: number;
  /** Render every line, ignoring `context`. Default false. */
  full?: boolean;
  /** Per-op decoration, e.g. terminal colour. Defaults to the identity. */
  decorate?: (line: DiffLine, rendered: string) => string;
}

/**
 * Render a diff as unified-style text with `+`/`-`/space prefixes, collapsing
 * long unchanged runs into `@@ … @@` markers so a large document does not bury
 * a two-line change.
 */
export function formatDiff(lines: readonly DiffLine[], options: FormatOptions = {}): string {
  const context = options.context ?? 3;
  const decorate = options.decorate ?? ((_l, rendered): string => rendered);

  const keep = new Set<number>();
  if (options.full) {
    lines.forEach((_l, i) => keep.add(i));
  } else {
    lines.forEach((line, i) => {
      if (line.op === 'equal') return;
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
        keep.add(k);
      }
    });
  }

  const out: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (!keep.has(i)) {
      if (!skipping) {
        out.push('@@ …  @@');
        skipping = true;
      }
      continue;
    }
    skipping = false;
    const prefix = line.op === 'add' ? '+ ' : line.op === 'remove' ? '- ' : '  ';
    out.push(decorate(line, `${prefix}${line.text}`));
  }
  return out.join('\n');
}

/** Convenience: diff and format in one call. */
export function formatTextDiff(
  oldText: string,
  newText: string,
  options?: FormatOptions
): string {
  return formatDiff(diffLines(oldText, newText), options);
}

/** A one-line summary such as "+4 −2". */
export function summarizeDiff(lines: readonly DiffLine[]): string {
  const { added, removed } = diffStats(lines);
  if (added === 0 && removed === 0) return 'no changes';
  return `+${added} −${removed}`;
}
