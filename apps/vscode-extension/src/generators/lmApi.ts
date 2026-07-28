import * as vscode from 'vscode';
import type {
  Capability,
  DocResult,
  DocSpec,
  GenerateOptions,
  Generator
} from '@dfg/core';
import { ProviderError } from '@dfg/core';

function buildPrompt(spec: DocSpec): string {
  const target = spec.format === 'html' ? 'a complete, valid HTML5 document' : 'a Markdown document';
  return [
    `Produce ${target} for the following request.`,
    `Tone: ${spec.tone}. Length: ${spec.length}.`,
    spec.template ? `Follow the conventions of a "${spec.template}".` : '',
    'Output ONLY the document. No preamble, no code fences.',
    '',
    `Request: ${spec.prompt}`
  ]
    .filter(Boolean)
    .join('\n');
}

function stripFence(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(t);
  return m?.[1] ?? t;
}

/**
 * Preferred AI path: the sanctioned, vendor-neutral VS Code Language Model API.
 * Works with Copilot and any LM-API provider without coupling to a specific
 * extension's internals.
 */
export class LmApiGenerator implements Generator {
  readonly id = 'lm-api';

  constructor(private readonly selector: vscode.LanguageModelChatSelector = {}) {}

  async capability(): Promise<Capability> {
    try {
      const models = await vscode.lm.selectChatModels(this.selector);
      const model = models[0];
      return {
        id: this.id,
        available: Boolean(model),
        label: model
          ? `${model.vendor} · ${model.family} (VS Code LM API)`
          : 'VS Code LM API (no model)',
        detail: model ? model.name : 'No language model offered by the editor',
        requiresNetwork: true,
        features: {
          streaming: true,
          cancellation: true,
          modelDiscovery: true,
          systemPrompt: true,
          offline: false,
          costReporting: false,
          ...(model ? { maxContextTokens: model.maxInputTokens } : {})
        }
      };
    } catch {
      return { id: this.id, available: false, label: 'VS Code LM API', requiresNetwork: true };
    }
  }

  async generate(spec: DocSpec, options: GenerateOptions = {}): Promise<DocResult> {
    const models = await vscode.lm.selectChatModels(this.selector);
    const model = models[0];
    if (!model) {
      throw new ProviderError('unavailable', 'No language model available via the VS Code LM API.', {
        generatorId: this.id
      });
    }

    const messages = [vscode.LanguageModelChatMessage.User(buildPrompt(spec))];
    const source = new vscode.CancellationTokenSource();
    // Bridge the caller's AbortSignal onto the editor's cancellation token so a
    // cancel in the UI actually stops the in-flight model request.
    const onAbort = (): void => source.cancel();
    if (options.signal) {
      if (options.signal.aborted) source.cancel();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const response = await model.sendRequest(messages, {}, source.token);
      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
        options.onChunk?.(chunk);
      }
      if (source.token.isCancellationRequested) {
        throw new ProviderError('cancelled', 'Generation was cancelled.', {
          generatorId: this.id
        });
      }
      return {
        content: stripFence(text),
        format: spec.format,
        generatorUsed: `lm-api:${model.family}`,
        warnings: [],
        meta: { model: model.family }
      };
    } catch (err) {
      throw toLmProviderError(err, this.id, source.token.isCancellationRequested);
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      source.dispose();
    }
  }
}

/** Map a `LanguageModelError` (or anything else) onto DocForge's error taxonomy. */
function toLmProviderError(err: unknown, generatorId: string, cancelled: boolean): unknown {
  if (err instanceof ProviderError) return err;
  if (cancelled || (err instanceof vscode.CancellationError)) {
    return new ProviderError('cancelled', 'Generation was cancelled.', { generatorId, cause: err });
  }
  if (err instanceof vscode.LanguageModelError) {
    const code =
      err.code === vscode.LanguageModelError.NoPermissions().code
        ? 'auth'
        : err.code === vscode.LanguageModelError.Blocked().code
          ? 'content_rejected'
          : err.code === vscode.LanguageModelError.NotFound().code
            ? 'unsupported_model'
            : 'unknown';
    return new ProviderError(code, err.message, { generatorId, cause: err });
  }
  return err;
}
