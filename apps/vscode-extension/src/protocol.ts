/**
 * The typed message contract between the extension host and the preview webview.
 *
 * The webview is a presentation layer only: it never holds business logic, and
 * everything it sends is treated as untrusted input and validated here before the
 * host acts on it. Kept dependency-free so it can be shared by both sides and
 * unit-tested without a running editor.
 */

/** Messages the webview may send to the extension host. */
export type InboundMessage =
  | { type: 'insert'; requestId: number }
  | { type: 'save'; requestId: number }
  | { type: 'regenerate'; requestId: number }
  | { type: 'cancel'; requestId: number }
  | { type: 'copy'; requestId: number };

export type InboundMessageType = InboundMessage['type'];

/** Messages the host may send down to the webview. */
export type OutboundMessage =
  | { type: 'state'; busy: boolean }
  | { type: 'error'; message: string }
  /**
   * A partial, in-progress result. Explicitly marked as a draft: streamed text
   * has not been sanitized or validated yet, so the webview renders it as plain
   * text and never as HTML, and the host never writes it to disk.
   */
  | { type: 'draft'; text: string };

const INBOUND_TYPES: ReadonlySet<string> = new Set<InboundMessageType>([
  'insert',
  'save',
  'regenerate',
  'cancel',
  'copy'
]);

/**
 * Validate an untrusted value from `onDidReceiveMessage`.
 *
 * Returns undefined for anything that is not a well-formed known message, so the
 * host can ignore it rather than acting on a partially-shaped object. A
 * TypeScript annotation on the handler parameter is only a compile-time claim -
 * this is the runtime check that actually holds.
 */
export function parseInboundMessage(value: unknown): InboundMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Own properties only: an inherited `type` must not satisfy the check.
  if (!Object.hasOwn(value, 'type') || !Object.hasOwn(value, 'requestId')) return undefined;

  const candidate = value as { type?: unknown; requestId?: unknown };
  if (typeof candidate.type !== 'string' || !INBOUND_TYPES.has(candidate.type)) return undefined;
  if (typeof candidate.requestId !== 'number' || !Number.isFinite(candidate.requestId)) {
    return undefined;
  }

  return {
    type: candidate.type as InboundMessageType,
    requestId: candidate.requestId
  } as InboundMessage;
}

/**
 * Tracks which generation is current so a stale response - from a request the
 * user has already superseded by clicking Regenerate again - can be discarded
 * instead of overwriting newer output.
 */
export class RequestTracker {
  private current = 0;

  /** Begin a new request, invalidating any in flight. */
  next(): number {
    this.current += 1;
    return this.current;
  }

  /** The id of the most recently started request. */
  get latest(): number {
    return this.current;
  }

  /** True when `id` is still the newest request. */
  isCurrent(id: number): boolean {
    return id === this.current;
  }
}
