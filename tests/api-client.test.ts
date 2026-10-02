import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getUpgradeRequired } from '../src/lib/api';

// apiFetch replaced buildApiRequestInit as the only way server calls get the
// session token; these keep the two header guarantees the helper had.
describe('API request helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubOk() {
    const server = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', server);
    return server;
  }

  it('passes through the current InsForge authorization header', async () => {
    const server = stubOk();
    await apiFetch('/api/emissions/summary', {}, {
      getHttpClient() {
        return {
          getHeaders() {
            return { Authorization: 'Bearer token-123', 'x-client': 'sdk' };
          },
        };
      },
    });

    expect(server).toHaveBeenCalledWith('/api/emissions/summary', { headers: { Authorization: 'Bearer token-123' } });
  });

  it('does not forward non-auth SDK headers to same-origin app APIs', async () => {
    const server = stubOk();
    await apiFetch('/api/emissions/summary', {}, {
      getHttpClient() {
        return {
          getHeaders() {
            return { 'x-api-key': 'anon-key' };
          },
        };
      },
    });

    expect(server).toHaveBeenCalledWith('/api/emissions/summary', { headers: {} });
  });
});

describe('getUpgradeRequired', () => {
  it('returns the required plan for a 402 upgrade_required response', async () => {
    const res = new Response(
      JSON.stringify({ success: false, error: 'An active subscription is required', code: 'upgrade_required', requiredPlan: 'starter' }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
    const info = await getUpgradeRequired(res);
    expect(info).toEqual({ requiredPlan: 'starter', message: 'An active subscription is required' });
  });

  it('normalizes an unknown required plan to starter', async () => {
    const res = new Response(JSON.stringify({ code: 'upgrade_required', requiredPlan: 'enterprise' }), { status: 402 });
    const info = await getUpgradeRequired(res);
    expect(info?.requiredPlan).toBe('starter');
  });

  it('returns null for non-402 responses and does not consume the body', async () => {
    const res = new Response(JSON.stringify({ success: true, data: { total: 5 } }), { status: 200 });
    const info = await getUpgradeRequired(res);
    expect(info).toBeNull();
    // body still readable by the caller (clone was used internally)
    const body = await res.json();
    expect(body.data.total).toBe(5);
  });

  it('returns null for a 402 without the upgrade_required code', async () => {
    const res = new Response(JSON.stringify({ error: 'card declined' }), { status: 402 });
    expect(await getUpgradeRequired(res)).toBeNull();
  });
});
