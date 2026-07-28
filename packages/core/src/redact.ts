/**
 * Credential redaction. Every provider error message, log line, and diagnostic
 * passes through here before it can reach a user-visible surface, so a leaked key
 * in an upstream error body never becomes a leaked key in the DocForge UI.
 *
 * Deliberately pattern-based and conservative: it is better to over-redact a
 * harmless string than to print a live key.
 */

const PLACEHOLDER = '[redacted]';

/** Ordered redaction rules. Each replaces the *secret* portion, keeping context. */
const RULES: ReadonlyArray<{ pattern: RegExp; replace: (match: string) => string }> = [
  // Vendor-prefixed keys: sk-..., sk-ant-..., ghp_..., xoxb-..., AIza...
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/g, replace: () => PLACEHOLDER },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: () => PLACEHOLDER },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, replace: () => PLACEHOLDER },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => PLACEHOLDER },
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}/g, replace: () => PLACEHOLDER },
  // Authorization / api-key headers, in plain text or JSON. The optional quote
  // after the header name is what makes `{"x-api-key": "…"}` match.
  {
    pattern: /(\b(?:authorization|x-api-key|api[_-]?key)\b["']?\s*[:=]\s*)(?:bearer\s+)?["']?[^\s"',;}]+/gi,
    replace: (m) => {
      const head = /^.*?[:=]\s*/.exec(m)?.[0] ?? '';
      return `${head}${PLACEHOLDER}`;
    }
  },
  // Generic credential-ish assignments: apiKey=…, api_key: "…", token = …
  // The name prefix is optional so a bare `apiKey` matches as well as `myApiKey`.
  {
    pattern: /(\b[A-Za-z0-9_]*(?:api[_-]?key|apikey|secret|token|password)\b["']?\s*[:=]\s*)["']?[^\s"',;}]+/gi,
    replace: (m) => {
      const head = /^.*?[:=]\s*/.exec(m)?.[0] ?? '';
      return `${head}${PLACEHOLDER}`;
    }
  },
  // JWTs.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => PLACEHOLDER }
];

/** Replace anything that looks like a credential in `input`. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => rule.replace(match));
  }
  return out;
}

/**
 * Redact a specific known secret by exact match, in addition to pattern rules.
 * Use when the host holds the key and wants a guarantee rather than a heuristic.
 */
export function redactKnownSecret(input: string, secret: string | undefined): string {
  const patterned = redactSecrets(input);
  if (!secret || secret.length < 8) return patterned;
  return patterned.split(secret).join(PLACEHOLDER);
}

/** True when `input` still contains something that looks like a credential. */
export function containsSecret(input: string): boolean {
  return redactSecrets(input) !== input;
}
