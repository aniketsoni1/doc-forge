import { describe, expect, it } from 'vitest';
import { diffLines, diffStats, formatTextDiff, isUnchanged, summarizeDiff } from './index';

describe('diffLines', () => {
  it('reports every line equal for identical text', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines.every((l) => l.op === 'equal')).toBe(true);
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0, unchanged: 3 });
  });

  it('detects a single changed line', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(lines.filter((l) => l.op === 'remove').map((l) => l.text)).toEqual(['b']);
    expect(lines.filter((l) => l.op === 'add').map((l) => l.text)).toEqual(['B']);
  });

  it('detects a pure insertion', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    expect(diffStats(lines)).toEqual({ added: 1, removed: 0, unchanged: 2 });
  });

  it('detects a pure deletion', () => {
    const lines = diffLines('a\nb\nc', 'a\nc');
    expect(diffStats(lines)).toEqual({ added: 0, removed: 1, unchanged: 2 });
  });

  // An empty string splits to a single empty line, not to zero lines, so a
  // diff against "" removes that one blank line as well.
  it('handles an empty original', () => {
    expect(diffStats(diffLines('', 'a\nb'))).toEqual({ added: 2, removed: 1, unchanged: 0 });
  });

  it('handles an empty replacement', () => {
    expect(diffStats(diffLines('a\nb', ''))).toEqual({ added: 1, removed: 2, unchanged: 0 });
  });

  it('treats two empty strings as unchanged', () => {
    expect(diffStats(diffLines('', ''))).toEqual({ added: 0, removed: 0, unchanged: 1 });
  });

  it('finds a minimal diff rather than replacing wholesale', () => {
    // A naive differ would mark all six lines changed; LCS keeps the shared run.
    const lines = diffLines('1\n2\n3\n4', '1\n2\nX\n4');
    expect(diffStats(lines).unchanged).toBe(3);
  });

  it('tracks line numbers on both sides', () => {
    const lines = diffLines('a\nb', 'a\nB');
    const removed = lines.find((l) => l.op === 'remove');
    const added = lines.find((l) => l.op === 'add');
    expect(removed?.oldLine).toBe(2);
    expect(removed?.newLine).toBeUndefined();
    expect(added?.newLine).toBe(2);
    expect(added?.oldLine).toBeUndefined();
  });

  it('reconstructs the new text from equal + add lines', () => {
    const oldText = 'alpha\nbeta\ngamma';
    const newText = 'alpha\ndelta\ngamma\nepsilon';
    const rebuilt = diffLines(oldText, newText)
      .filter((l) => l.op !== 'remove')
      .map((l) => l.text)
      .join('\n');
    expect(rebuilt).toBe(newText);
  });

  it('reconstructs the old text from equal + remove lines', () => {
    const oldText = 'alpha\nbeta\ngamma';
    const newText = 'alpha\ndelta\ngamma\nepsilon';
    const rebuilt = diffLines(oldText, newText)
      .filter((l) => l.op !== 'add')
      .map((l) => l.text)
      .join('\n');
    expect(rebuilt).toBe(oldText);
  });
});

describe('formatDiff', () => {
  it('prefixes lines by operation', () => {
    const out = formatTextDiff('a\nb', 'a\nB', { full: true });
    expect(out).toContain('  a');
    expect(out).toContain('- b');
    expect(out).toContain('+ B');
  });

  it('collapses long unchanged runs', () => {
    const oldText = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const newText = oldText.replace('line 20', 'CHANGED');
    const out = formatTextDiff(oldText, newText, { context: 2 });

    expect(out).toContain('@@');
    expect(out).toContain('+ CHANGED');
    expect(out).toContain('- line 20');
    // Far-away context is elided rather than printed.
    expect(out).not.toContain('line 0');
    expect(out.split('\n').length).toBeLessThan(15);
  });

  it('keeps the requested amount of context', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const newText = oldText.replace('l10', 'X');
    const out = formatTextDiff(oldText, newText, { context: 1 });
    expect(out).toContain('  l9');
    expect(out).toContain('  l11');
    expect(out).not.toContain('  l8');
  });

  it('renders everything when full is set', () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const out = formatTextDiff(oldText, oldText, { full: true });
    expect(out.split('\n')).toHaveLength(30);
    expect(out).not.toContain('@@');
  });

  it('applies a decorator without changing the underlying text', () => {
    const out = formatTextDiff('a', 'b', {
      full: true,
      decorate: (line, rendered) => (line.op === 'add' ? `<${rendered}>` : rendered)
    });
    expect(out).toContain('<+ b>');
    expect(out).toContain('- a');
  });
});

describe('summaries', () => {
  it('summarises additions and removals', () => {
    expect(summarizeDiff(diffLines('a\nb', 'a\nB\nC'))).toBe('+2 −1');
  });

  it('says so when nothing changed', () => {
    expect(summarizeDiff(diffLines('same', 'same'))).toBe('no changes');
  });

  it('detects equality directly', () => {
    expect(isUnchanged('x', 'x')).toBe(true);
    expect(isUnchanged('x', 'y')).toBe(false);
  });
});
