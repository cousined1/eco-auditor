import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEAD_SOURCES, LeadSubmitError, rateLimitMessage, submitLead } from '../src/lib/leads';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitLead', () => {
  it('sends lead data through the rate-limited server boundary', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true, message: 'Lead captured successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await submitLead({
      type: 'demo',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: 'Analytical Engines',
      message: 'Please show the reporting workflow.',
      source: 'demo',
    });

    // RT-06: the request must also carry a bounded signal, so a stalled
    // connection rejects instead of pending forever.
    expect(fetchMock).toHaveBeenCalledWith('/api/leads', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'demo',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Analytical Engines',
        message: 'Please show the reporting workflow.',
        source: 'demo',
      }),
      signal: expect.any(AbortSignal),
    }));
  });

  it('returns the safe server error when submission is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: 'Invalid submission' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(submitLead({
      type: 'sales',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: '',
      message: 'Hello',
      source: 'contact',
    })).rejects.toThrow('Invalid submission');
  });

  it('uses a generic error when the response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failure', { status: 502 })));

    await expect(submitLead({
      type: 'sales',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: '',
      message: 'Hello',
      source: 'contact',
    })).rejects.toThrow('We couldn’t send your request right now.');
  });
});

const lead = {
  type: 'sales',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: '',
  message: 'Hello',
  source: 'contact',
} as const;

describe('submitLead when the server rate-limits (F-X1-04)', () => {
  it('says how long to wait, using the retryAfter seconds in the 429 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Too many requests', retryAfter: 583 }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '583' } },
    )));

    const error = await submitLead(lead).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LeadSubmitError);
    expect((error as LeadSubmitError).status).toBe(429);
    expect((error as LeadSubmitError).retryAfterSeconds).toBe(583);
    // 583 s is 9.7 minutes: the wait is rounded UP so the visitor is not told a minute too early.
    expect((error as LeadSubmitError).message).toBe('You’ve sent several requests recently. Please try again in about 10 minutes.');
    expect((error as LeadSubmitError).message).not.toContain('Too many requests');
  });

  it('falls back to the Retry-After header when the body has no retryAfter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429, headers: { 'Retry-After': '60' } })));
    await expect(submitLead(lead)).rejects.toThrow('Please try again in about 1 minute.');
  });

  it('gives a generic wait when the server names none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    await expect(submitLead(lead)).rejects.toThrow('Please try again in a few minutes.');
  });

  it('formats short and long waits', () => {
    expect(rateLimitMessage(30)).toContain('in less than a minute');
    expect(rateLimitMessage(61)).toContain('in about 2 minutes');
    expect(rateLimitMessage(600)).toContain('in about 10 minutes');
    expect(rateLimitMessage(null)).toContain('in a few minutes');
    expect(rateLimitMessage(Number.NaN)).toContain('in a few minutes');
  });

  it('keeps the status on non-429 failures so callers can branch on it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid submission' }), { status: 400 })));
    const error = await submitLead(lead).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LeadSubmitError);
    expect((error as LeadSubmitError).status).toBe(400);
    expect((error as LeadSubmitError).retryAfterSeconds).toBeNull();
  });
});

describe('lead sources (F-B-21)', () => {
  it('is a closed list the server also validates against, defaulting to api', () => {
    expect([...LEAD_SOURCES]).toEqual(['contact', 'demo', 'chat', 'api']);
  });

  it('sends the caller\'s source unchanged so the server can store it', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    for (const source of LEAD_SOURCES) {
      await submitLead({ ...lead, source });
    }
    const sent = fetchMock.mock.calls.map((call) => (JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as { source: string }).source);
    expect(sent).toEqual([...LEAD_SOURCES]);
  });
});
