/** Result of splitting a document into simple front-matter and body. */
export interface FrontMatter {
  data: Record<string, string>;
  body: string;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a minimal `key: value` front-matter block. Intentionally not full YAML:
 * DocForge only needs flat string scalars, keeping this pure and dependency-free.
 */
export function parseFrontMatter(input: string): FrontMatter {
  const match = FRONT_MATTER_RE.exec(input);
  if (!match) {
    return { data: {}, body: input };
  }
  const block = match[1] ?? '';
  const data: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = unquote(line.slice(idx + 1).trim());
    if (key) data[key] = value;
  }
  // Drop a single blank line between the closing delimiter and the body.
  const body = input.slice(match[0].length).replace(/^\r?\n/, '');
  return { data, body };
}

function needsQuote(value: string): boolean {
  return /[:#]/.test(value) || value.trim() !== value || value === '';
}

/** Serialize flat string front-matter above a body. Emits nothing when data is empty. */
export function serializeFrontMatter(data: Record<string, string>, body: string): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return body;
  const lines = keys.map((key) => {
    const value = data[key] ?? '';
    return `${key}: ${needsQuote(value) ? JSON.stringify(value) : value}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
