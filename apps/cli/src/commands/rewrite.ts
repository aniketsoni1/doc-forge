import { isAbsolute, resolve } from 'node:path';
import pc from 'picocolors';
import { DocForgeError, type DocFormat } from '@dfg/core';
import { runTransform, regenerateSection } from '@dfg/agent';
import { formatTextDiff, isUnchanged, summarizeDiff, diffLines } from '@dfg/diff';
import { findBySlug, parseOutline, sectionBody } from '@dfg/document-model';
import { getTransform, listTransforms, type TransformContext } from '@dfg/transforms';
import { buildCliLadderFromIo } from '../ladder';
import type { IoContext } from '../io';

export interface RewriteOptions {
  /** Path to the file to rewrite. */
  file: string;
  /** Transform id, e.g. `make-concise`. */
  transform?: string;
  /** Restrict the rewrite to one section, by slug or title. */
  section?: string;
  tone?: string;
  audience?: string;
  language?: string;
  instruction?: string;
  /** commander sets this to false when `--no-ai` is passed. */
  ai: boolean;
  /** Write the result back instead of printing it. */
  write?: boolean;
  nonInteractive?: boolean;
  force?: boolean;
}

function formatForPath(path: string): DocFormat {
  return /\.html?$/i.test(path) ? 'html' : 'md';
}

/** `docforge transforms` - list the available operations. */
export function runTransforms(io: IoContext): number {
  io.stdout(pc.bold('DocForge transforms'));
  io.stdout('');
  const width = Math.max(...listTransforms().map((t) => t.id.length));
  for (const transform of listTransforms()) {
    const badge = transform.kind === 'deterministic' ? pc.green('offline') : pc.dim('needs AI');
    io.stdout(`  ${pc.cyan(transform.id.padEnd(width))}  ${badge}  ${transform.description}`);
  }
  io.stdout('');
  io.stdout(pc.dim('Offline transforms work with --no-ai and need no API key.'));
  return 0;
}

/**
 * `docforge rewrite` - apply a transform to a file, or to one section of it.
 *
 * Mirrors the extension's flow: never write without showing the change first,
 * and require `--force` in a non-interactive context so automation cannot
 * silently rewrite a file.
 */
export async function runRewrite(opts: RewriteOptions, io: IoContext): Promise<number> {
  const transformId = opts.transform ?? 'improve-clarity';
  const transform = getTransform(transformId as never);
  if (!transform) {
    io.stderr(pc.red(`Unknown transform "${transformId}".`));
    io.stderr(pc.dim('Run `docforge transforms` to see the available ids.'));
    return 1;
  }

  const path = isAbsolute(opts.file) ? opts.file : resolve(io.cwd, opts.file);
  if (!(await io.fileExists(path))) {
    io.stderr(pc.red(`No such file: ${opts.file}`));
    return 1;
  }

  const source = await io.readFile(path);
  const format = formatForPath(path);
  const { generators, config, configIssues } = await buildCliLadderFromIo(io);
  for (const issue of configIssues) io.stderr(pc.yellow(`! ${issue}`));

  const allowNetwork = opts.ai && config.aiEnabled;

  try {
    const { updated, before, after, producedBy } = opts.section
      ? await rewriteSection(source, format, opts, generators, allowNetwork)
      : await rewriteWhole(source, format, transform.id, opts, generators, allowNetwork);

    io.stderr(pc.cyan(`Rewritten with: ${producedBy}`));

    if (isUnchanged(before, after)) {
      io.stdout(pc.dim('No changes.'));
      return 0;
    }

    const lines = diffLines(before, after);
    io.stderr(pc.bold(`\nProposed changes (${summarizeDiff(lines)}):`));
    io.stderr(
      formatTextDiff(before, after, {
        decorate: (line, rendered) =>
          line.op === 'add' ? pc.green(rendered) : line.op === 'remove' ? pc.red(rendered) : rendered
      })
    );

    if (!opts.write) {
      io.stdout(updated);
      return 0;
    }

    if (!opts.force) {
      if (opts.nonInteractive || !io.interactive) {
        io.stderr(pc.red(`Refusing to rewrite ${opts.file} without --force.`));
        return 1;
      }
      if (!(await io.confirm(`Apply these changes to ${opts.file}?`))) {
        io.stderr('Aborted.');
        return 1;
      }
    }

    await io.writeFile(path, updated);
    io.stdout(pc.green(`Rewrote ${opts.file}`));
    return 0;
  } catch (err) {
    if (err instanceof DocForgeError && err.code === 'cancelled') {
      io.stderr(pc.yellow('Cancelled - nothing was written.'));
      return 130;
    }
    io.stderr(pc.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}

interface RewriteOutcome {
  updated: string;
  before: string;
  after: string;
  producedBy: string;
}

async function rewriteWhole(
  source: string,
  format: DocFormat,
  transformId: string,
  opts: RewriteOptions,
  generators: Awaited<ReturnType<typeof buildCliLadderFromIo>>['generators'],
  allowNetwork: boolean
): Promise<RewriteOutcome> {
  const transform = getTransform(transformId as never)!;
  const context: TransformContext = {
    selection: source,
    format,
    ...(opts.tone ? { tone: opts.tone as TransformContext['tone'] } : {}),
    ...(opts.audience ? { audience: opts.audience } : {}),
    ...(opts.language ? { language: opts.language } : {}),
    ...(opts.instruction ? { instruction: opts.instruction } : {})
  };

  const result = await runTransform({
    transform,
    context,
    generators,
    allowNetwork,
    forceDeterministic: !opts.ai
  });

  // Diff what would actually land on disk, so a purely cosmetic difference in
  // trailing whitespace is not reported to the user as a change.
  const updated = `${result.text.replace(/\s+$/, '')}\n`;
  return { updated, before: source, after: updated, producedBy: result.producedBy };
}

async function rewriteSection(
  source: string,
  format: DocFormat,
  opts: RewriteOptions,
  generators: Awaited<ReturnType<typeof buildCliLadderFromIo>>['generators'],
  allowNetwork: boolean
): Promise<RewriteOutcome> {
  const outline = parseOutline(source, format);
  const wanted = (opts.section ?? '').toLowerCase();
  const section =
    findBySlug(outline, wanted) ??
    outline.flat.find((s) => s.title.toLowerCase() === wanted);

  if (!section) {
    const available = outline.flat.map((s) => s.slug).join(', ');
    throw new DocForgeError(
      'unknown_section',
      `No section "${opts.section}". Available: ${available || '(none)'}`
    );
  }

  const result = await regenerateSection({
    source,
    section,
    format,
    ...(opts.instruction ? { instruction: opts.instruction } : {}),
    generators,
    allowNetwork
  });

  return {
    updated: result.document,
    before: sectionBody(source, section),
    after: result.newBody,
    producedBy: result.producedBy
  };
}

/** `docforge outline` - print a document's heading structure. */
export async function runOutline(file: string, io: IoContext): Promise<number> {
  const path = isAbsolute(file) ? file : resolve(io.cwd, file);
  if (!(await io.fileExists(path))) {
    io.stderr(pc.red(`No such file: ${file}`));
    return 1;
  }
  const source = await io.readFile(path);
  const outline = parseOutline(source, formatForPath(path));

  if (outline.flat.length === 0) {
    io.stdout(pc.dim('No headings found.'));
    return 0;
  }
  for (const section of outline.flat) {
    const indent = '  '.repeat(Math.max(0, section.level - 1));
    io.stdout(`${indent}${section.title || '(untitled)'}  ${pc.dim(section.slug)}`);
  }
  return 0;
}
