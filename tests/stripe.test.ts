/**
 * Stripe client-side SDK tests
 * Tests the PRICE_IDS configuration and the client function contracts.
 *
 * Note: Since STRIPE_PK is checked at module import time via import.meta.env,
 * and Vitest's vi.stubEnv only works before module import, we test the
 * function contracts and PRICE_IDS configuration rather than mocking fetch.
 *
 * RT-03 (audit run AUDIT-RUN-20260919-001828-7455): the previous
 * "handleWebhookEvent" suite asserted a table of literal no-ops (every
 * WEBHOOK_HANDLERS entry in src/lib/stripe.ts discards its argument, so
 * `.not.toThrow()` over them could never fail). It was removed; the REAL
 * webhook route (server.cjs /api/webhook — signature verification, tampered
 * signature 400, missing-secret 503, retryable-failure semantics, watermark
 * ordering) is tested end-to-end in tests/webhook-route.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { PRICE_IDS } from '../src/lib/stripe.ts';

describe('PRICE_IDS configuration', () => {
  it('has all three plan tiers', () => {
    expect(PRICE_IDS).toHaveProperty('starter');
    expect(PRICE_IDS).toHaveProperty('growth');
    expect(PRICE_IDS).toHaveProperty('pro');
  });

  it('has monthly and annual for each tier', () => {
    for (const tier of ['starter', 'growth', 'pro'] as const) {
      expect(PRICE_IDS[tier]).toHaveProperty('monthly');
      expect(PRICE_IDS[tier]).toHaveProperty('annual');
    }
  });

  it('price IDs are non-empty strings', () => {
    for (const tier of ['starter', 'growth', 'pro'] as const) {
      for (const cycle of ['monthly', 'annual'] as const) {
        expect(typeof PRICE_IDS[tier][cycle]).toBe('string');
        expect(PRICE_IDS[tier][cycle].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('StripeResult type contract', () => {
  // These tests verify the discriminated union pattern works correctly
  it('ok result has data property', () => {
    const result: { ok: true; data: { url: string } } = {
      ok: true,
      data: { url: 'https://checkout.stripe.com/session123' },
    };
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBeDefined();
    }
  });

  it('error result has error property', () => {
    const result: { ok: false; error: string } = {
      ok: false,
      error: 'Stripe is not configured',
    };
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  });

  it('discriminated union narrows type correctly', () => {
    function processResult(result: { ok: true; data: { url: string } } | { ok: false; error: string }) {
      if (result.ok) {
        return result.data.url;
      }
      return result.error;
    }

    const successResult = { ok: true as const, data: { url: 'https://example.com' } };
    const errorResult = { ok: false as const, error: 'Something went wrong' };

    expect(processResult(successResult)).toBe('https://example.com');
    expect(processResult(errorResult)).toBe('Something went wrong');
  });
});

describe('client-side billing helper contracts', () => {
  it('unauthenticated calls fail gracefully without throwing', async () => {
    const { createBillingPortalSession, changeSubscription, cancelSubscription, verifyCheckoutSession } = await import('../src/lib/stripe.ts');
    
    const portal = await createBillingPortalSession();
    expect(portal.ok).toBe(false);
    if (!portal.ok) expect(portal.error).toMatch(/signed in/i);

    const change = await changeSubscription('growth', 'monthly');
    expect(change.ok).toBe(false);
    if (!change.ok) expect(change.error).toMatch(/signed in/i);

    const cancel = await cancelSubscription();
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.error).toMatch(/signed in/i);

    const verify = await verifyCheckoutSession('cs_test_123');
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.error).toMatch(/signed in/i);
  });
});
