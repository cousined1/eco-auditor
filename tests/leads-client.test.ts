import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitLead } from '../src/lib/leads';

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
