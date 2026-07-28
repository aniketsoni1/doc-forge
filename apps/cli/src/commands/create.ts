import { isAbsolute, relative, resolve } from 'node:path';
import pc from 'picocolors';
import { DocForgeError, safeParseDocSpec } from '@dfg/core';
import { failedAttempts, resolveAndGenerate } from '@dfg/agent';
import { formatProvenance, summarizeResult } from '@dfg/reporting';
import { buildCliLadderFromIo } from '../ladder';
import type { IoContext } from '../io';
import { diffLines } from '../io';

export interface CreateOptions {
  prompt: string;
  format?: string;
  template?: string;
  tone?: string;
  length?: string;
  title?: string;
  model?: string;
  output?: string;
  /** commander sets this to false when `--no-ai` is passed. */
  ai: boolean;
  nonInteractive?: boolean;
  force?: boolean;
}

function withExtension(path: string, format: string): string {
  if (/\.(md|markdown|html?|txt)$/i.test(path)) return path;
  return `${path}.${format === 'html' ? 'html' : 'md'}`;
}

/**
 * Resolve `--output` against the working directory and report whether it escapes
 * it. DocForge still honours an explicit path outside the cwd - the user asked
 * for it - but says so plainly rather than writing there silently.
 */
export function resolveOutputPath(
  cwd: string,
  output: string,
  format: string
): { target: string; display: string; escapesCwd: boolean } {
  const target = withExtension(isAbsolute(output) ? output : resolve(cwd, output), format);
  const rel = relative(cwd, target);
  const escapesCwd = rel === '' || rel.startsWith('..') || isAbsolute(rel);
  return { target, display: escapesCwd ? target : rel, escapesCwd };
}

export async function runCreate(opts: CreateOptions, io: IoContext): Promise<number> {
  const { generators, config, configIssues } = await buildCliLadderFromIo(
    io,
    opts.model ? { model: opts.model } : {}
  );

  for (const issue of configIssues) {
    io.stderr(pc.yellow(`! ${issue}`));
  }

  const parsed = safeParseDocSpec({
    prompt: opts.prompt,
    format: opts.format ?? config.defaultFormat,
    tone: opts.tone ?? config.defaultTone,
    length: opts.length ?? config.defaultLength,
    ...(opts.template ? { template: opts.template } : {}),
    ...(opts.title ? { title: opts.title } : {})
  });

  if (!parsed.success) {
    io.stderr(pc.red('Invalid options:'));
    for (const issue of parsed.error.issues) {
      io.stderr(`  - ${issue.path.join('.') || 'input'}: ${issue.message}`);
    }
    return 1;
  }

  const spec = parsed.data;

  let outcome;
  try {
    outcome = await resolveAndGenerate(spec, {
      generators,
      forceTemplate: !opts.ai,
      // `--no-ai` forces templates; otherwise network use follows aiEnabled,
      // which a key in the environment or a config file turns on.
      allowNetwork: opts.ai && config.aiEnabled
    });
  } catch (err) {
    if (err instanceof DocForgeError && err.code === 'cancelled') {
      io.stderr(pc.yellow('Cancelled - nothing was written.'));
      return 130;
    }
    io.stderr(pc.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  io.stderr(pc.cyan(formatProvenance(outcome.capability)));
  io.stderr(pc.dim(summarizeResult(outcome.result)));

  // Say *why* a generator was passed over, rather than only naming it.
  for (const attempt of failedAttempts(outcome.attempts)) {
    if (attempt.status === 'skipped_unavailable') continue;
    const label = attempt.label ?? attempt.generatorId;
    io.stderr(pc.yellow(`! ${label}: ${attempt.fallbackReason ?? attempt.status}`));
    if (attempt.recovery) io.stderr(pc.dim(`  → ${attempt.recovery}`));
  }

  for (const warning of outcome.result.warnings) {
    io.stderr(pc.yellow(`! ${warning}`));
  }

  const deliverable = outcome.document.deliverable;

  if (!opts.output) {
    io.stdout(deliverable);
    return 0;
  }

  const { target, display, escapesCwd } = resolveOutputPath(io.cwd, opts.output, spec.format);
  if (escapesCwd) {
    io.stderr(pc.yellow(`! Writing outside the working directory: ${target}`));
  }

  if (await io.fileExists(target)) {
    const existing = await io.readFile(target);
    if (existing === deliverable) {
      io.stdout(pc.dim(`No changes to ${display}.`));
      return 0;
    }
    io.stderr(pc.bold(`\nChanges to ${display}:`));
    io.stderr(diffLines(existing, deliverable));
    if (!opts.force) {
      if (opts.nonInteractive || !io.interactive) {
        io.stderr(pc.red(`Refusing to overwrite ${display} without --force.`));
        return 1;
      }
      if (!(await io.confirm(`Overwrite ${display}?`))) {
        io.stderr('Aborted.');
        return 1;
      }
    }
  } else if (io.interactive && !opts.nonInteractive && !opts.force) {
    if (!(await io.confirm(`Write ${display}?`))) {
      io.stderr('Aborted.');
      return 1;
    }
  }

  await io.writeFile(target, deliverable);
  io.stdout(pc.green(`Wrote ${display}`));
  return 0;
}
