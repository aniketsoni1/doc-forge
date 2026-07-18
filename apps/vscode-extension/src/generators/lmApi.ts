import * as vscode from 'vscode';
import type { Capability, DocResult, DocSpec, Generator } from '@dfg/core';

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
        requiresNetwork: true
      };
    } catch {
      return { id: this.id, available: false, label: 'VS Code LM API', requiresNetwork: true };
    }
  }

  async generate(spec: DocSpec): Promise<DocResult> {
    const models = await vscode.lm.selectChatModels(this.selector);
    const model = models[0];
    if (!model) throw new Error('No language model available via the VS Code LM API.');

    const messages = [vscode.LanguageModelChatMessage.User(buildPrompt(spec))];
    const source = new vscode.CancellationTokenSource();
    try {
      const response = await model.sendRequest(messages, {}, source.token);
      let text = '';
      for await (const chunk of response.text) text += chunk;
      return {
        content: stripFence(text),
        format: spec.format,
        generatorUsed: `lm-api:${model.family}`,
        warnings: [],
        meta: {}
      };
    } finally {
      source.dispose();
    }
  }
}
