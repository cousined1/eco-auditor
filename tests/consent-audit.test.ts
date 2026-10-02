// F-X1-02: a consent record the server throttles (429) must not be lost. It is
// queued in localStorage before the first request, retried with Retry-After and
// bounded backoff, and whatever is still queued is delivered on the next page
// load. The server side is a stand-in that behaves like POST /api/consent-audit
// (10 per minute per IP, 429 with Retry-After) so the scenarios are the ones the
// exclusive-stack test found: 12 posts from one address, 10 stored.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushConsentAuditOutbox, submitConsentAudit, type ConsentAuditPayload } from '../src/lib/consent-audit';

const OUTBOX_KEY = 'eco_consent_outbox';

function payload(method: ConsentAuditPayload['method'] = 'accept_all'): ConsentAuditPayload {
  return {
    visitorId: 'visitor-1',
    consent: { strictlyNecessary: true, analytics: true, preferences: true, marketing: true },
    policyVersion: '1.0.0',
    method,
    gpc: false,
    dnt: false,
  };
}

function queued(): Array<{ id: string; payload: ConsentAuditPayload }> {
  return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as Array<{ id: string; payload: ConsentAuditPayload }>;
}

const respond = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers });

// Lets every queued microtask and any timer due within `ms` run.
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

// The page is reloaded: delivery state that lives in module memory is gone,
// localStorage stays. A fresh module instance models that.
async function reloadPage() {
  vi.resetModules();
  return import('../src/lib/consent-audit');
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('delivery', () => {
  it('posts the record and leaves nothing queued once the server accepts it', async () => {
    const fetchMock = vi.fn(async () => respond(202));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/consent-audit');
    // The decision time rides along with the choice (see "the decision time" below).
    expect(JSON.parse(String(init.body))).toEqual({ ...payload(), decidedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) });
    expect(queued()).toEqual([]);
  });

  it('has the record safely queued BEFORE the first request leaves, so a closed banner never outruns the evidence', async () => {
    let queuedAtFirstRequest: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      queuedAtFirstRequest = queued();
      return respond(202);
    }));

    submitConsentAudit(payload('reject_all'));
    await settle();

    expect(queuedAtFirstRequest).toHaveLength(1);
    expect((queuedAtFirstRequest[0] as { payload: ConsentAuditPayload }).payload.method).toBe('reject_all');
  });

  // The bug this guards against: a record queued in the gap between a delivery run
  // finding the queue empty and the run ending was left waiting for the next page
  // load. Sweeping the gap, one microtask turn at a time, leaves no timing to luck.
  it.each(Array.from({ length: 16 }, (_, hops) => hops))('a record submitted %i microtask turns after another is never left behind', async (hops) => {
    const fetchMock = vi.fn(async () => respond(202));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload('accept_all'));
    let turns = hops;
    const later = (): void => {
      if (turns-- > 0) queueMicrotask(later);
      else submitConsentAudit(payload('reset'));
    };
    later();
    await settle(50);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queued()).toEqual([]);
  });

  it('sends two quick choices once each, in order', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push((JSON.parse(String(init.body)) as ConsentAuditPayload).method);
      return respond(202);
    }));

    submitConsentAudit(payload('accept_all'));
    submitConsentAudit(payload('reset'));
    await settle(50);

    expect(sent).toEqual(['accept_all', 'reset']);
    expect(queued()).toEqual([]);
  });
});

describe('a 429 from the consent endpoint (F-X1-02)', () => {
  it('waits for Retry-After, retries, and delivers the record', async () => {
    const times: number[] = [];
    const start = Date.now();
    const fetchMock = vi.fn(async () => {
      times.push(Date.now() - start);
      return times.length === 1 ? respond(429, { 'Retry-After': '5' }) : respond(202);
    });
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queued()).toHaveLength(1); // throttled, but not lost

    await settle(4_900);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still inside the window the server named

    await settle(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(times[1]).toBeGreaterThanOrEqual(5_000);
    expect(queued()).toEqual([]);
  });

  it('delivers all 12 records of a burst from one address, where the server only takes 10 a minute', async () => {
    // The stand-in server: 10 accepted per 60 s window, then 429 with the time left.
    let windowStart = Date.now();
    let inWindow = 0;
    const stored: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (Date.now() - windowStart >= 60_000) {
        windowStart = Date.now();
        inWindow = 0;
      }
      inWindow += 1;
      if (inWindow > 10) return respond(429, { 'Retry-After': String(Math.ceil((60_000 - (Date.now() - windowStart)) / 1000)) });
      stored.push((JSON.parse(String(init.body)) as ConsentAuditPayload).visitorId ?? '');
      return respond(202);
    }));

    for (let i = 0; i < 12; i += 1) submitConsentAudit({ ...payload(), visitorId: `visitor-${i}` });
    await settle(1_000);
    expect(stored.length).toBe(10); // the 11th and 12th were throttled and are still queued
    expect(queued()).toHaveLength(2);

    await settle(61_000);
    expect(stored).toHaveLength(12);
    expect(new Set(stored).size).toBe(12); // none sent twice
    expect(queued()).toEqual([]);
  });

  it('stays queued when the server keeps throttling, after a bounded number of requests', async () => {
    const fetchMock = vi.fn(async () => respond(429, { 'Retry-After': '2' }));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(4); // one try and three retries, then it stops
    expect(queued()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // and no timer is left running
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stays queued'));
  });

  it('does not hold a timer for a Retry-After longer than a page visit; the record waits for the next load', async () => {
    const fetchMock = vi.fn(async () => respond(429, { 'Retry-After': '3600' }));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queued()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers what is still queued when the next page load flushes the outbox', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(429, { 'Retry-After': '2' })));
    submitConsentAudit(payload('accept_all'));
    await settle(120_000);
    expect(queued()).toHaveLength(1);

    const delivered: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      delivered.push((JSON.parse(String(init.body)) as ConsentAuditPayload).method);
      return respond(202);
    }));
    const nextLoad = await reloadPage();
    nextLoad.flushConsentAuditOutbox();
    await settle();

    expect(delivered).toEqual(['accept_all']);
    expect(queued()).toEqual([]);
  });
});

