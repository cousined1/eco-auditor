/**
 * Delivery of consent decisions to POST /api/consent-audit (F-X1-02).
 *
 * The server-side record is the proof of consent that GDPR Art. 7(1) asks the
 * controller to be able to show, and the endpoint is rate limited per IP (10 a
 * minute), so a shared address (an office, a campus, mobile carrier NAT) can get
 * a 429 for a perfectly legitimate choice. The record used to be posted once and
 * forgotten: a 429 was logged and the visitor's choice was honoured locally with
 * nothing on the server to show for it.
 *
 * Now every record is written to a small localStorage outbox BEFORE the first
 * request and leaves it only when the server accepts it (2xx) or says it never
 * will (a malformed payload). A throttled or failing request is retried with
 * bounded backoff, honouring Retry-After; whatever is still queued is delivered
 * on the next page load. So when the banner closes, the record has been accepted
 * or is safely queued, and the UI never claims more than that.
 *
 * The server stamps a record with the time it RECEIVED it, which for a record that
 * waited in the outbox is a later visit. So the time of the choice is taken when
 * the record is queued (decidedAt) and travels with it on every send; the server
 * keeps both times. A record an older page load queued without one is sent as it
 * is: a time made up at delivery would be the very error this avoids.
 */
import type { ConsentCategories, ConsentMethod } from './consent-context';

export type ConsentAuditPayload = {
  visitorId: string | null;
  consent: ConsentCategories;
  policyVersion: string;
  method: ConsentMethod;
  gpc: boolean;
  dnt: boolean;
  /** When the visitor chose, from this browser's clock (ISO 8601, UTC). Stamped when the record is queued. */
  decidedAt?: string;
};

type QueuedRecord = { id: string; payload: ConsentAuditPayload };
type Outcome = 'delivered' | 'rejected' | 'later';

const OUTBOX_KEY = 'eco_consent_outbox';
// A visitor makes a handful of choices; the cap only keeps a server that never
// answers from growing the visitor's storage without limit.
const MAX_QUEUED = 25;
// Requests per record per delivery run (one try plus retries).
const MAX_ATTEMPTS = 4;
// A Retry-After beyond this is not waited out with a live timer; the record stays
// queued for the next page load.
const MAX_WAIT_MS = 90_000;
// The server will never accept these payloads, so retrying would only repeat the refusal.
const PERMANENT_REJECTIONS = new Set([400, 413, 415, 422]);

// Records that could not be written to storage (blocked storage). They are still
// retried for as long as this page stays open.
let unstored: QueuedRecord[] = [];

function isQueuedRecord(value: unknown): value is QueuedRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { id?: unknown; payload?: unknown };
  return typeof record.id === 'string' && typeof record.payload === 'object' && record.payload !== null;
}

function readStored(): QueuedRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isQueuedRecord) : [];
  } catch {
    return [];
  }
}

function writeStored(records: QueuedRecord[]): boolean {
  try {
    if (records.length > 0) localStorage.setItem(OUTBOX_KEY, JSON.stringify(records));
    else localStorage.removeItem(OUTBOX_KEY);
    return true;
  } catch {
    return false;
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function enqueue(payload: ConsentAuditPayload): void {
  const record: QueuedRecord = { id: newId(), payload };
  const stored = readStored();
  const next = [...stored, record].slice(-MAX_QUEUED);
  if (next.length < stored.length + 1) console.warn('[ConsentAudit] outbox full; the oldest queued consent record was dropped');
  if (!writeStored(next)) unstored.push(record);
}

function remove(id: string): void {
  writeStored(readStored().filter((record) => record.id !== id));
  unstored = unstored.filter((record) => record.id !== id);
}

function post(payload: ConsentAuditPayload): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  };
  // RT-06: bounded fetch. Browsers without AbortSignal.timeout send it unbounded
  // rather than never sending it.
  if (typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(15000);
  return fetch('/api/consent-audit', init);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// 1 s, 2 s, 4 s ... for failures that carry no hint of when to come back.
function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

// Retry-After is either delay-seconds or an HTTP date.
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms)) return null;
  // A little jitter keeps clients that were throttled together from retrying together.
  return Math.max(ms, 1000) + Math.floor(Math.random() * 250);
}

async function deliver(payload: ConsentAuditPayload): Promise<Outcome> {
  let problem = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let waitMs = backoffMs(attempt);
    try {
      const res = await post(payload);
      if (res.ok) return 'delivered';
      if (PERMANENT_REJECTIONS.has(res.status)) {
        console.warn(`[ConsentAudit] consent record rejected by the server (HTTP ${res.status}) and dropped`);
        return 'rejected';
      }
      problem = `HTTP ${res.status}`;
      const throttledMs = res.status === 429 ? retryAfterMs(res) : null;
      if (throttledMs !== null) {
        if (throttledMs > MAX_WAIT_MS) break;
        waitMs = throttledMs;
      }
    } catch {
      problem = 'network failure';
    }
    if (attempt < MAX_ATTEMPTS) await sleep(waitMs);
  }
  console.warn(`[ConsentAudit] consent record not persisted yet (${problem}); it stays queued and is retried on the next page load`);
  return 'later';
}

async function deliverQueued(): Promise<void> {
  for (;;) {
    const next = [...readStored(), ...unstored][0];
    if (!next) return;
    if ((await deliver(next.payload)) === 'later') return;
    remove(next.id);
  }
}

// One delivery run at a time, so two quick choices cannot send the same record
// twice. A record queued while a run is in progress asks for another pass, which
// the run makes before it lets go: the queue is checked again after the last
// `await` and the flag is cleared in the same synchronous step, so a record cannot
// be queued in between and left waiting for the next page load.
let running = false;
let passRequested = false;

function drain(): void {
  if (running) {
    passRequested = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      do {
        passRequested = false;
        await deliverQueued();
      } while (passRequested);
    } catch (err: unknown) {
      console.warn('[ConsentAudit] unexpected failure while delivering consent records', err);
    } finally {
      running = false;
    }
  })();
}

/** Queues a consent decision and starts delivering it. */
export function submitConsentAudit(payload: ConsentAuditPayload): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  enqueue({ ...payload, decidedAt: payload.decidedAt ?? new Date().toISOString() });
  drain();
}

/** Delivers records an earlier page load could not (call once on load). */
export function flushConsentAuditOutbox(): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  if (readStored().length > 0 || unstored.length > 0) drain();
}
