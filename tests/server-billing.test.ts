import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  billingStateFromCompany,
  hasPlanAccess,
  planFromPriceId,
  resolvePlanPriceId,
  subscriptionRecordFromStripe,
  trialEligiblePriceIds,
} = require('../server-billing.cjs');

const STRIPE_ENV = {
  STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_ANNUAL: 'price_starter_annual',
  STRIPE_PRICE_GROWTH_MONTHLY: 'price_growth_monthly',
  STRIPE_PRICE_GROWTH_ANNUAL: 'price_growth_annual',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pro_annual',
};

describe('server billing helpers', () => {
  it('resolves configured price IDs for plan changes', () => {
    expect(resolvePlanPriceId(STRIPE_ENV, 'growth', 'annual')).toBe('price_growth_annual');
    expect(resolvePlanPriceId(STRIPE_ENV, 'enterprise', 'annual')).toBeNull();
    expect(resolvePlanPriceId(STRIPE_ENV, 'growth', 'weekly')).toBeNull();
  });

  it('maps Stripe price IDs back to plan and billing cycle', () => {
    expect(planFromPriceId('price_pro_monthly', STRIPE_ENV)).toEqual({ planId: 'pro', billing: 'monthly' });
    expect(planFromPriceId('price_unknown', STRIPE_ENV)).toBeNull();
  });

  it('allows annual Starter and Growth price IDs to start trials', () => {
    expect(trialEligiblePriceIds(STRIPE_ENV)).toEqual(new Set([
      'price_starter_monthly',
      'price_starter_annual',
      'price_growth_monthly',
      'price_growth_annual',
    ]));
  });

  it('fails closed when no subscription or trial is active', () => {
    const state = billingStateFromCompany({
      id: 1,
      trial_ends_at: '2026-01-01T00:00:00.000Z',
      subscription_plan: null,
      subscription_status: null,
      subscription_current_period_end: null,
      subscription_billing_cycle: null,
      subscription_cancel_at_period_end: false,
    }, new Date('2026-02-01T00:00:00.000Z'));

    expect(state.active).toBe(false);
    expect(state.plan).toBeNull();
  });

  it('treats an active trial as Starter access only', () => {
    const state = billingStateFromCompany({
      id: 1,
      trial_ends_at: '2026-03-01T00:00:00.000Z',
      subscription_plan: null,
      subscription_status: null,
      subscription_current_period_end: null,
      subscription_billing_cycle: null,
      subscription_cancel_at_period_end: false,
    }, new Date('2026-02-01T00:00:00.000Z'));

    expect(state.active).toBe(true);
    expect(state.plan).toBe('starter');
    expect(hasPlanAccess(state.plan, 'starter')).toBe(true);
    expect(hasPlanAccess(state.plan, 'growth')).toBe(false);
  });
});

describe('subscriptionRecordFromStripe', () => {
  const PERIOD_END_UNIX = 1782000000; // 2026-06-21T00:00:00.000Z

  it('maps an active subscription to company billing columns', () => {
    const record = subscriptionRecordFromStripe({
      id: 'sub_123',
      customer: 'cus_456',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: PERIOD_END_UNIX,
      items: { data: [{ id: 'si_1', price: { id: 'price_growth_annual' } }] },
    }, STRIPE_ENV);

    expect(record).toEqual({
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_456',
      status: 'active',
      plan: 'growth',
      billingCycle: 'annual',
      currentPeriodEnd: new Date(PERIOD_END_UNIX * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      unrecognizedActivePrice: null,
    });
  });

  it('reads period end from the item on newer Stripe API shapes', () => {
    const record = subscriptionRecordFromStripe({
      id: 'sub_123',
      customer: { id: 'cus_456' },
      status: 'trialing',
      cancel_at_period_end: true,
      items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' }, current_period_end: PERIOD_END_UNIX }] },
    }, STRIPE_ENV);

    expect(record.stripeCustomerId).toBe('cus_456');
    expect(record.currentPeriodEnd).toBe(new Date(PERIOD_END_UNIX * 1000).toISOString());
    expect(record.cancelAtPeriodEnd).toBe(true);
  });

  it('produces an inactive billing state for a deleted subscription', () => {
    const record = subscriptionRecordFromStripe({
      id: 'sub_123',
      customer: 'cus_456',
      status: 'canceled',
      cancel_at_period_end: false,
      current_period_end: PERIOD_END_UNIX,
      items: { data: [{ id: 'si_1', price: { id: 'price_pro_monthly' } }] },
    }, STRIPE_ENV);

    const state = billingStateFromCompany({
      trial_ends_at: '2026-01-01T00:00:00.000Z',
      subscription_status: record.status,
      subscription_plan: record.plan,
      subscription_billing_cycle: record.billingCycle,
      subscription_current_period_end: record.currentPeriodEnd,
      subscription_cancel_at_period_end: record.cancelAtPeriodEnd,
    }, new Date('2026-07-01T00:00:00.000Z'));

    expect(record.status).toBe('canceled');
    expect(state.active).toBe(false);
    expect(state.plan).toBeNull();
  });

  // Regression: an unrecognized price used to persist plan = null, which
  // billingStateFromCompany reads as inactive — so a price rotation in Stripe,
  // or env drift between deploys, paywalled a customer who was paying.
  it('grants starter access when an ACTIVE subscription has an unrecognized price', () => {
    const record = subscriptionRecordFromStripe({
      id: 'sub_123',
      customer: 'cus_456',
      status: 'active',
      current_period_end: PERIOD_END_UNIX,
      items: { data: [{ id: 'si_1', price: { id: 'price_rotated_2027' } }] },
    }, STRIPE_ENV);

    expect(record.plan).toBe('starter');
    expect(record.billingCycle).toBeNull();
    // Surfaced so the env mismatch can be found and fixed.
    expect(record.unrecognizedActivePrice).toBe('price_rotated_2027');

    const state = billingStateFromCompany({
      subscription_status: record.status,
      subscription_plan: record.plan,
      subscription_current_period_end: record.currentPeriodEnd,
    }, new Date('2026-06-01T00:00:00.000Z')); // inside the paid period

    expect(state.active).toBe(true);
    expect(state.plan).toBe('starter');
  });

  it('does not grant access when an INACTIVE subscription has an unrecognized price', () => {
    const record = subscriptionRecordFromStripe({
      id: 'sub_123',
      customer: 'cus_456',
      status: 'canceled',
      items: { data: [{ id: 'si_1', price: { id: 'price_unknown' } }] },
    }, STRIPE_ENV);

    expect(record.plan).toBeNull();
    expect(record.unrecognizedActivePrice).toBeNull();
    expect(record.currentPeriodEnd).toBeNull();
  });
});