// The server stamps a record with the time it RECEIVED it. A choice answered with a
// 429 waits in the outbox and is delivered on a later visit, so without its own time
// it would read as decided then. The time of the click is taken once, when the
// choice is queued, and travels with the record every time it is sent.
describe('the decision time (k10 follow-up)', () => {
  const CLICK = '2026-09-30T10:00:00.000Z';

  function captureBodies() {
    const bodies: Array<Partial<ConsentAuditPayload>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Partial<ConsentAuditPayload>);
      return respond(202);
    }));
    return bodies;
  }

  it('sends the moment of the choice', async () => {
    vi.setSystemTime(new Date(CLICK));
    const bodies = captureBodies();

    submitConsentAudit(payload());
    await settle();

    expect(bodies).toEqual([{ ...payload(), decidedAt: CLICK }]);
  });

  it('keeps it while the record waits in the outbox, and sends the same time on a visit two days later', async () => {
    vi.setSystemTime(new Date(CLICK));
    vi.stubGlobal('fetch', vi.fn(async () => respond(429, { 'Retry-After': '3600' })));
    submitConsentAudit(payload('accept_all'));
    await settle();
    expect(queued()[0]?.payload.decidedAt).toBe(CLICK);

    vi.setSystemTime(new Date('2026-10-02T08:30:00.000Z'));
    const bodies = captureBodies();
    const nextLoad = await reloadPage();
    nextLoad.flushConsentAuditOutbox();
    await settle();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.decidedAt).toBe(CLICK); // not the delivery time
    expect(queued()).toEqual([]);
  });

  it('sends the same decision time on every retry within a visit', async () => {
    vi.setSystemTime(new Date(CLICK));
    const sent: Array<string | undefined> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push((JSON.parse(String(init.body)) as Partial<ConsentAuditPayload>).decidedAt);
      return sent.length < 3 ? respond(503) : respond(202);
    }));

    submitConsentAudit(payload());
    await settle(10_000);

    expect(sent).toEqual([CLICK, CLICK, CLICK]);
  });

  it('does not invent a time for a record an older page load queued without one', async () => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ id: 'from-an-older-page', payload: payload() }]));
    vi.setSystemTime(new Date('2026-10-02T08:30:00.000Z'));
    const bodies = captureBodies();

    const nextLoad = await reloadPage();
    nextLoad.flushConsentAuditOutbox();
    await settle();

    expect(bodies).toEqual([payload()]);
  });

  it('gives each of two quick choices its own time', async () => {
    vi.setSystemTime(new Date(CLICK));
    const bodies = captureBodies();

    submitConsentAudit(payload('accept_all'));
    vi.setSystemTime(new Date('2026-09-30T10:00:07.000Z'));
    submitConsentAudit(payload('reset'));
    await settle(50);

    expect(bodies.map((body) => body.decidedAt)).toEqual([CLICK, '2026-09-30T10:00:07.000Z']);
  });

  it('keeps a decision time the caller already has', async () => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
    const bodies = captureBodies();

    submitConsentAudit({ ...payload(), decidedAt: CLICK });
    await settle();

    expect(bodies[0]?.decidedAt).toBe(CLICK);
  });
});

describe('other failures', () => {
  it('retries a 503 (the server could not persist the record) with backoff', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(202));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await settle(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(queued()).toEqual([]);
  });

  it('retries a network failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(respond(202));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queued()).toEqual([]);
  });

  it('drops a record the server refuses as malformed instead of retrying it forever', async () => {
    const fetchMock = vi.fn(async () => respond(400));
    vi.stubGlobal('fetch', fetchMock);

    submitConsentAudit(payload());
    await settle(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queued()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rejected by the server (HTTP 400)'));
  });

  it('keeps retrying from memory when localStorage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond(429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(respond(202));
    vi.stubGlobal('fetch', fetchMock);

    expect(() => submitConsentAudit(payload())).not.toThrow();
    await settle(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never queues more than a bounded number of records', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(429, { 'Retry-After': '3600' })));

    for (let i = 0; i < 40; i += 1) submitConsentAudit({ ...payload(), visitorId: `visitor-${i}` });
    await settle();

    expect(queued().length).toBeLessThanOrEqual(25);
    expect(queued().at(-1)?.payload.visitorId).toBe('visitor-39'); // the newest survive
  });

  it('flushing an empty outbox sends nothing', async () => {
    const fetchMock = vi.fn(async () => respond(202));
    vi.stubGlobal('fetch', fetchMock);

    flushConsentAuditOutbox();
    await settle(1_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
