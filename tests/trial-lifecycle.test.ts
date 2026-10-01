// F-B-10 / F-B-18: the trial lifecycle as pure functions. The server decides who is
// in a trial, whose trial ended and who may still be offered one; the client turns
// the end date into a countdown. No network, no DOM.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANS, TRIAL_DAYS, TRIAL_PLAN_ID } from '../src/content/pricing';
import { trialDaysLeft, trialEndedHeading, trialEndedMessage, trialEndedSentence, trialPillModel } from '../src/lib/trial';

const require = createRequire(import.meta.url);
const { billingStateFromCompany, checkoutTrialDecision, planAccessDecision, CHECKOUT_TRIAL_DAYS } =
  require('../server-billing.cjs');

const NOW = new Date('2026-09-30T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

// A companies row as loadBillingState reads it: never subscribed, trial clock at `trialEndsAt`.
const company = (overrides: Record<string, unknown> = {}) => ({
  trial_ends_at: at(9 * DAY),
  subscription_status: null,
  subscription_plan: null,
  subscription_billing_cycle: null,
  subscription_current_period_end: null,
  subscription_cancel_at_period_end: false,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  ...overrides,
});

const CANCELLED_SUBSCRIBER = company({
  trial_ends_at: at(-30 * DAY),
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  subscription_status: 'canceled',
  subscription_plan: 'starter',
  subscription_current_period_end: at(-2 * DAY),
});

describe('billing state: where a company is in its trial', () => {
  it('a running card-free trial is active, not ended, and may still be offered a card trial', () => {
    const state = billingStateFromCompany(company(), NOW);
    expect(state).toMatchObject({ active: true, plan: 'starter', trialActive: true, trialEnded: false, trialEligible: true });
  });

  it('a trial that ran out with nothing ever bought is "ended" and cannot be offered another', () => {
    const state = billingStateFromCompany(company({ trial_ends_at: at(-2 * DAY) }), NOW);
    expect(state).toMatchObject({ active: false, plan: null, trialActive: false, trialEnded: true, trialEligible: false });
    expect(state.trialEndsAt).toBe(at(-2 * DAY));
  });

  it('a cancelled subscriber is not a trial that ended, and is not offered a trial either', () => {
    const state = billingStateFromCompany(CANCELLED_SUBSCRIBER, NOW);
    expect(state).toMatchObject({ active: false, status: 'canceled', trialEnded: false, trialEligible: false });
  });

  it('a paying customer, or one in a Stripe trial, is neither ended nor trial-eligible', () => {
    const paid = company({
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      subscription_status: 'active',
      subscription_plan: 'growth',
      subscription_current_period_end: at(20 * DAY),
    });
    expect(billingStateFromCompany(paid, NOW)).toMatchObject({ active: true, plan: 'growth', trialEnded: false, trialEligible: false });
    const stripeTrial = { ...paid, subscription_status: 'trialing' };
    expect(billingStateFromCompany(stripeTrial, NOW)).toMatchObject({ active: true, trialEnded: false, trialEligible: false });
  });

  it('the clock being set proves nothing: a company with no end date is neither ended nor refused a trial', () => {
    expect(billingStateFromCompany(company({ trial_ends_at: null }), NOW)).toMatchObject({
      trialActive: false,
      trialEnded: false,
      trialEligible: true,
    });
    expect(billingStateFromCompany(company({ trial_ends_at: 'not a date' }), NOW)).toMatchObject({
      trialEnded: false,
      trialEligible: true,
    });
  });

  it('reads a Date as well as a string: that is what pg hands back for a timestamptz column', () => {
    const ran = billingStateFromCompany(company({ trial_ends_at: new Date(NOW.getTime() - 2 * DAY) }), NOW);
    expect(ran).toMatchObject({ active: false, trialEnded: true, trialEligible: false });
    const running = billingStateFromCompany(company({ trial_ends_at: new Date(NOW.getTime() + 9 * DAY) }), NOW);
    expect(running).toMatchObject({ active: true, trialEnded: false, trialEligible: true });
    // Serialised like the 402 body and GET /api/billing are: an ISO string the client can read.
    const refusal = planAccessDecision(ran, 'starter');
    expect(JSON.parse(JSON.stringify(refusal.body)).trialEndedAt).toBe(new Date(NOW.getTime() - 2 * DAY).toISOString());
  });

  it('there is no instant at which a trial is neither running nor ended', () => {
    for (const offset of [-1, 0, 1]) {
      const state = billingStateFromCompany(company({ trial_ends_at: at(offset) }), NOW);
      expect(state.trialActive !== state.trialEnded, `offset ${offset}ms`).toBe(true);
    }
    // The end instant itself is "ended", like the plan gate: access stops when the trial expires.
    expect(billingStateFromCompany(company({ trial_ends_at: at(0) }), NOW).trialEnded).toBe(true);
  });
});

describe('the plan gate says why, without changing who passes', () => {
  it('an ended trial is refused with reason trial_expired and the date, under the same code as before', () => {
    const state = billingStateFromCompany(company({ trial_ends_at: at(-2 * DAY) }), NOW);
    const decision = planAccessDecision(state, 'starter');

    expect(decision).toMatchObject({
      allowed: false,
      status: 402,
      body: {
        success: false,
        code: 'upgrade_required',
        requiredPlan: 'starter',
        reason: 'trial_expired',
        trialEndedAt: at(-2 * DAY),
      },
    });
  });

  it('every other refusal keeps the generic body: no reason', () => {
    for (const state of [null, billingStateFromCompany(CANCELLED_SUBSCRIBER, NOW)]) {
      const decision = planAccessDecision(state, 'starter');
      expect(decision.allowed).toBe(false);
      expect(decision.body).toEqual({
        success: false,
        error: 'An active subscription is required for this feature',
        code: 'upgrade_required',
        requiredPlan: 'starter',
      });
    }
  });

  it('access itself is unchanged: a running trial passes Starter and is refused Growth', () => {
    const state = billingStateFromCompany(company(), NOW);
    expect(planAccessDecision(state, 'starter')).toEqual({ allowed: true });
    expect(planAccessDecision(state, 'growth')).toMatchObject({ allowed: false, status: 402 });
  });
});

describe('checkoutTrialDecision: one trial per company, decided on the server', () => {
  const running = billingStateFromCompany(company(), NOW);
  const ended = billingStateFromCompany(company({ trial_ends_at: at(-2 * DAY) }), NOW);
  const cancelled = billingStateFromCompany(CANCELLED_SUBSCRIBER, NOW);

  it('offers a first trial to a company that is not provisioned yet, or whose card-free trial still runs', () => {
    expect(checkoutTrialDecision(null, false)).toEqual({ eligible: true, reason: 'first_trial' });
    expect(checkoutTrialDecision(running, false)).toEqual({ eligible: true, reason: 'first_trial' });
  });

  it('refuses a company whose trial ended', () => {
    expect(checkoutTrialDecision(ended, false)).toEqual({ eligible: false, reason: 'trial_used' });
  });

  it('refuses a company that ever had a subscription, on its own record or on Stripe\'s', () => {
    expect(checkoutTrialDecision(cancelled, false)).toEqual({ eligible: false, reason: 'prior_subscription' });
    expect(checkoutTrialDecision(running, true)).toEqual({ eligible: false, reason: 'prior_subscription' });
    expect(checkoutTrialDecision(null, true)).toEqual({ eligible: false, reason: 'prior_subscription' });
  });

  it('treats a state it cannot read as "no trial", never as "trial"', () => {
    expect(checkoutTrialDecision({} as never, false).eligible).toBe(false);
  });

  it('gives the 14 days the public pages promise', () => {
    expect(CHECKOUT_TRIAL_DAYS).toBe(TRIAL_DAYS);
  });

  it('the plan a running trial gets is the plan the app names in its trial wording', () => {
    // content/pricing.ts names the trial plan for every surface; the server grants it.
    // If the owner moves the trial tier (D2), both sides have to move together.
    expect(billingStateFromCompany(company(), NOW).plan).toBe(TRIAL_PLAN_ID);
  });
});

describe('trialDaysLeft', () => {
  it('rounds up: any part of a day left counts as a day', () => {
    expect(trialDaysLeft(at(9 * DAY), NOW)).toBe(9);
    expect(trialDaysLeft(at(9 * DAY - HOUR), NOW)).toBe(9);
    expect(trialDaysLeft(at(9 * DAY + HOUR), NOW)).toBe(10);
    expect(trialDaysLeft(at(DAY), NOW)).toBe(1);
    expect(trialDaysLeft(at(DAY - 1), NOW)).toBe(1);
    expect(trialDaysLeft(at(DAY + 1), NOW)).toBe(2);
    expect(trialDaysLeft(at(1), NOW)).toBe(1);
  });

  it('is 0 at the moment of expiry and never negative after it', () => {
    expect(trialDaysLeft(at(0), NOW)).toBe(0);
    expect(trialDaysLeft(at(-1), NOW)).toBe(0);
    expect(trialDaysLeft(at(-HOUR), NOW)).toBe(0);
    expect(trialDaysLeft(at(-400 * DAY), NOW)).toBe(0);
    expect(Object.is(trialDaysLeft(at(-1), NOW), 0)).toBe(true);
  });

  it('is null when there is no usable end date', () => {
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialDaysLeft(undefined, NOW)).toBeNull();
    expect(trialDaysLeft('', NOW)).toBeNull();
    expect(trialDaysLeft('soon', NOW)).toBeNull();
  });
});

