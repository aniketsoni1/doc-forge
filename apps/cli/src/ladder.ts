import type { Generator } from '@dfg/core';
import { createTemplateGenerator } from '@dfg/generator-template';
import { ByokGenerator } from '@dfg/generator-byok';
import { loadConfig, resolveApiKey, type DocForgeConfig, type EnvLike } from '@dfg/configuration';

export interface CliLadder {
  generators: Generator[];
  config: DocForgeConfig;
  hasApiKey: boolean;
}

/**
 * Assemble the CLI generator ladder. The editor-only LM API and extension paths
 * do not apply here, so the CLI ladder is: BYO-key (if a key is present) then the
 * always-available template generator.
 */
export function buildCliLadder(env: EnvLike, opts: { model?: string } = {}): CliLadder {
  const config = loadConfig(env, opts.model ? { model: opts.model } : {});
  const apiKey = resolveApiKey(env);
  const generators: Generator[] = [
    new ByokGenerator({ provider: config.provider, apiKey, model: config.model }),
    createTemplateGenerator()
  ];
  return { generators, config, hasApiKey: Boolean(apiKey) };
}
