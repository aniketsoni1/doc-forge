import type { DocFormat, DocLength, DocTone } from '@dfg/core';

export type AiProvider = 'anthropic' | 'openai';

export interface DocForgeConfig {
  defaultFormat: DocFormat;
  defaultTone: DocTone;
  defaultLength: DocLength;
  /** Whether AI generation is permitted at all (network + BYO key). */
  aiEnabled: boolean;
  provider: AiProvider;
  model: string;
  /** Directory (relative to cwd) used for the prompt cache. */
  cacheDir: string;
}

export const DEFAULT_CONFIG: DocForgeConfig = {
  defaultFormat: 'md',
  defaultTone: 'neutral',
  defaultLength: 'medium',
  aiEnabled: false,
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-latest',
  cacheDir: '.docforge-cache'
};

export type EnvLike = Record<string, string | undefined>;

/** Read an API key from the environment, preferring the DocForge-specific var. */
export function resolveApiKey(env: EnvLike = {}): string | undefined {
  return env.DOCFORGE_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || undefined;
}

/** Infer a provider from whichever key is present. */
export function providerFromEnv(env: EnvLike = {}): AiProvider | undefined {
  if (env.DOCFORGE_PROVIDER === 'anthropic' || env.DOCFORGE_PROVIDER === 'openai') {
    return env.DOCFORGE_PROVIDER;
  }
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return undefined;
}

/** Merge defaults + environment + explicit overrides into a resolved config. */
export function loadConfig(env: EnvLike = {}, overrides: Partial<DocForgeConfig> = {}): DocForgeConfig {
  const fromEnv: Partial<DocForgeConfig> = {};
  if (env.DOCFORGE_FORMAT === 'md' || env.DOCFORGE_FORMAT === 'html') {
    fromEnv.defaultFormat = env.DOCFORGE_FORMAT;
  }
  if (env.DOCFORGE_MODEL) fromEnv.model = env.DOCFORGE_MODEL;
  const provider = providerFromEnv(env);
  if (provider) fromEnv.provider = provider;
  if (resolveApiKey(env)) fromEnv.aiEnabled = true;
  if (env.DOCFORGE_CACHE_DIR) fromEnv.cacheDir = env.DOCFORGE_CACHE_DIR;
  return { ...DEFAULT_CONFIG, ...fromEnv, ...overrides };
}
