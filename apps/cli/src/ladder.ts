import { resolve } from 'node:path';
import type { Generator } from '@dfg/core';
import { createTemplateGenerator } from '@dfg/generator-template';
import { ByokGenerator } from '@dfg/generator-byok';
import { setPricingOverrides } from '@dfg/reporting';
import {
  CONFIG_FILE_NAME,
  resolveApiKey,
  resolveConfig,
  type DocForgeConfig,
  type EnvLike
} from '@dfg/configuration';
import type { IoContext } from './io';

export interface CliLadder {
  generators: Generator[];
  config: DocForgeConfig;
  hasApiKey: boolean;
  /** Problems found in `docforge.config.json`, surfaced to the user. */
  configIssues: string[];
  /** True when a `docforge.config.json` contributed settings. */
  usedConfigFile: boolean;
}

/**
 * Read `docforge.config.json` from the working directory, if present. Returns
 * undefined when there is no file, so config resolution can distinguish "absent"
 * from "present but empty".
 */
export async function readConfigFile(io: IoContext): Promise<string | undefined> {
  const path = resolve(io.cwd, CONFIG_FILE_NAME);
  if (!(await io.fileExists(path))) return undefined;
  try {
    return await io.readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Assemble the CLI generator ladder. The editor-only LM API and extension paths
 * do not apply here, so the CLI ladder is: BYO-key (if a key is present) then the
 * always-available template generator.
 */
export function buildCliLadder(
  env: EnvLike,
  opts: { model?: string; fileContents?: string | undefined } = {}
): CliLadder {
  const { config, issues, usedFile } = resolveConfig({
    env,
    fileContents: opts.fileContents,
    overrides: opts.model ? { model: opts.model } : {}
  });

  // Let a project or user config restate provider pricing rather than baking a
  // stale price list into the tool.
  setPricingOverrides(config.pricing);

  const apiKey = resolveApiKey(env);
  const generators: Generator[] = [
    new ByokGenerator({
      provider: config.provider,
      apiKey,
      model: config.model,
      timeoutMs: config.requestTimeoutMs
    }),
    createTemplateGenerator()
  ];
  return {
    generators,
    config,
    hasApiKey: Boolean(apiKey),
    configIssues: issues,
    usedConfigFile: usedFile
  };
}

/** Convenience wrapper that loads the config file before assembling the ladder. */
export async function buildCliLadderFromIo(
  io: IoContext,
  opts: { model?: string } = {}
): Promise<CliLadder> {
  const fileContents = await readConfigFile(io);
  return buildCliLadder(io.env, { ...opts, fileContents });
}
