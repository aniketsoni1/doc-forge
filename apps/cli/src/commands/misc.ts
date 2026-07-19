import { resolve } from 'node:path';
import process from 'node:process';
import pc from 'picocolors';
import { probeCapabilities } from '@dfg/agent';
import { listTemplates } from '@dfg/templates';
import { DEFAULT_CONFIG } from '@dfg/configuration';
import { buildCliLadder } from '../ladder';
import type { IoContext } from '../io';

/** `docforge doctor` - report environment and generator availability. */
export async function runDoctor(io: IoContext): Promise<number> {
  const { generators, config, hasApiKey } = buildCliLadder(io.env);
  io.stdout(pc.bold('DocForge doctor'));
  io.stdout(`  node            ${process.version}`);
  io.stdout(`  provider        ${config.provider}`);
  io.stdout(`  model           ${config.model}`);
  io.stdout(`  API key         ${hasApiKey ? pc.green('detected') : pc.yellow('not set (template fallback only)')}`);
  io.stdout('');
  io.stdout(pc.bold('Generators'));
  const caps = await probeCapabilities(generators);
  for (const cap of caps) {
    const mark = cap.available ? pc.green('✓') : pc.dim('·');
    const net = cap.requiresNetwork ? pc.dim(' [network]') : '';
    io.stdout(`  ${mark} ${cap.label}${net}${cap.detail ? pc.dim(` - ${cap.detail}`) : ''}`);
  }
  io.stdout('');
  io.stdout(pc.bold('Templates'));
  for (const t of listTemplates()) {
    io.stdout(`  ${pc.cyan(t.id.padEnd(10))} ${t.description}`);
  }
  return 0;
}

/** `docforge init` - write a starter config file to the current directory. */
export async function runInit(io: IoContext, opts: { force?: boolean; nonInteractive?: boolean }): Promise<number> {
  const target = resolve(io.cwd, 'docforge.config.json');
  const body = `${JSON.stringify(
    {
      defaultFormat: DEFAULT_CONFIG.defaultFormat,
      defaultTone: DEFAULT_CONFIG.defaultTone,
      defaultLength: DEFAULT_CONFIG.defaultLength,
      provider: DEFAULT_CONFIG.provider,
      model: DEFAULT_CONFIG.model
    },
    null,
    2
  )}\n`;

  if ((await io.fileExists(target)) && !opts.force) {
    if (opts.nonInteractive || !io.interactive) {
      io.stderr(pc.red('docforge.config.json already exists. Use --force to overwrite.'));
      return 1;
    }
    if (!(await io.confirm('Overwrite docforge.config.json?'))) {
      io.stderr('Aborted.');
      return 1;
    }
  }
  await io.writeFile(target, body);
  io.stdout(pc.green('Wrote docforge.config.json'));
  return 0;
}

/** `docforge configure` - explain how to supply an API key (CLI uses env vars). */
export function runConfigure(io: IoContext): number {
  const { hasApiKey, config } = buildCliLadder(io.env);
  io.stdout(pc.bold('Configuring DocForge (CLI)'));
  io.stdout('');
  io.stdout('The CLI reads AI credentials from environment variables (local-only, never stored):');
  io.stdout(`  ${pc.cyan('DOCFORGE_API_KEY')}   generic key (used with DOCFORGE_PROVIDER)`);
  io.stdout(`  ${pc.cyan('ANTHROPIC_API_KEY')}  use Anthropic`);
  io.stdout(`  ${pc.cyan('OPENAI_API_KEY')}     use OpenAI`);
  io.stdout('');
  io.stdout('Optional overrides:');
  io.stdout(`  ${pc.cyan('DOCFORGE_MODEL')}     model id (current: ${config.model})`);
  io.stdout(`  ${pc.cyan('DOCFORGE_FORMAT')}    md | html`);
  io.stdout('');
  io.stdout(hasApiKey ? pc.green('An API key is currently detected.') : pc.yellow('No API key detected - DocForge will use the built-in template generator.'));
  io.stdout(pc.dim('Without a key, everything still works offline via templates.'));
  return 0;
}