describe('trialPillModel: what the app header says', () => {
  const name = PLANS[TRIAL_PLAN_ID].name;

  it('counts the days of a running card-free trial, naming it a Starter trial', () => {
    expect(trialPillModel({ trialActive: true, trialEndsAt: at(9 * DAY) }, NOW)).toMatchObject({
      kind: 'running',
      label: 'Starter trial: 9 days left',
      shortLabel: 'Trial: 9 days left',
    });
    expect(name).toBe('Starter');
  });

  it('says "1 day left", not "1 days left", on the last day', () => {
    expect(trialPillModel({ trialActive: true, trialEndsAt: at(3 * HOUR) }, NOW)?.label).toBe('Starter trial: 1 day left');
  });

  it('says the trial ended when the server says so', () => {
    expect(trialPillModel({ trialActive: false, trialEndsAt: at(-2 * DAY), trialEnded: true }, NOW)).toMatchObject({
      kind: 'ended',
      label: 'Starter trial ended',
      shortLabel: 'Trial ended',
    });
  });

  it('flips to "ended" on the clock when a tab outlives the trial it last heard about', () => {
    expect(trialPillModel({ trialActive: true, trialEndsAt: at(-HOUR) }, NOW)?.kind).toBe('ended');
    expect(trialPillModel({ trialActive: true, trialEndsAt: at(0) }, NOW)?.kind).toBe('ended');
  });

  it('shows nothing when there is no card-free trial to report', () => {
    // paid plan, Stripe trial, cancelled subscriber: none of them has trialActive or trialEnded
    expect(trialPillModel({ trialActive: false, trialEndsAt: at(-30 * DAY), trialEnded: false }, NOW)).toBeNull();
    // no end date to count down to (no database / company not provisioned yet)
    expect(trialPillModel({ trialActive: true, trialEndsAt: null }, NOW)).toBeNull();
    expect(trialPillModel({}, NOW)).toBeNull();
    expect(trialPillModel(null, NOW)).toBeNull();
    expect(trialPillModel(undefined, NOW)).toBeNull();
  });
});

