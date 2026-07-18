import type { Capability, DocResult, DocSpec, Generator } from '@dfg/core';
import { composeMarkdown, extractSections } from '@dfg/templates';
import { renderMarkdown } from '@dfg/render';
import { normalizeMarkdown, sanitizeDocumentHtml } from '@dfg/sanitize';

/**
 * The deterministic fallback generator. Always available, fully offline, and the
 * path the test suite exercises. Builds documents from templates + prompt heuristics.
 */
export class TemplateGenerator implements Generator {
  readonly id = 'template';

  capability(): Promise<Capability> {
    return Promise.resolve({
      id: 'template',
      available: true,
      label: 'Built-in templates',
      detail: 'Deterministic, offline document templates',
      requiresNetwork: false
    });
  }

  generate(spec: DocSpec): Promise<DocResult> {
    const { markdown } = composeMarkdown(spec);
    const normalized = normalizeMarkdown(markdown);
    const sections = extractSections(normalized);
    const warnings: string[] = [];

    if (spec.format === 'md') {
      return Promise.resolve({
        content: normalized,
        format: 'md',
        generatorUsed: this.id,
        warnings,
        meta: { sections }
      });
    }

    // For HTML, emit a sanitized *fragment*; @dfg/agent applies the final themed
    // document scaffold uniformly for every generator.
    const fragment = renderMarkdown(normalized);
    const { html } = sanitizeDocumentHtml(fragment);
    return Promise.resolve({
      content: html,
      format: 'html',
      generatorUsed: this.id,
      warnings,
      meta: { sections }
    });
  }
}

export function createTemplateGenerator(): TemplateGenerator {
  return new TemplateGenerator();
}
