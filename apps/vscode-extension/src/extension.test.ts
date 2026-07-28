import { describe, expect, it } from 'vitest';
import type { GenerationAttempt } from '@dfg/agent';
import { parseInboundMessage, RequestTracker } from './protocol';
import { describeFailure, describeFallback, formatDiagnostics } from './errors';
import { defaultFileName, extensionFor, filtersFor, languageFor } from './naming';
import { createNonce, renderWebviewHtml } from './webview';

describe('parseInboundMessage', () => {
  it('accepts every known message', () => {
    for (const type of ['insert', 'save', 'regenerate', 'cancel', 'copy']) {
      expect(parseInboundMessage({ type, requestId: 1 })).toEqual({ type, requestId: 1 });
    }
  });

  it('rejects unknown message types', () => {
    expect(parseInboundMessage({ type: 'deleteEverything', requestId: 1 })).toBeUndefined();
  });

  it('rejects messages with no request id', () => {
    expect(parseInboundMessage({ type: 'save' })).toBeUndefined();
  });

  it('rejects a non-numeric or non-finite request id', () => {
    expect(parseInboundMessage({ type: 'save', requestId: '1' })).toBeUndefined();
    expect(parseInboundMessage({ type: 'save', requestId: Number.NaN })).toBeUndefined();
    expect(parseInboundMessage({ type: 'save', requestId: Infinity })).toBeUndefined();
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'save', 42, [], true]) {
      expect(parseInboundMessage(value)).toBeUndefined();
    }
  });

  it('strips unexpected extra properties rather than passing them through', () => {
    const parsed = parseInboundMessage({ type: 'save', requestId: 3, evil: 'payload' });
    expect(parsed).toEqual({ type: 'save', requestId: 3 });
    expect(parsed && 'evil' in parsed).toBe(false);
  });

  it('is not fooled by a prototype-shaped object', () => {
    expect(parseInboundMessage(Object.create({ type: 'save', requestId: 1 }))).toBeUndefined();
  });
});

describe('RequestTracker', () => {
  it('treats the newest request as current', () => {
    const tracker = new RequestTracker();
    const first = tracker.next();
    expect(tracker.isCurrent(first)).toBe(true);
  });

  it('invalidates a superseded request so a stale result can be dropped', () => {
    const tracker = new RequestTracker();
    const first = tracker.next();
    const second = tracker.next();
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
    expect(tracker.latest).toBe(second);
  });

  it('starts with no current request', () => {
    expect(new RequestTracker().isCurrent(1)).toBe(false);
  });
});

describe('describeFailure', () => {
  const failed: GenerationAttempt = {
    generatorId: 'byok:anthropic',
    label: 'BYO key (anthropic)',
    status: 'failed_error',
    durationMs: 12,
    errorCode: 'auth',
    errorMessage: 'Anthropic API error 401',
    recovery: 'Check the API key.'
  };

  it('names the failing provider and the cause', () => {
    const described = describeFailure(new Error('boom'), [failed]);
    expect(described.message).toContain('BYO key (anthropic) failed');
    expect(described.message).toContain('401');
    expect(described.recovery).toBe('Check the API key.');
  });

  it('reassures that nothing was written', () => {
    expect(describeFailure(new Error('boom'), []).dataPreserved).toMatch(/no files/i);
  });

  it('degrades gracefully with no attempt trail', () => {
    const described = describeFailure(new Error('boom'));
    expect(described.message).toContain('boom');
    expect(described.recovery).toBeTruthy();
  });

  it('handles a non-Error throw', () => {
    expect(describeFailure('a string').message).toContain('a string');
  });
});

describe('describeFallback', () => {
  it('stays silent when the first choice succeeded', () => {
    expect(
      describeFallback([{ generatorId: 'lm-api', status: 'succeeded', durationMs: 1 }])
    ).toBeUndefined();
  });

  it('ignores generators that were merely unavailable', () => {
    expect(
      describeFallback([
        { generatorId: 'lm-api', status: 'skipped_unavailable', durationMs: 1 },
        { generatorId: 'template', status: 'succeeded', durationMs: 1 }
      ])
    ).toBeUndefined();
  });

  it('reports a real failure', () => {
    const note = describeFallback([
      {
        generatorId: 'byok',
        label: 'BYO key',
        status: 'failed_error',
        durationMs: 1,
        errorMessage: 'rate limited'
      },
      { generatorId: 'template', status: 'succeeded', durationMs: 1 }
    ]);
    expect(note).toContain('BYO key');
    expect(note).toContain('rate limited');
  });

  it('counts additional failures rather than listing them all', () => {
    const note = describeFallback([
      { generatorId: 'a', status: 'failed_error', durationMs: 1, errorMessage: 'x' },
      { generatorId: 'b', status: 'failed_error', durationMs: 1, errorMessage: 'y' },
      { generatorId: 'c', status: 'failed_validation', durationMs: 1 }
    ]);
    expect(note).toContain('+2 more');
  });
});

