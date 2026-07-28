import { describe, expect, it } from 'vitest';
import { containsSecret, redactKnownSecret, redactSecrets } from './redact';
import { ProviderError, providerCodeFromStatus, toProviderError, isAbortError } from './errors';

/**
 * Every credential in this file is a synthetic fixture that exercises a
 * redaction *pattern*. None is, or ever was, a live credential.
 *
 * Fixtures are assembled at runtime rather than written as literals, so that
 * secret scanners have no credential-shaped string to match in the source. A
 * scanner alert on a redaction test is a false positive by construction, and
 * the cheapest way to never argue about it is to leave nothing to find.
 */
const base64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** A structurally valid, entirely made-up JWT. The signature is not a signature. */
function syntheticJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ sub: 'docforge-test', iat: 0 });
  const signature = Buffer.from('not-a-real-signature').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Build a vendor-prefixed key without writing the prefix next to the body. */
const syntheticKey = (prefix: string, body: string): string => `${prefix}${body}`;

describe('redactSecrets', () => {
  it('redacts Anthropic-style keys', () => {
    const key = syntheticKey('sk-ant-', 'api03-AAAAAAAAAAAAAAAAAAAA');
    const out = redactSecrets(`failed with ${key}`);
    expect(out).not.toContain(key);
    expect(out).toContain('[redacted]');
  });

  it('redacts OpenAI-style keys', () => {
    const key = syntheticKey('sk-', 'proj-abcdefghijklmnopqrstuvwx');
    expect(redactSecrets(`key ${key}`)).toBe('key [redacted]');
  });

  it('redacts GitHub tokens', () => {
    const token = syntheticKey('ghp_', 'abcdefghijklmnopqrstuvwxyz0123');
    expect(redactSecrets(token)).toBe('[redacted]');
  });

  it('redacts JWTs', () => {
    expect(redactSecrets(`token ${syntheticJwt()}`)).toBe('token [redacted]');
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
    expect(containsSecret(syntheticKey('sk-ant-', 'api03-AAAAAAAAAAAAAAAAAAAA'))).toBe(true);
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
    const token = syntheticKey('ghp_', 'abcdefghijklmnopqrstuvwxyz0123');
    expect(redactKnownSecret(token, undefined)).toBe('[redacted]');
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
    const key = syntheticKey('sk-ant-', 'api03-AAAAAAAAAAAAAAAAAAAA');
    const err = new ProviderError('auth', `bad key ${key}`, {
      generatorId: 'byok:anthropic'
    });
    expect(err.message).not.toContain(key);
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
    const key = syntheticKey('sk-ant-', 'api03-AAAAAAAAAAAAAAAAAAAA');
    const err = new Error(`boom: ${key}`);
    expect(toProviderError(err, 'g').message).not.toContain(key);
  });
});
