import * as vscode from 'vscode';
import type {
  Capability,
  DocResult,
  DocSpec,
  GenerateOptions,
  Generator
} from '@dfg/core';
import { ProviderError } from '@dfg/core';

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
      requiresNetwork: true,
      features: {
        // A third-party extension's surface is opaque: assume nothing.
        streaming: false,
        cancellation: false,
        costReporting: false,
        offline: false
      }
    };
  }

  async generate(spec: DocSpec, options: GenerateOptions = {}): Promise<DocResult> {
    const found = await this.findCompatible();
    if (!found) {
      throw new ProviderError('unavailable', 'No compatible AI extension is available.', {
        generatorId: this.id
      });
    }

    let content: string;
    try {
      content = await found.api.generateDocument({
        prompt: spec.prompt,
        format: spec.format,
        tone: spec.tone,
        length: spec.length
      });
    } catch (err) {
      throw new ProviderError(
        'unknown',
        `${found.label} extension failed: ${err instanceof Error ? err.message : String(err)}`,
        { generatorId: this.id, cause: err }
      );
    }

    // The third-party API takes no cancellation token, so the best we can do is
    // discard a result the user no longer wants rather than pretend to abort.
    if (options.signal?.aborted) {
      throw new ProviderError('cancelled', 'Generation was cancelled.', { generatorId: this.id });
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderError(
        'invalid_response',
        `${found.label} extension returned an empty document.`,
        { generatorId: this.id }
      );
    }

    return {
      content,
      format: spec.format,
      generatorUsed: `extension:${found.label.toLowerCase()}`,
      warnings: [],
      meta: {}
    };
  }
}
