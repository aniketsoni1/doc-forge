import type {
  Capability,
  DocResult,
  DocSpec,
  GenerateOptions,
  Generator
} from '@dfg/core';
import {
  GeneratorUnavailableError,
  ProviderError,
  isAbortError,
  providerCodeFromStatus,
  redactKnownSecret
} from '@dfg/core';
import { estimateCostUsd, estimateTokens, priceFor } from '@dfg/reporting';

export type ByokProvider = 'anthropic' | 'openai';

export interface ByokOptions {
  provider?: ByokProvider;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Abort an in-flight request after this many ms. Default 60000. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL: Record<ByokProvider, string> = {
  anthropic: 'claude-3-5-sonnet-latest',
  openai: 'gpt-4o-mini'
};

interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** False when DocForge estimated the counts because the API omitted usage. */
  exact: boolean;
}

/** Strip a single wrapping ``` fence if the model added one. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fence?.[1] ?? trimmed;
}

/**
 * Combine the caller's cancellation signal with an internal timeout, so a hung
 * provider connection can never hang the host indefinitely.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * Bring-your-own-key generator. Works in both the CLI and the extension. The key
 * is supplied by the host (SecretStorage / OS keychain / env) - never stored here.
 * Unavailable (not thrown) when no key is present, so the ladder falls through.
 */
export class ByokGenerator implements Generator {
  readonly id = 'byok';
  private readonly provider: ByokProvider;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ByokOptions = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL[this.provider];
    this.maxTokens = options.maxTokens ?? 2048;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  capability(): Promise<Capability> {
    const available = Boolean(this.apiKey) && typeof this.fetchImpl === 'function';
    return Promise.resolve({
      id: this.id,
      available,
      label: available
        ? `BYO key (${this.provider}:${this.model})`
        : 'BYO key (no API key configured)',
      detail: available ? undefined : 'Set DOCFORGE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY',
      requiresNetwork: true,
      features: {
        cancellation: true,
        costReporting: true,
        systemPrompt: true,
        offline: false
      }
    });
  }

  async generate(spec: DocSpec, options: GenerateOptions = {}): Promise<DocResult> {
    if (!this.apiKey) {
      throw new GeneratorUnavailableError(this.id, 'no API key configured');
    }
    const prompt = this.buildPrompt(spec);
    const { signal, dispose } = withTimeout(options.signal, this.timeoutMs);

    try {
      const { text, usage } =
        this.provider === 'anthropic'
          ? await this.callAnthropic(prompt, signal)
          : await this.callOpenAI(prompt, signal);

      const content = stripCodeFence(text);
      if (!content.trim()) {
        throw new ProviderError('invalid_response', 'The provider returned an empty document.', {
          generatorId: `${this.id}:${this.provider}`
        });
      }

      // When the API omits usage, fall back to an estimate - and say so, so the
      // host can label the number rather than presenting it as measured.
      const resolved: ChatUsage = usage.exact
        ? usage
        : {
            inputTokens: estimateTokens(prompt),
            outputTokens: estimateTokens(content),
            exact: false
          };

      const price = priceFor(this.provider, this.model);
      const costUsd = price
        ? estimateCostUsd(resolved.inputTokens, resolved.outputTokens, price)
        : undefined;

      return {
        content,
        format: spec.format,
        generatorUsed: `${this.id}:${this.provider}`,
        warnings: [],
        meta: {
          tokens: resolved.inputTokens + resolved.outputTokens,
          inputTokens: resolved.inputTokens,
          outputTokens: resolved.outputTokens,
          exactUsage: resolved.exact,
          model: this.model,
          ...(costUsd === undefined ? {} : { costUsd })
        }
      };
    } catch (err) {
      throw this.asProviderError(err, options.signal);
    } finally {
      dispose();
    }
  }

  /**
   * Translate transport and HTTP failures into a typed {@link ProviderError},
   * distinguishing a user cancellation from an internal timeout.
   */
  private asProviderError(err: unknown, callerSignal: AbortSignal | undefined): ProviderError {
    if (err instanceof ProviderError) return err;
    const generatorId = `${this.id}:${this.provider}`;

    if (isAbortError(err)) {
      return callerSignal?.aborted
        ? new ProviderError('cancelled', 'Generation was cancelled.', { generatorId, cause: err })
        : new ProviderError(
            'network',
            `The ${this.provider} request timed out after ${this.timeoutMs}ms.`,
            { generatorId, cause: err }
          );
    }

    const message = err instanceof Error ? err.message : String(err);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(message)) {
      return new ProviderError('network', `Could not reach ${this.provider}: ${message}`, {
        generatorId,
        cause: err
      });
    }
    return new ProviderError('unknown', message, { generatorId, cause: err });
  }

  /** Build a redacted, bounded error from a non-OK HTTP response. */
  private async httpError(res: Response): Promise<ProviderError> {
    // Provider error bodies can echo request context, so redact and truncate
    // before the text is allowed anywhere near a log or a notification.
    let detail: string;
    try {
      detail = redactKnownSecret(await res.text(), this.apiKey).slice(0, 300);
    } catch {
      // A body that cannot be read is not worth failing over; the status code
      // already carries the actionable part of the error.
      detail = '';
    }
    const label = this.provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
    return new ProviderError(
      providerCodeFromStatus(res.status),
      `${label} API error ${res.status}${detail ? `: ${detail}` : ''}`,
      { generatorId: `${this.id}:${this.provider}`, status: res.status }
    );
  }

  private buildPrompt(spec: DocSpec): string {
    const format =
      spec.format === 'html' ? 'a complete, valid HTML5 document' : 'a Markdown document';
    const bits = [
      `Produce ${format} for the following request.`,
      `Tone: ${spec.tone}. Length: ${spec.length}.`,
      spec.template ? `Follow the conventions of a "${spec.template}".` : '',
      'Output ONLY the document. No preamble, no explanation, no surrounding code fences.',
      '',
      `Request: ${spec.prompt}`
    ];
    return bits.filter(Boolean).join('\n');
  }

  private async callAnthropic(
    prompt: string,
    signal: AbortSignal
  ): Promise<{ text: string; usage: ChatUsage }> {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey as string,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw await this.httpError(res);
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const exact =
      typeof data.usage?.input_tokens === 'number' && typeof data.usage.output_tokens === 'number';
    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        exact
      }
    };
  }

  private async callOpenAI(
    prompt: string,
    signal: AbortSignal
  ): Promise<{ text: string; usage: ChatUsage }> {
    const res = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey as string}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw await this.httpError(res);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    const exact =
      typeof data.usage?.prompt_tokens === 'number' &&
      typeof data.usage.completion_tokens === 'number';
    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        exact
      }
    };
  }
}

export function createByokGenerator(options?: ByokOptions): ByokGenerator {
  return new ByokGenerator(options);
}
