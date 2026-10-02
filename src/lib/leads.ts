// F-B-21 — where a lead came from. The server keeps this list as an allow-list
// (anything else is stored as 'api'), so a new caller must add its value on both
// sides. 'chat' is sent by the chat widget; the Contact and Demo pages send their
// own value.
export const LEAD_SOURCES = ['contact', 'demo', 'chat', 'api'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface LeadSubmission {
  type: string;
  name: string;
  email: string;
  company: string;
  message: string;
  source: LeadSource;
}

const GENERIC_ERROR = 'We couldn’t send your request right now.';

/** Thrown when /api/leads rejects a submission; carries what the caller needs to explain it. */
export class LeadSubmitError extends Error {
  readonly status: number;
  /** Seconds the server asked the client to wait (429 only), else null. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'LeadSubmitError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function responseError(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) return GENERIC_ERROR;
  return typeof body.error === 'string' && body.error.trim() ? body.error : GENERIC_ERROR;
}

// The 429 body carries `retryAfter` in seconds and the response carries the same
// value in a Retry-After header (the HTTP-date form of that header is not used).
function retryAfterSeconds(body: unknown, header: string | null): number | null {
  if (typeof body === 'object' && body !== null && 'retryAfter' in body) {
    const value = Number(body.retryAfter);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const fromHeader = header === null ? Number.NaN : Number(header);
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : null;
}

// F-X1-04 — "Too many requests" told the sender nothing. Say how long to wait.
export function rateLimitMessage(seconds: number | null): string {
  let wait = 'in a few minutes';
  if (seconds !== null && Number.isFinite(seconds) && seconds > 0) {
    if (seconds < 60) {
      wait = 'in less than a minute';
    } else {
      const minutes = Math.ceil(seconds / 60);
      wait = `in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }
  }
  return `You’ve sent several requests recently. Please try again ${wait}.`;
}

export async function submitLead(lead: LeadSubmission): Promise<void> {
  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
    // RT-06: a stalled /api/leads connection must reject into the caller's
    // error UI instead of pending forever.
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 429) {
      const wait = retryAfterSeconds(body, response.headers.get('Retry-After'));
      throw new LeadSubmitError(rateLimitMessage(wait), 429, wait);
    }
    throw new LeadSubmitError(responseError(body), response.status, null);
  }
}
