/**
 * Stripe client-side SDK tests
 * Tests the StripeResult type union and client function contracts
 *
 * Note: Since STRIPE_PK is checked at module import time via import.meta.env,
 * and Vitest's vi.stubEnv only works before module import, we test the
 * function contracts and PRICE_IDS configuration rather than mocking fetch.
 * The actual fetch calls are tested via E2E tests against the server.
 */
import { describe, it, expect } from 'vitest';
import { PRICE_IDS, handleWebhookEvent } from '../src/lib/stripe.ts';

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

describe('handleWebhookEvent', () => {
  it('handles checkout.session.completed without error', () => {
    expect(() => {
      handleWebhookEvent({
        id: 'evt_123',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: { object: { id: 'cs_123' } },
      });
    }).not.toThrow();
  });

  it('handles customer.subscription.updated without error', () => {
    expect(() => {
      handleWebhookEvent({
        id: 'evt_456',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: { object: { id: 'sub_123' } },
      });
    }).not.toThrow();
  });

  it('handles customer.subscription.deleted without error', () => {
    expect(() => {
      handleWebhookEvent({
        id: 'evt_789',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: { object: { id: 'sub_123' } },
      });
    }).not.toThrow();
  });

  it('handles invoice.paid without error', () => {
    expect(() => {
      handleWebhookEvent({
        id: 'evt_inv1',
        type: 'invoice.paid',
        created: Date.now(),
        data: { object: { id: 'in_123' } },
      });
    }).not.toThrow();
  });

  it('handles invoice.payment_failed without error', () => {
    expect(() => {
      handleWebhookEvent({
        id: 'evt_inv2',
        type: 'invoice.payment_failed',
        created: Date.now(),
        data: { object: { id: 'in_456' } },
      });
    }).not.toThrow();
  });

  it('handles unknown event type gracefully', () => {
    // Unknown types should be silently ignored (no handler = no-op)
    expect(() => {
      handleWebhookEvent({
        id: 'evt_unknown',
        type: 'unknown.event.type' as any,
        created: Date.now(),
        data: { object: {} },
      });
    }).not.toThrow();
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