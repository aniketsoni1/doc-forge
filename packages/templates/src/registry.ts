import type { DocSpec } from '@dfg/core';
import type { Template, TemplateSummary } from './types';
import { analyzePrompt, type PromptAnalysis } from './heuristics';
import { PRESETS } from './presets';

const BY_ID = new Map<string, Template>(PRESETS.map((t) => [t.id, t]));

/** Extra inference keywords per template id (beyond id + aliases). */
const INFERENCE: Record<string, string[]> = {
  readme: ['readme', 'read me'],
  blog: ['blog', 'article', 'post'],
  report: ['report', 'analysis', 'memo', 'whitepaper', 'study'],
  landing: ['landing', 'marketing', 'product page', 'homepage', 'sales page'],
  changelog: ['changelog', 'change log', 'release notes', 'releases'],
  letter: ['letter', 'cover letter', 'email', 'dear ']
};

export function listTemplates(): TemplateSummary[] {
  return PRESETS.map((t) => ({ id: t.id, title: t.title, description: t.description }));
}

export function getTemplate(id: string): Template | undefined {
  const direct = BY_ID.get(id);
  if (direct) return direct;
  return PRESETS.find((t) => t.aliases.includes(id));
}

/** Choose the best template: explicit id if valid, otherwise inferred from the prompt. */
export function resolveTemplate(spec: DocSpec): Template {
  if (spec.template) {
    const found = getTemplate(spec.template);
    if (found) return found;
  }
  const prompt = spec.prompt.toLowerCase();
  let best: { template: Template; score: number } | undefined;
  for (const template of PRESETS) {
    const needles = [template.id, ...template.aliases, ...(INFERENCE[template.id] ?? [])];
    let score = 0;
    for (const needle of needles) {
      if (prompt.includes(needle.toLowerCase())) score += needle.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { template, score };
    }
  }
  return best?.template ?? getTemplate('report')!;
}

export interface ComposeResult {
  markdown: string;
  template: Template;
  analysis: PromptAnalysis;
}

/** Deterministically compose a Markdown document body from a spec. */
export function composeMarkdown(spec: DocSpec): ComposeResult {
  const analysis = analyzePrompt(spec.prompt, spec.title);
  const template = resolveTemplate(spec);
  const markdown = template.build({ spec, analysis });
  return { markdown, template, analysis };
}

/** Extract ATX H2 headings from a Markdown document, in order. */
export function extractSections(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}