describe('ended-trial wording', () => {
  it('says the trial ended, on which date, and what to do', () => {
    const endedAt = at(-2 * DAY);
    expect(trialEndedHeading()).toBe('Your Starter trial has ended');
    expect(trialEndedSentence(endedAt)).toBe(`Your Starter trial ended on ${new Date(endedAt).toLocaleDateString()}.`);
    const message = trialEndedMessage(endedAt);
    expect(message.startsWith(trialEndedSentence(endedAt))).toBe(true);
    expect(message).toContain('Choose a plan');
  });

  it('still reads well when the server sent no date', () => {
    expect(trialEndedSentence(undefined)).toBe('Your Starter trial ended.');
    expect(trialEndedMessage(undefined)).toMatch(/^Your Starter trial ended\. Choose a plan/);
    expect(trialEndedMessage('garbage')).toMatch(/^Your Starter trial ended\. Choose a plan/);
  });
});

// One field, one date. The countdown runs to companies.trial_ends_at; the ended pill, the
// paywall and Settings name the same instant, read from the same field on two different
// replies (GET /api/billing's trialEndsAt, the 402's trialEndedAt).
describe('the date the trial ended is the date the countdown ran to', () => {
  const ENDS_AT = at(9 * DAY);

  it('while it runs: Settings\' "Trial ends" date and the pill\'s countdown read the same field', () => {
    const state = JSON.parse(JSON.stringify(billingStateFromCompany(company({ trial_ends_at: ENDS_AT }), NOW)));
    expect(state.trialEndsAt).toBe(ENDS_AT);
    expect(trialDaysLeft(state.trialEndsAt, NOW)).toBe(9);
    expect(trialPillModel(state, NOW)?.detail).toBe(`Your Starter trial ends on ${new Date(ENDS_AT).toLocaleDateString()}.`);
  });

  it('once it ended: the 402, /api/billing, the pill tooltip and the paywall text all name that one date', () => {
    const row = company({ trial_ends_at: ENDS_AT });
    const later = new Date(NOW.getTime() + 11 * DAY); // two days after the trial ran out
    const state = billingStateFromCompany(row, later);
    // Each reply as it crosses the wire.
    const billing = JSON.parse(JSON.stringify(state));
    const refusal = JSON.parse(JSON.stringify(planAccessDecision(state, 'starter').body));
    const day = new Date(ENDS_AT).toLocaleDateString();

    expect(billing.trialEnded).toBe(true);
    expect(refusal.trialEndedAt).toBe(billing.trialEndsAt);
    expect(refusal.trialEndedAt).toBe(ENDS_AT);
    expect(trialPillModel(billing, later)?.detail).toBe(`Your Starter trial ended on ${day}.`);
    expect(trialEndedMessage(refusal.trialEndedAt)).toContain(`Your Starter trial ended on ${day}.`);
    expect(trialEndedMessage(billing.trialEndsAt)).toBe(trialEndedMessage(refusal.trialEndedAt));
  });

  it('the 402 names the date the state holds, not a second copy of it', () => {
    const state = billingStateFromCompany(company({ trial_ends_at: at(-2 * DAY) }), NOW);
    expect(planAccessDecision(state, 'starter').body.trialEndedAt).toBe(state.trialEndsAt);
  });
});

