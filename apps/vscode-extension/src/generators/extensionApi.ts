import * as vscode from 'vscode';
import type { Capability, DocResult, DocSpec, Generator } from '@dfg/core';

/** A documented, opt-in surface a third-party AI extension may expose. */
interface DocForgeCompatibleApi {
  generateDocument(request: { prompt: string; format: string; tone: string; length: string }): Promise<string>;
}

interface KnownExtension {
  id: string;
  label: string;
}

const KNOWN_EXTENSIONS: readonly KnownExtension[] = [
  { id: 'anthropic.claude-code', label: 'Claude' },
  { id: 'Continue.continue', label: 'Continue' }
];

function isCompatible(api: unknown): api is DocForgeCompatibleApi {
  return typeof (api as DocForgeCompatibleApi | undefined)?.generateDocument === 'function';
}

/**
 * Secondary, best-effort path: use another AI extension's *documented* exports if
 * it offers a compatible surface. Strictly guarded behind capability checks - we
 * never assume another extension's internals. Prefer {@link LmApiGenerator}.
 */
export class ExtensionGenerator implements Generator {
  readonly id = 'extension';

  private async findCompatible(): Promise<{ api: DocForgeCompatibleApi; label: string } | undefined> {
    for (const known of KNOWN_EXTENSIONS) {
      const ext = vscode.extensions.getExtension(known.id);
      if (!ext) continue;
      const api: unknown = ext.isActive
        ? ext.exports
        : await Promise.resolve(ext.activate()).catch(() => undefined);
      if (isCompatible(api)) return { api, label: known.label };
    }
    return undefined;
  }

  async capability(): Promise<Capability> {
    const found = await this.findCompatible().catch(() => undefined);
    return {
      id: this.id,
      available: Boolean(found),
      label: found ? `${found.label} extension` : 'AI extension (none compatible)',
      detail: found ? undefined : 'No installed extension exposes a compatible generateDocument() API',
      requiresNetwork: true
    };
  }

  async generate(spec: DocSpec): Promise<DocResult> {
    const found = await this.findCompatible();
    if (!found) throw new Error('No compatible AI extension is available.');
    const content = await found.api.generateDocument({
      prompt: spec.prompt,
      format: spec.format,
      tone: spec.tone,
      length: spec.length
    });
    return {
      content,
      format: spec.format,
      generatorUsed: `extension:${found.label.toLowerCase()}`,
      warnings: [],
      meta: {}
    };
  }
}
