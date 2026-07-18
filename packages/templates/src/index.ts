export { analyzePrompt } from './heuristics';
export type { PromptAnalysis } from './heuristics';

export type { Template, TemplateContext, TemplateSummary } from './types';
export { PRESETS } from './presets';

export {
  listTemplates,
  getTemplate,
  resolveTemplate,
  composeMarkdown,
  extractSections
} from './registry';
export type { ComposeResult } from './registry';

export {
  lead,
  sectionBody,
  paragraphsFor,
  extraSectionsFor
} from './prose';