// A second free trial came back through a code path that never asked whether the company
// had one. These pin the shape that keeps it from coming back: one place attaches a trial
// to a subscription, it asks checkoutTrialDecision first, and nothing in the request but
// the price and the ask reaches that decision.
describe('where a trial can be attached to a subscription', () => {
  const root = resolve(__dirname, '..');
  const serverFiles = readdirSync(root).filter((file) => /^server.*\.cjs$/.test(file));
  const sources = new Map(serverFiles.map((file) => [file, readFileSync(resolve(root, file), 'utf8')]));
  const serverSource = sources.get('server.cjs')!;
  const checkoutRoute = (() => {
    const from = serverSource.indexOf("app.post('/api/checkout'");
    return serverSource.slice(from, serverSource.indexOf('\napp.', from + 10));
  })();

  it('is exactly one line of server code, inside POST /api/checkout', () => {
    // trial_end = 'now' (PATCH /api/subscription ends a trial) is not a grant.
    const grants = [...sources].flatMap(([file, source]) =>
      [...source.matchAll(/\btrial_period_days\b|\btrial_end\b(?!\s*=\s*'now')/g)].map(() => file),
    );
    expect(grants).toEqual(['server.cjs']);
    expect(checkoutRoute).toContain('trial_period_days');
  });

  it('runs only after checkoutTrialDecision says yes', () => {
    const decided = checkoutRoute.indexOf('checkoutTrialDecision(');
    expect(decided).toBeGreaterThan(-1);
    expect(decided).toBeLessThan(checkoutRoute.indexOf('decision.eligible'));
    expect(checkoutRoute.indexOf('decision.eligible')).toBeLessThan(checkoutRoute.indexOf('trial_period_days'));
    expect(checkoutRoute).toContain('trial_period_days: CHECKOUT_TRIAL_DAYS');
  });

  it('reads nothing from the request but the price and whether a trial was asked for', () => {
    expect(checkoutRoute.match(/req\.body/g)).toHaveLength(1);
    expect(checkoutRoute).toContain('const { priceId, trial } = req.body;');
  });
});
