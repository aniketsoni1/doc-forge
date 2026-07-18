import MarkdownIt from 'markdown-it';

export interface RenderMarkdownOptions {
  /** Allow raw HTML in the Markdown source. Output is sanitized downstream. Default true. */
  allowHtml?: boolean;
  /** Auto-convert bare URLs to links. Default true. */
  linkify?: boolean;
}

/** Build a deterministic markdown-it instance. Pure; no I/O. */
export function createMarkdownRenderer(options: RenderMarkdownOptions = {}): MarkdownIt {
  return new MarkdownIt({
    html: options.allowHtml ?? true,
    linkify: options.linkify ?? true,
    typographer: false,
    breaks: false
  });
}

/** Render a Markdown string to an HTML fragment (not a full document). */
export function renderMarkdown(markdown: string, options?: RenderMarkdownOptions): string {
  return createMarkdownRenderer(options).render(markdown);
}
