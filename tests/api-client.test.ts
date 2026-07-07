import { describe, expect, it } from 'vitest';
import { buildApiRequestInit, getUpgradeRequired } from '../src/lib/api';

describe('API request helper', () => {
  it('passes through the current InsForge authorization header', () => {
    const init = buildApiRequestInit({
      getHttpClient() {
        return {
          getHeaders() {
            return { Authorization: 'Bearer token-123', 'x-client': 'sdk' };
          },
        };
      },
    });

    expect(init.headers).toEqual({ Authorization: 'Bearer token-123' });
  });

  it('does not forward non-auth SDK headers to same-origin app APIs', () => {
    const init = buildApiRequestInit({
      getHttpClient() {
        return {
          getHeaders() {
            return { 'x-api-key': 'anon-key' };
          },
        };
      },
    });

    expect(init.headers).toEqual({});
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
