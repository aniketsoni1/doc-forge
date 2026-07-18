import { isAbsolute, resolve } from 'node:path';
import pc from 'picocolors';
import { safeParseDocSpec } from '@dfg/core';
import { resolveAndGenerate } from '@dfg/agent';
import { formatProvenance, summarizeResult } from '@dfg/reporting';
import { buildCliLadder } from '../ladder';
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

export async function runCreate(opts: CreateOptions, io: IoContext): Promise<number> {
  const { generators, config } = buildCliLadder(io.env, opts.model ? { model: opts.model } : {});

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
  const outcome = await resolveAndGenerate(spec, {
    generators,
    forceTemplate: !opts.ai,
    allowNetwork: opts.ai
  });

  io.stderr(pc.cyan(formatProvenance(outcome.capability)));
  io.stderr(pc.dim(summarizeResult(outcome.result)));
  if (outcome.result.meta.fellBackFrom?.length) {
    io.stderr(pc.dim(`Fell back from: ${outcome.result.meta.fellBackFrom.join(', ')}`));
  }
  for (const warning of outcome.result.warnings) {
    io.stderr(pc.yellow(`! ${warning}`));
  }

  const deliverable = outcome.document.deliverable;

  if (!opts.output) {
    io.stdout(deliverable);
    return 0;
  }

  const target = withExtension(
    isAbsolute(opts.output) ? opts.output : resolve(io.cwd, opts.output),
    spec.format
  );
  const rel = target.startsWith(io.cwd) ? target.slice(io.cwd.length + 1) : target;

  if (await io.fileExists(target)) {
    const existing = await io.readFile(target);
    if (existing === deliverable) {
      io.stdout(pc.dim(`No changes to ${rel}.`));
      return 0;
    }
    io.stderr(pc.bold(`\nChanges to ${rel}:`));
    io.stderr(diffLines(existing, deliverable));
    if (!opts.force) {
      if (opts.nonInteractive || !io.interactive) {
        io.stderr(pc.red(`Refusing to overwrite ${rel} without --force.`));
        return 1;
      }
      if (!(await io.confirm(`Overwrite ${rel}?`))) {
        io.stderr('Aborted.');
        return 1;
      }
    }
  } else if (io.interactive && !opts.nonInteractive && !opts.force) {
    if (!(await io.confirm(`Write ${rel}?`))) {
      io.stderr('Aborted.');
      return 1;
    }
  }

  await io.writeFile(target, deliverable);
  io.stdout(pc.green(`Wrote ${rel}`));
  return 0;
}
