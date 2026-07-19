import type { Capability, DocResult, DocSpec, Generator } from '@dfg/core';
import { GeneratorUnavailableError } from '@dfg/core';

export type ByokProvider = 'anthropic' | 'openai';

export interface ByokOptions {
  provider?: ByokProvider;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
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
}

/** Strip a single wrapping ``` fence if the model added one. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fence?.[1] ?? trimmed;
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
  private readonly fetchImpl: typeof fetch;

  constructor(options: ByokOptions = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL[this.provider];
    this.maxTokens = options.maxTokens ?? 2048;
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
      requiresNetwork: true
    });
  }

  async generate(spec: DocSpec): Promise<DocResult> {
    if (!this.apiKey) {
      throw new GeneratorUnavailableError(this.id, 'no API key configured');
    }
    const prompt = this.buildPrompt(spec);
    const { text, usage } =
      this.provider === 'anthropic'
        ? await this.callAnthropic(prompt)
        : await this.callOpenAI(prompt);

    return {
      content: stripCodeFence(text),
      format: spec.format,
      generatorUsed: `${this.id}:${this.provider}`,
      warnings: [],
      meta: {
        tokens: usage.inputTokens + usage.outputTokens
      }
    };
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

  private async callAnthropic(prompt: string): Promise<{ text: string; usage: ChatUsage }> {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0
      }
    };
  }

  private async callOpenAI(prompt: string): Promise<{ text: string; usage: ChatUsage }> {
    const res = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey as string}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0
      }
    };
  }
}

export function createByokGenerator(options?: ByokOptions): ByokGenerator {
  return new ByokGenerator(options);
}
