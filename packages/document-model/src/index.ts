export type { Section, DocumentOutline } from './types';
export { sectionBody, sectionText, findBySlug, sectionAt } from './types';

export {
  parseMarkdownOutline,
  replaceSection,
  headingText,
  slugify
} from './markdown';

export { parseHtmlOutline, replaceHtmlSection } from './html';

export { parseOutline, replaceSectionIn } from './outline';
