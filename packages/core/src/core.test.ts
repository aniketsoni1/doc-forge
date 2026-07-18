import { describe, expect, it } from 'vitest';
import { parseDocSpec, safeParseDocSpec } from './schema';
import { BUILTIN_TOOLS, WRITE_FILE_TOOL } from './permissions';
import { DocValidationError, GeneratorUnavailableError } from './errors';

describe('parseDocSpec', () => {
  it('applies defaults for a bare prompt', () => {
    const spec = parseDocSpec({ prompt: 'Write a README for my CLI' });
    expect(spec).toMatchObject({
      prompt: 'Write a README for my CLI',
      format: 'md',
      tone: 'neutral',
      length: 'medium',
      variables: {}
    });
    expect(spec.template).toBeUndefined();
  });

  it('trims the prompt and keeps explicit fields', () => {
    const spec = parseDocSpec({
      prompt: '  Landing page for Acme  ',
      format: 'html',
      tone: 'marketing',
      length: 'long',
      template: 'landing',
      title: 'Acme',
      variables: { product: 'Acme' }
    });
    expect(spec.prompt).toBe('Landing page for Acme');
    expect(spec.format).toBe('html');
    expect(spec.tone).toBe('marketing');
    expect(spec.template).toBe('landing');
    expect(spec.variables.product).toBe('Acme');
  });

  it('rejects an empty prompt', () => {
    const res = safeParseDocSpec({ prompt: '   ' });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown format', () => {
    const res = safeParseDocSpec({ prompt: 'x', format: 'pdf' });
    expect(res.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const res = safeParseDocSpec({ prompt: 'x', bogus: true });
    expect(res.success).toBe(false);
  });
});

describe('permission model', () => {
  it('flags file writes as requiring approval', () => {
    expect(WRITE_FILE_TOOL.requiresApproval).toBe(true);
    expect(WRITE_FILE_TOOL.network).toBe(false);
  });

  it('exposes the built-in tool descriptors', () => {
    expect(BUILTIN_TOOLS.some((t) => t.action === 'network')).toBe(true);
  });
});

describe('errors', () => {
  it('carries a stable code', () => {
    expect(new GeneratorUnavailableError('byok', 'no key').code).toBe('generator_unavailable');
    expect(new DocValidationError(['bad tag']).issues).toEqual(['bad tag']);
  });
});
