import { z } from 'zod';
import type { DocFormat, DocLength, DocTone } from '@dfg/core';

export type AiProvider = 'anthropic' | 'openai';

/** USD per million tokens, keyed by model-id prefix. */
export interface PriceOverride {
  inputPerMTok: number;
  outputPerMTok: number;
}

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
  /** Abort a provider request after this many milliseconds. */
  requestTimeoutMs: number;
  /** User-supplied pricing, keyed by model-id prefix. */
  pricing: Record<string, PriceOverride>;
}

export const DEFAULT_CONFIG: DocForgeConfig = {
  defaultFormat: 'md',
  defaultTone: 'neutral',
  defaultLength: 'medium',
  aiEnabled: false,
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-latest',
  cacheDir: '.docforge-cache',
  requestTimeoutMs: 60_000,
  pricing: {}
};

/** The canonical config file name looked up in the working directory. */
export const CONFIG_FILE_NAME = 'docforge.config.json';

const priceSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative()
});

/**
 * Schema for `docforge.config.json`. Every field is optional - the file layers
 * over the defaults - and unknown keys are rejected, so a typo surfaces as an
 * error instead of being silently ignored.
 */
export const configFileSchema = z
  .object({
    defaultFormat: z.enum(['md', 'html']).optional(),
    defaultTone: z.enum(['neutral', 'formal', 'friendly', 'technical', 'marketing']).optional(),
    defaultLength: z.enum(['short', 'medium', 'long']).optional(),
    aiEnabled: z.boolean().optional(),
    provider: z.enum(['anthropic', 'openai']).optional(),
    model: z.string().min(1).optional(),
    cacheDir: z.string().min(1).optional(),
    requestTimeoutMs: z.number().int().positive().optional(),
    pricing: z.record(z.string(), priceSchema).optional()
  })
  .strict();

export type ConfigFile = z.infer<typeof configFileSchema>;

export interface ConfigFileResult {
  config: Partial<DocForgeConfig>;
  /** Human-readable problems found in the file; empty when it parsed cleanly. */
  issues: string[];
}

/**
 * Parse the contents of a `docforge.config.json`. Never throws: a malformed file
 * degrades to "no file settings" plus reportable issues, because a broken config
 * must not stop DocForge from producing a document.
 */
export function parseConfigFile(contents: string): ConfigFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { config: {}, issues: [`${CONFIG_FILE_NAME} is not valid JSON: ${detail}`] };
  }

  const parsed = configFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      config: {},
      issues: parsed.error.issues.map(
        (i) => `${CONFIG_FILE_NAME}: ${i.path.join('.') || 'root'} - ${i.message}`
      )
    };
  }
  // Drop explicit undefined keys so object spread cannot clobber defaults.
  const config = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as Partial<DocForgeConfig>;
  return { config, issues: [] };
}

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

/** Extract config settings from environment variables. */
export function configFromEnv(env: EnvLike = {}): Partial<DocForgeConfig> {
  const fromEnv: Partial<DocForgeConfig> = {};
  if (env.DOCFORGE_FORMAT === 'md' || env.DOCFORGE_FORMAT === 'html') {
    fromEnv.defaultFormat = env.DOCFORGE_FORMAT;
  }
  if (env.DOCFORGE_MODEL) fromEnv.model = env.DOCFORGE_MODEL;
  const provider = providerFromEnv(env);
  if (provider) fromEnv.provider = provider;
  if (resolveApiKey(env)) fromEnv.aiEnabled = true;
  if (env.DOCFORGE_CACHE_DIR) fromEnv.cacheDir = env.DOCFORGE_CACHE_DIR;
  const timeout = Number(env.DOCFORGE_TIMEOUT_MS);
  if (Number.isFinite(timeout) && timeout > 0) fromEnv.requestTimeoutMs = timeout;
  return fromEnv;
}

/**
 * Merge defaults + environment + explicit overrides into a resolved config.
 *
 * Precedence, lowest to highest: defaults → environment → explicit overrides.
 * Use {@link resolveConfig} when a config file should also be layered in.
 */
export function loadConfig(
  env: EnvLike = {},
  overrides: Partial<DocForgeConfig> = {}
): DocForgeConfig {
  return { ...DEFAULT_CONFIG, ...configFromEnv(env), ...overrides };
}

export interface LoadConfigInput {
  env?: EnvLike;
  /** Raw contents of `docforge.config.json`, when one was found. */
  fileContents?: string | undefined;
  overrides?: Partial<DocForgeConfig>;
}

export interface ResolvedConfig {
  config: DocForgeConfig;
  /** Problems found while parsing the config file. */
  issues: string[];
  /** True when a config file actually contributed settings. */
  usedFile: boolean;
}

/**
 * Full resolution including a config file.
 *
 * Precedence, lowest to highest: defaults → config file → environment →
 * explicit overrides (CLI flags / editor settings). The environment beats the
 * file so that a checked-in project config never overrides a developer's own
 * machine-level credentials or model choice.
 */
export function resolveConfig(input: LoadConfigInput = {}): ResolvedConfig {
  const { config: fromFile, issues } =
    input.fileContents === undefined
      ? { config: {} as Partial<DocForgeConfig>, issues: [] as string[] }
      : parseConfigFile(input.fileContents);

  const config: DocForgeConfig = {
    ...DEFAULT_CONFIG,
    ...fromFile,
    ...configFromEnv(input.env ?? {}),
    ...(input.overrides ?? {})
  };

  return {
    config,
    issues,
    usedFile: Object.keys(fromFile).length > 0
  };
}
