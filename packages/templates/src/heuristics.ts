/** Structured facts parsed deterministically from a free-text prompt. */
export interface PromptAnalysis {
  /** Best-effort document title. */
  title: string;
  /** Cleaned subject phrase (prompt minus leading verbs/articles). */
  topic: string;
  /** Explicit or template-derived section headings (may be empty). */
  requestedSections: string[];
  /** Bullet-like items pulled from the prompt (e.g. after "features:"). */
  bullets: string[];
  /** Salient keywords in first-seen order. */
  keywords: string[];
  /** A proper-noun name if the prompt says "called X" / "named X". */
  name?: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'my', 'our',
  'that', 'this', 'is', 'are', 'be', 'it', 'as', 'by', 'at', 'from', 'about', 'into',
  'write', 'create', 'generate', 'make', 'draft', 'produce', 'compose', 'build',
  'prepare', 'please', 'me', 'document', 'page', 'post', 'me', 'using', 'called', 'named'
]);

const LEADING_VERB_RE =
  /^\s*(?:please\s+)?(?:write|create|generate|make|draft|produce|compose|build|prepare|give\s+me)\s+(?:me\s+)?(?:an?|the|some)?\s*/i;

const FORMAT_NOUN_RE =
  /^\s*(?:readme(?:\s+file)?|read\s*me|blog\s+post|blog|article|report|analysis|landing\s+page|changelog|change\s*log|release\s+notes|cover\s+letter|letter|email|document)\s+(?:for|about|on|titled|named|called)\s+/i;

function titleCase(input: string): string {
  const small = new Set(['a', 'an', 'and', 'the', 'for', 'of', 'or', 'to', 'in', 'on', 'with']);
  const words = input.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i !== 0 && small.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Extract a proper name from "called X" / "named X" / quoted phrases. */
function extractName(prompt: string): string | undefined {
  const quoted = /(?:called|named|titled)\s+["']([^"']{2,60})["']/i.exec(prompt);
  if (quoted?.[1]) return quoted[1].trim();
  // A capitalized name, possibly multi-word, ending before a lowercase word like "with".
  const proper = /(?:called|named|titled)\s+([A-Z0-9][\w-]*(?:\s+[A-Z0-9][\w-]*)*)/.exec(prompt);
  if (proper?.[1]) return proper[1].trim();
  // A single lowercase token as a last resort.
  const bare = /(?:called|named|titled)\s+([a-z][\w-]*)/.exec(prompt);
  if (bare?.[1]) return bare[1].trim();
  const anyQuoted = /["']([^"']{2,60})["']/.exec(prompt);
  if (anyQuoted?.[1]) return anyQuoted[1].trim();
  return undefined;
}

/** Pull bullet items from patterns like "features: a, b, c" or "including x, y and z". */
function extractBullets(prompt: string): string[] {
  const labelled =
    /(?:features?|sections?|topics?|points?|including|covering|cover|about)\s*[:-]?\s*([^.]*)/i.exec(prompt);
  if (!labelled?.[1]) return [];
  const list = labelled[1]
    .split(/,|;| and | & |\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 60);
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item.replace(/\s+/g, ' '));
    }
  }
  return out.slice(0, 8);
}

function extractKeywords(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out.slice(0, 12);
}

function deriveTopic(prompt: string): string {
  let topic = prompt.trim();
  const formatMatch = FORMAT_NOUN_RE.exec(topic);
  if (formatMatch) {
    topic = topic.slice(formatMatch[0].length);
  } else {
    topic = topic.replace(LEADING_VERB_RE, '');
    topic = topic.replace(/^\s*(?:readme|blog\s+post|blog|article|report|landing\s+page|changelog|release\s+notes|cover\s+letter|letter|email)\s+/i, '');
  }
  topic = topic.replace(/\bfor\s+me\b/gi, '').replace(/[.\s]+$/g, '').trim();
  // A trailing feature/detail clause is captured separately as bullets; drop it
  // from the topic so titles and prose stay concise.
  topic = topic.replace(/\bfeatures?\s*:.*$/i, '').trim();
  topic = topic.replace(/\b(?:with|including|featuring|covering|that\s+(?:has|includes))\b.*$/i, '').trim();
  topic = topic.replace(/[,:;]\s*$/, '').trim();
  return topic || prompt.trim();
}

/** Analyze a prompt into deterministic, template-ready facts. */
export function analyzePrompt(prompt: string, explicitTitle?: string): PromptAnalysis {
  const name = extractName(prompt);
  const topic = deriveTopic(prompt);
  const bullets = extractBullets(prompt);
  const keywords = extractKeywords(prompt);

  let title = explicitTitle?.trim() || name || '';
  if (!title) {
    const titleSource = topic.replace(/^(?:a|an|the)\s+/i, '');
    const short = titleSource.split(/\s+/).slice(0, 8).join(' ');
    title = titleCase(short);
  }
  if (!title) title = 'Untitled Document';

  return {
    title,
    topic,
    requestedSections: bullets.length ? bullets.map(titleCase) : [],
    bullets,
    keywords,
    ...(name ? { name } : {})
  };
}