describe('formatDiagnostics', () => {
  it('renders a numbered trail with causes and next steps', () => {
    const text = formatDiagnostics([
      {
        generatorId: 'byok',
        label: 'BYO key',
        status: 'failed_error',
        durationMs: 30,
        errorCode: 'rate_limit',
        errorMessage: '429',
        recovery: 'Wait and retry.'
      },
      {
        generatorId: 'template',
        status: 'succeeded_after_repair',
        durationMs: 2,
        repairAttempted: true,
        repairSucceeded: true
      }
    ]);
    expect(text).toContain('1. BYO key → failed_error (30ms)');
    expect(text).toContain('cause: rate_limit');
    expect(text).toContain('next: Wait and retry.');
    expect(text).toContain('repair: succeeded');
  });

  it('says so when there is nothing to report', () => {
    expect(formatDiagnostics([])).toContain('No generation attempts');
  });
});

describe('naming', () => {
  it('maps formats to extensions and languages', () => {
    expect(extensionFor('md')).toBe('md');
    expect(extensionFor('html')).toBe('html');
    expect(languageFor('md')).toBe('markdown');
    expect(languageFor('html')).toBe('html');
    expect(filtersFor('html')).toEqual({ HTML: ['html'] });
  });

  it('slugifies a title', () => {
    expect(defaultFileName('Q3 Sales Performance', 'md')).toBe('q3-sales-performance.md');
    expect(defaultFileName('Hello, World!', 'html')).toBe('hello-world.html');
  });

  it('falls back when a title slugifies to nothing', () => {
    expect(defaultFileName('!!!', 'md')).toBe('document.md');
    expect(defaultFileName('', 'md')).toBe('document.md');
  });

  it('cannot be steered out of the target folder by a hostile title', () => {
    const name = defaultFileName('../../etc/passwd', 'md');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toBe('etc-passwd.md');
  });

  it('bounds the filename length', () => {
    expect(defaultFileName('a'.repeat(500), 'md').length).toBeLessThanOrEqual(63);
  });
});

describe('renderWebviewHtml', () => {
  const base = {
    title: 'Report',
    bodyHtml: '<p>hello</p>',
    provenance: 'Generating with: Built-in templates',
    format: 'md' as const,
    nonce: 'testnonce',
    cspSource: 'vscode-resource:'
  };

  it('sets a strict CSP with no unsafe-inline', () => {
    const html = renderWebviewHtml(base);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("style-src 'nonce-testnonce'");
    expect(html).toContain("script-src 'nonce-testnonce'");
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
  });

  it('escapes the title and provenance', () => {
    const html = renderWebviewHtml({
      ...base,
      title: '<img src=x onerror=alert(1)>',
      provenance: '<script>bad</script>'
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>bad');
    expect(html).toContain('&lt;script&gt;bad');
  });

  it('escapes the fallback note and summary', () => {
    const html = renderWebviewHtml({
      ...base,
      fallbackNote: '<b>note</b>',
      summary: '<b>summary</b>'
    });
    expect(html).not.toContain('<b>note</b>');
    expect(html).toContain('&lt;b&gt;note');
  });

  it('embeds the already-sanitized body as-is', () => {
    expect(renderWebviewHtml(base)).toContain('<p>hello</p>');
  });

  it('omits the optional chrome elements when not supplied', () => {
    // The class names always appear in the stylesheet; assert on the markup.
    const html = renderWebviewHtml(base);
    expect(html).not.toContain('<div class="df-note">');
    expect(html).not.toContain('<div class="df-summary">');
  });

  it('renders the optional chrome elements when supplied', () => {
    const html = renderWebviewHtml({ ...base, fallbackNote: 'fell back', summary: '3 tokens' });
    expect(html).toContain('<div class="df-note">fell back</div>');
    expect(html).toContain('<div class="df-summary">3 tokens</div>');
  });

  it('offers the full action set with a hidden cancel button', () => {
    const html = renderWebviewHtml(base);
    for (const id of ['df-insert', 'df-save', 'df-copy', 'df-regen', 'df-cancel']) {
      expect(html).toContain(id);
    }
    expect(html).toContain('id="df-cancel" type="button" class="secondary" hidden');
  });

  it('labels the toolbar for assistive technology', () => {
    const html = renderWebviewHtml(base);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="DocForge actions"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe('createNonce', () => {
  it('produces a 32-character alphanumeric nonce', () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('produces a different value each time', () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
