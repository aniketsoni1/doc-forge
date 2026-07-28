import { resolve } from 'node:path';
import process from 'node:process';
import pc from 'picocolors';
import { probeCapabilities } from '@dfg/agent';
import { listTemplates } from '@dfg/templates';
import { CONFIG_FILE_NAME, DEFAULT_CONFIG } from '@dfg/configuration';
import { buildCliLadderFromIo } from '../ladder';
import type { IoContext } from '../io';

/** `docforge doctor` - report environment and generator availability. */
export async function runDoctor(io: IoContext): Promise<number> {
  const { generators, config, hasApiKey, configIssues, usedConfigFile } =
    await buildCliLadderFromIo(io);

  io.stdout(pc.bold('DocForge doctor'));
  io.stdout(`  node            ${process.version}`);
  io.stdout(
    `  config file     ${usedConfigFile ? pc.green(CONFIG_FILE_NAME) : pc.dim('none (using defaults)')}`
  );
  io.stdout(`  provider        ${config.provider}`);
  io.stdout(`  model           ${config.model}`);
  io.stdout(
    `  AI enabled      ${config.aiEnabled ? pc.green('yes') : pc.yellow('no (templates only)')}`
  );
  io.stdout(`  request timeout ${config.requestTimeoutMs}ms`);
  io.stdout(
    `  API key         ${hasApiKey ? pc.green('detected') : pc.yellow('not set (template fallback only)')}`
  );

  if (configIssues.length) {
    io.stdout('');
    io.stdout(pc.bold(pc.yellow('Config problems')));
    for (const issue of configIssues) io.stdout(`  ${pc.yellow('!')} ${issue}`);
  }

  io.stdout('');
  io.stdout(pc.bold('Generators'));
  const caps = await probeCapabilities(generators);
  for (const cap of caps) {
    const mark = cap.available ? pc.green('✓') : pc.dim('·');
    const net = cap.requiresNetwork ? pc.dim(' [network]') : '';
    io.stdout(`  ${mark} ${cap.label}${net}${cap.detail ? pc.dim(` - ${cap.detail}`) : ''}`);
    const advertised = Object.entries(cap.features ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    if (advertised.length) io.stdout(pc.dim(`      supports: ${advertised.join(', ')}`));
  }

  io.stdout('');
  io.stdout(pc.bold('Templates'));
  for (const t of listTemplates()) {
    io.stdout(`  ${pc.cyan(t.id.padEnd(10))} ${t.description}`);
  }
  return 0;
}

/** `docforge init` - write a starter config file to the current directory. */
export async function runInit(
  io: IoContext,
  opts: { force?: boolean; nonInteractive?: boolean }
): Promise<number> {
  const target = resolve(io.cwd, CONFIG_FILE_NAME);
  const body = `${JSON.stringify(
    {
      defaultFormat: DEFAULT_CONFIG.defaultFormat,
      defaultTone: DEFAULT_CONFIG.defaultTone,
      defaultLength: DEFAULT_CONFIG.defaultLength,
      aiEnabled: DEFAULT_CONFIG.aiEnabled,
      provider: DEFAULT_CONFIG.provider,
      model: DEFAULT_CONFIG.model,
      requestTimeoutMs: DEFAULT_CONFIG.requestTimeoutMs
    },
    null,
    2
  )}\n`;

  if ((await io.fileExists(target)) && !opts.force) {
    if (opts.nonInteractive || !io.interactive) {
      io.stderr(pc.red(`${CONFIG_FILE_NAME} already exists. Use --force to overwrite.`));
      return 1;
    }
    if (!(await io.confirm(`Overwrite ${CONFIG_FILE_NAME}?`))) {
      io.stderr('Aborted.');
      return 1;
    }
  }
  await io.writeFile(target, body);
  io.stdout(pc.green(`Wrote ${CONFIG_FILE_NAME}`));
  io.stdout(pc.dim('DocForge reads this file from the working directory on every run.'));
  return 0;
}

/** `docforge configure` - explain how to supply an API key (CLI uses env vars). */
export async function runConfigure(io: IoContext): Promise<number> {
  const { hasApiKey, config } = await buildCliLadderFromIo(io);
  io.stdout(pc.bold('Configuring DocForge (CLI)'));
  io.stdout('');
  io.stdout('The CLI reads AI credentials from environment variables (local-only, never stored):');
  io.stdout(`  ${pc.cyan('DOCFORGE_API_KEY')}   generic key (used with DOCFORGE_PROVIDER)`);
  io.stdout(`  ${pc.cyan('ANTHROPIC_API_KEY')}  use Anthropic`);
  io.stdout(`  ${pc.cyan('OPENAI_API_KEY')}     use OpenAI`);
  io.stdout('');
  io.stdout('Optional overrides:');
  io.stdout(`  ${pc.cyan('DOCFORGE_MODEL')}      model id (current: ${config.model})`);
  io.stdout(`  ${pc.cyan('DOCFORGE_FORMAT')}     md | html`);
  io.stdout(
    `  ${pc.cyan('DOCFORGE_TIMEOUT_MS')} provider request timeout (current: ${config.requestTimeoutMs})`
  );
  io.stdout('');
  io.stdout(
    `Project defaults live in ${pc.cyan(CONFIG_FILE_NAME)} - run ${pc.cyan('docforge init')} to create one.`
  );
  io.stdout(pc.dim('Precedence: defaults → config file → environment → command-line flags.'));
  io.stdout('');
  io.stdout(
    hasApiKey
      ? pc.green('An API key is currently detected.')
      : pc.yellow('No API key detected - DocForge will use the built-in template generator.')
  );
  io.stdout(pc.dim('Without a key, everything still works offline via templates.'));
  return 0;
}
