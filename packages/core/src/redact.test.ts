import { describe, expect, it } from 'vitest';
import { containsSecret, redactKnownSecret, redactSecrets } from './redact';
import { ProviderError, providerCodeFromStatus, toProviderError, isAbortError } from './errors';

describe('redactSecrets', () => {
  it('redacts Anthropic-style keys', () => {
    const out = redactSecrets('failed with sk-ant-api03-AAAAAAAAAAAAAAAAAAAA');
    expect(out).not.toContain('sk-ant-api03');
    expect(out).toContain('[redacted]');
  });

  it('redacts OpenAI-style keys', () => {
    expect(redactSecrets('key sk-proj-abcdefghijklmnopqrstuvwx')).toBe('key [redacted]');
  });

  it('redacts GitHub tokens', () => {
    expect(redactSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('[redacted]');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactSecrets(`token ${jwt}`)).toBe('token [redacted]');
  });

  it('redacts authorization headers while keeping the header name', () => {
    const out = redactSecrets('authorization: Bearer abcdef123456789');
    expect(out).toContain('authorization');
    expect(out).not.toContain('abcdef123456789');
  });

  it('redacts x-api-key headers', () => {
    const out = redactSecrets('{"x-api-key": "supersecretvalue123"}');
    expect(out).not.toContain('supersecretvalue123');
  });

  it('redacts generic key/secret assignments', () => {
    expect(redactSecrets('apiKey=hunter2hunter2')).not.toContain('hunter2hunter2');
    expect(redactSecrets('api_key: "abc123def456"')).not.toContain('abc123def456');
    expect(redactSecrets('password = correcthorse')).not.toContain('correcthorse');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'The request failed because the model was busy.';
    expect(redactSecrets(prose)).toBe(prose);
    expect(containsSecret(prose)).toBe(false);
  });

  it('detects that something was redacted', () => {
    expect(containsSecret('sk-ant-api03-AAAAAAAAAAAAAAAAAAAA')).toBe(true);
  });
});

describe('redactKnownSecret', () => {
  it('removes an exact known key even when it matches no pattern', () => {
    const out = redactKnownSecret('body contained zzz-not-a-known-shape', 'zzz-not-a-known-shape');
    expect(out).toBe('body contained [redacted]');
  });

  it('ignores implausibly short secrets to avoid mangling output', () => {
    expect(redactKnownSecret('a bit of text', 'a')).toBe('a bit of text');
  });

  it('still applies pattern rules when no known secret is supplied', () => {
    expect(redactKnownSecret('ghp_abcdefghijklmnopqrstuvwxyz0123', undefined)).toBe('[redacted]');
  });
});

describe('providerCodeFromStatus', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [404, 'unsupported_model'],
    [413, 'context_too_large'],
    [422, 'context_too_large'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'invalid_response'],
    [418, 'unknown']
  ])('maps %i to %s', (status, expected) => {
    expect(providerCodeFromStatus(status)).toBe(expected);
  });
});

describe('ProviderError', () => {
  it('redacts the message on construction', () => {
    const err = new ProviderError('auth', 'bad key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA', {
      generatorId: 'byok:anthropic'
    });
    expect(err.message).not.toContain('sk-ant-api03');
  });

  it('carries a recovery hint and retryability', () => {
    const rate = new ProviderError('rate_limit', 'too many', { generatorId: 'byok' });
    expect(rate.retryable).toBe(true);
    expect(rate.recovery).toMatch(/retry/i);

    const auth = new ProviderError('auth', 'nope', { generatorId: 'byok' });
    expect(auth.retryable).toBe(false);
  });

  it('exposes a stable code for host branching', () => {
    expect(new ProviderError('network', 'x', { generatorId: 'g' }).code).toBe('provider_network');
  });

  it('describes itself as failure plus next step', () => {
    const err = new ProviderError('auth', 'Unauthorized.', { generatorId: 'g' });
    expect(err.describe()).toContain('Unauthorized.');
    expect(err.describe()).toContain('API key');
  });
});

describe('toProviderError', () => {
  it('passes ProviderError through unchanged', () => {
    const original = new ProviderError('auth', 'x', { generatorId: 'g' });
    expect(toProviderError(original, 'other')).toBe(original);
  });

  it('classifies AbortError as cancelled', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
    expect(toProviderError(err, 'g').providerCode).toBe('cancelled');
  });

  it("classifies fetch's opaque failure as a network problem", () => {
    expect(toProviderError(new TypeError('fetch failed'), 'g').providerCode).toBe('network');
    expect(toProviderError(new Error('ECONNREFUSED'), 'g').providerCode).toBe('network');
  });

  it('falls back to unknown for anything else', () => {
    expect(toProviderError(new Error('weird'), 'g').providerCode).toBe('unknown');
    expect(toProviderError('a string', 'g').providerCode).toBe('unknown');
  });

  it('redacts secrets from arbitrary thrown errors', () => {
    const err = new Error('boom: sk-ant-api03-AAAAAAAAAAAAAAAAAAAA');
    expect(toProviderError(err, 'g').message).not.toContain('sk-ant-api03');
  });
});
