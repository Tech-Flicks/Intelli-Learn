/**
 * The one error type the AI client throws. `message` is written for a parent
 * to read; it is never shown to a child.
 */
export type AiErrorKind =
  | 'no-config' // demo mode, or the endpoint, model or key is missing
  | 'budget' // the parent's daily budget or monthly cap is used up
  | 'network' // unreachable, blocked by the browser, timed out or a server fault
  | 'auth' // the key was rejected, or the proxy refused this page's address
  | 'rate-limit' // the service is throttling or out of credit
  | 'bad-response' // the service answered, but not with something usable
  | 'refused' // the model declined to answer
  | 'aborted'; // the caller gave up

export interface AiErrorExtra {
  /** HTTP status when the service answered. */
  status?: number | null;
  /** The service's own error text, for diagnostics. */
  detail?: string;
  /** True when the request ran into the client's time limit. */
  timedOut?: boolean;
  /** The machine-readable `error.type` of the error body (e.g. the proxy's `proxy_not_configured`), or ''. */
  code?: string;
}

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | null;
  readonly detail: string;
  readonly timedOut: boolean;
  /** The service's own `error.type`, lower case, or '' when it sent none. */
  readonly code: string;

  constructor(kind: AiErrorKind, message: string, extra: AiErrorExtra = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = extra.status ?? null;
    this.detail = extra.detail ?? '';
    this.timedOut = extra.timedOut ?? false;
    this.code = extra.code ?? '';
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}
