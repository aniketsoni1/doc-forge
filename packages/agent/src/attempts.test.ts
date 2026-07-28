import { describe, expect, it } from 'vitest';
import { parseDocSpec, DocForgeError } from '@dfg/core';
import { MockGenerator, abortError } from '@dfg/testing';
import { createTemplateGenerator } from '@dfg/generator-template';
import { resolveAndGenerate } from './ladder';
import { explainFallback, failedAttempts, formatAttemptTrail, isSuccess } from './attempts';

const spec = parseDocSpec({ prompt: 'Report on widget sales' });
const template = createTemplateGenerator();

/** A deterministic clock so attempt durations are assertable. */
function fakeClock(): () => number {
  let t = 0;
  return () => (t += 10);
}

describe('attempt recording', () => {
  it('records a single successful attempt when the first generator works', async () => {
    const outcome = await resolveAndGenerate(spec, {
      generators: [template],
      now: fakeClock()
    });
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.status).toBe('succeeded');
    expect(outcome.fallbackSummary).toBeUndefined();
  });

  it('records why a failing generator was passed over', async () => {
    const broken = new MockGenerator({
      id: 'broken',
      label: 'Broken model',
      throwOnGenerate: new Error('upstream exploded')
    });
    const outcome = await resolveAndGenerate(spec, {
      generators: [broken, template],
      now: fakeClock()
    });

    expect(outcome.attempts).toHaveLength(2);
    const [first, second] = outcome.attempts;
    expect(first?.status).toBe('failed_error');
    expect(first?.errorCode).toBe('unknown');
    expect(first?.errorMessage).toContain('upstream exploded');
    expect(first?.recovery).toBeTruthy();
    expect(second?.status).toBe('succeeded');
    expect(outcome.result.generatorUsed).toBe('template');
  });

  it('distinguishes unavailable from offline-skipped', async () => {
    const unavailable = new MockGenerator({ id: 'gone', available: false, detail: 'not installed' });
    const networked = new MockGenerator({ id: 'net', requiresNetwork: true });

    const outcome = await resolveAndGenerate(spec, {
      generators: [unavailable, networked, template],
      allowNetwork: false,
      now: fakeClock()
    });

    expect(outcome.attempts[0]?.status).toBe('skipped_unavailable');
    expect(outcome.attempts[0]?.fallbackReason).toBe('not installed');
    expect(outcome.attempts[1]?.status).toBe('skipped_offline');
    expect(outcome.attempts[2]?.status).toBe('succeeded');
  });

  it('records a repair that rescued the output', async () => {
    // No H1 - fails the markdown lint, but a bounded repair can add one.
    const messy = new MockGenerator({ id: 'messy', content: 'no heading here\n' });
    const outcome = await resolveAndGenerate(spec, {
      generators: [messy],
      now: fakeClock()
    });

    const attempt = outcome.attempts[0];
    expect(attempt?.status).toBe('succeeded_after_repair');
    expect(attempt?.repairAttempted).toBe(true);
    expect(attempt?.repairSucceeded).toBe(true);
    expect(attempt?.validationIssues?.join(' ')).toContain('require-h1');
    expect(outcome.result.meta.repaired).toBe(true);
  });

  it('repairs hostile HTML into inert text rather than passing it through', async () => {
    // Sanitization empties this, so repair escapes it into visible text. The
    // document is still produced, but the script can never execute.
    const hostile = new MockGenerator({
      id: 'hostile',
      format: 'html',
      content: '<script>alert(1)</script>'
    });
    const outcome = await resolveAndGenerate(parseDocSpec({ prompt: 'x', format: 'html' }), {
      generators: [hostile, template],
      now: fakeClock()
    });

    const attempt = outcome.attempts[0];
    expect(attempt?.status).toBe('succeeded_after_repair');
    expect(attempt?.validationIssues?.join(' ')).toContain('html-empty');
    expect(outcome.document.deliverable).not.toContain('<script');
    expect(outcome.document.deliverable).toContain('&lt;script&gt;');
  });

  it('records timings from the injected clock', async () => {
    const outcome = await resolveAndGenerate(spec, { generators: [template], now: fakeClock() });
    expect(outcome.attempts[0]?.durationMs).toBeGreaterThan(0);
    expect(outcome.result.meta.durationMs).toBeGreaterThan(0);
  });

  it('still populates fellBackFrom for backwards compatibility', async () => {
    const broken = new MockGenerator({ id: 'broken', throwOnGenerate: true });
    const outcome = await resolveAndGenerate(spec, { generators: [broken, template] });
    expect(outcome.result.meta.fellBackFrom).toEqual(['broken']);
  });

  it('names every generator it tried when none can produce a document', async () => {
    const a = new MockGenerator({ id: 'a', label: 'Alpha', throwOnGenerate: new Error('nope') });
    await expect(resolveAndGenerate(spec, { generators: [a] })).rejects.toThrow(/Alpha/);
  });
});

