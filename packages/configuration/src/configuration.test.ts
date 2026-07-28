import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  configFromEnv,
  loadConfig,
  parseConfigFile,
  providerFromEnv,
  resolveApiKey,
  resolveConfig
} from './index';

describe('parseConfigFile', () => {
  it('reads a valid config', () => {
    const { config, issues } = parseConfigFile('{"defaultFormat":"html","model":"gpt-4o"}');
    expect(issues).toEqual([]);
    expect(config).toEqual({ defaultFormat: 'html', model: 'gpt-4o' });
  });

  it('reports invalid JSON without throwing', () => {
    const { config, issues } = parseConfigFile('{not json');
    expect(config).toEqual({});
    expect(issues[0]).toContain('not valid JSON');
  });

  it('rejects unknown keys so typos surface', () => {
    const { config, issues } = parseConfigFile('{"defaultFromat":"html"}');
    expect(config).toEqual({});
    expect(issues.join(' ')).toMatch(/unrecognized|defaultFromat/i);
  });

  it('rejects out-of-range values', () => {
    expect(parseConfigFile('{"defaultFormat":"pdf"}').issues).not.toEqual([]);
    expect(parseConfigFile('{"requestTimeoutMs":-1}').issues).not.toEqual([]);
  });

  it('accepts a pricing table', () => {
    const { config, issues } = parseConfigFile(
      '{"pricing":{"gpt-4o":{"inputPerMTok":2.5,"outputPerMTok":10}}}'
    );
    expect(issues).toEqual([]);
    expect(config.pricing).toEqual({ 'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 } });
  });

  it('treats an empty object as contributing nothing', () => {
    expect(parseConfigFile('{}')).toEqual({ config: {}, issues: [] });
  });
});

describe('environment resolution', () => {
  it('prefers the DocForge-specific key', () => {
    expect(resolveApiKey({ DOCFORGE_API_KEY: 'a', ANTHROPIC_API_KEY: 'b' })).toBe('a');
    expect(resolveApiKey({ OPENAI_API_KEY: 'c' })).toBe('c');
    expect(resolveApiKey({})).toBeUndefined();
  });

  it('infers the provider from whichever key is set', () => {
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'x' })).toBe('anthropic');
    expect(providerFromEnv({ OPENAI_API_KEY: 'x' })).toBe('openai');
    expect(providerFromEnv({ DOCFORGE_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'x' })).toBe('openai');
    expect(providerFromEnv({})).toBeUndefined();
  });

  it('enables AI when a key is present', () => {
    expect(configFromEnv({ ANTHROPIC_API_KEY: 'x' }).aiEnabled).toBe(true);
    expect(configFromEnv({}).aiEnabled).toBeUndefined();
  });

  it('reads a timeout override, ignoring nonsense', () => {
    expect(configFromEnv({ DOCFORGE_TIMEOUT_MS: '5000' }).requestTimeoutMs).toBe(5000);
    expect(configFromEnv({ DOCFORGE_TIMEOUT_MS: 'soon' }).requestTimeoutMs).toBeUndefined();
    expect(configFromEnv({ DOCFORGE_TIMEOUT_MS: '-1' }).requestTimeoutMs).toBeUndefined();
  });
});

describe('resolveConfig precedence', () => {
  it('defaults when nothing is supplied', () => {
    expect(resolveConfig().config).toEqual(DEFAULT_CONFIG);
  });

  it('layers the config file over the defaults', () => {
    const { config, usedFile } = resolveConfig({ fileContents: '{"defaultFormat":"html"}' });
    expect(config.defaultFormat).toBe('html');
    expect(config.defaultTone).toBe(DEFAULT_CONFIG.defaultTone);
    expect(usedFile).toBe(true);
  });

  it('lets the environment beat the config file', () => {
    const { config } = resolveConfig({
      fileContents: '{"model":"from-file"}',
      env: { DOCFORGE_MODEL: 'from-env' }
    });
    expect(config.model).toBe('from-env');
  });

  it('lets explicit overrides beat everything', () => {
    const { config } = resolveConfig({
      fileContents: '{"model":"from-file"}',
      env: { DOCFORGE_MODEL: 'from-env' },
      overrides: { model: 'from-flag' }
    });
    expect(config.model).toBe('from-flag');
  });

  it('degrades to defaults when the file is broken, and reports why', () => {
    const { config, issues, usedFile } = resolveConfig({ fileContents: 'nonsense' });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(issues).toHaveLength(1);
    expect(usedFile).toBe(false);
  });

  it('does not treat an absent file as an empty file', () => {
    expect(resolveConfig({ fileContents: undefined }).usedFile).toBe(false);
    expect(resolveConfig({ fileContents: '{}' }).usedFile).toBe(false);
  });

  it('keeps loadConfig working without a file', () => {
    expect(loadConfig({ DOCFORGE_FORMAT: 'html' }).defaultFormat).toBe('html');
  });
});