describe('cancellation', () => {
  it('stops the ladder instead of silently falling back to templates', async () => {
    const controller = new AbortController();
    const slow = new MockGenerator({ id: 'slow', honorSignal: true });
    controller.abort();

    await expect(
      resolveAndGenerate(spec, { generators: [slow, template], signal: controller.signal })
    ).rejects.toThrow(DocForgeError);
  });

  it('reports a cancelled attempt rather than an error', async () => {
    const cancelling = new MockGenerator({ id: 'c', throwOnGenerate: abortError() });
    await expect(
      resolveAndGenerate(spec, { generators: [cancelling, template] })
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('forwards the signal to the generator', async () => {
    const controller = new AbortController();
    const gen = new MockGenerator({ id: 'g' });
    await resolveAndGenerate(spec, { generators: [gen], signal: controller.signal });
    expect(gen.lastOptions?.signal).toBe(controller.signal);
  });

  it('forwards streaming chunks to the caller', async () => {
    const chunks: string[] = [];
    const gen = new MockGenerator({ id: 'g', chunks: ['# A', '\n\nbody'] });
    await resolveAndGenerate(spec, {
      generators: [gen],
      onChunk: (c) => chunks.push(c)
    });
    expect(chunks).toEqual(['# A', '\n\nbody']);
  });
});

describe('attempt helpers', () => {
  it('classifies success', () => {
    expect(isSuccess({ generatorId: 'a', status: 'succeeded', durationMs: 1 })).toBe(true);
    expect(isSuccess({ generatorId: 'a', status: 'succeeded_after_repair', durationMs: 1 })).toBe(
      true
    );
    expect(isSuccess({ generatorId: 'a', status: 'failed_error', durationMs: 1 })).toBe(false);
  });

  it('lists only the failures', () => {
    const attempts = [
      { generatorId: 'a', status: 'failed_error' as const, durationMs: 1 },
      { generatorId: 'b', status: 'succeeded' as const, durationMs: 1 }
    ];
    expect(failedAttempts(attempts).map((a) => a.generatorId)).toEqual(['a']);
  });

  it('stays quiet when nothing interesting was skipped', () => {
    expect(
      explainFallback([
        { generatorId: 'a', status: 'skipped_unavailable', durationMs: 1 },
        { generatorId: 'b', status: 'succeeded', durationMs: 1 }
      ])
    ).toBeUndefined();
  });

  it('explains real fallbacks', () => {
    const summary = explainFallback([
      { generatorId: 'a', label: 'Alpha', status: 'failed_error', durationMs: 1, fallbackReason: 'rate limited' },
      { generatorId: 'b', status: 'succeeded', durationMs: 1 }
    ]);
    expect(summary).toBe('Alpha: rate limited');
  });

  it('formats a readable trail', () => {
    const trail = formatAttemptTrail([
      {
        generatorId: 'a',
        status: 'failed_error',
        durationMs: 12,
        errorCode: 'auth',
        errorMessage: 'Unauthorized',
        recovery: 'Check the key.'
      },
      { generatorId: 'template', status: 'succeeded', durationMs: 3 }
    ]);
    expect(trail).toContain('a → failed_error (12ms)');
    expect(trail).toContain('auth: Unauthorized');
    expect(trail).toContain('→ Check the key.');
    expect(trail).toContain('template → succeeded');
  });
});
