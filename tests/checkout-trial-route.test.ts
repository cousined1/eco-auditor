// F-B-18: who may get a free trial at checkout. The REAL `node server.cjs` runs with
// doubles for Postgres and Stripe (tests/helpers/fake-billing-preload.cjs): no Docker,
// no database, no network, and the real `stripe` module is never loaded. The doubles
// record the parameters of stripe.checkout.sessions.create, which is exactly where a
// second 14-day trial would be granted.
//
// Every company is created with a card-free trial clock (companies.trial_ends_at), so
// the clock alone cannot mean "already had a trial": it does once it has run out, or
// once a subscription was ever recorded for the company or the Stripe customer.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type Spawned } from './helpers/spawn-server';

const PRELOAD = path.resolve(__dirname, 'helpers', 'fake-billing-preload.cjs').split(path.sep).join('/');
const TOKEN = 'k16-checkout-token';
const USER_ID = '16161616-1616-1616-1616-161616161616';

// The length the public pages promise ("14-day free trial").
const PROMISED_TRIAL_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

type CompanyRow = Record<string, unknown>;

// The columns loadBillingState reads, for a company that never subscribed.
const company = (overrides: CompanyRow = {}): CompanyRow => ({
  trial_ends_at: iso(10),
  subscription_status: null,
  subscription_plan: null,
  subscription_billing_cycle: null,
  subscription_current_period_end: null,
  subscription_cancel_at_period_end: false,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  ...overrides,
});

const EXPIRED = company({ trial_ends_at: iso(-2) });

let dir = '';
let stateFile = '';
let logFile = '';
let insforge: http.Server;
let server: Spawned;

function setWorld(world: { company: CompanyRow | null; stripeSubscriptions?: Array<{ id: string; status: string }> }) {
  writeFileSync(stateFile, JSON.stringify({ stripeSubscriptions: [], ...world }));
  writeFileSync(logFile, '');
}

function stripeCalls(call: string): Array<Record<string, unknown>> {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { call: string; params: Record<string, unknown> })
    .filter((entry) => entry.call === call)
    .map((entry) => entry.params);
}

async function checkout(body: Record<string, unknown>) {
  const res = await fetch(`${server.base}/api/checkout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { url?: string; error?: string } };
}

/** What checkout asked Stripe for, and only that: a test that got no session fails here. */
function createdSession(): Record<string, unknown> {
  const created = stripeCalls('checkout.sessions.create');
  expect(created, 'exactly one Checkout Session is created').toHaveLength(1);
  return created[0]!;
}

const STARTER_MONTHLY = { priceId: 'price_starter_monthly', trial: true };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'eco-k16-checkout-'));
  stateFile = path.join(dir, 'state.json');
  logFile = path.join(dir, 'stripe-calls.jsonl');
  setWorld({ company: null });

  // Local stand-in for the InsForge auth backend that authGuard validates tokens against.
  insforge = http.createServer((req, res) => {
    const ok = req.headers.authorization === `Bearer ${TOKEN}` && (req.url || '').startsWith('/api/auth/sessions/current');
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { user: { id: USER_ID, email: 'k16-checkout@example.test' } } : { error: 'invalid token' }));
  });
  await new Promise<void>((resolve) => insforge.listen(0, '127.0.0.1', () => resolve()));
  const insforgeUrl = `http://127.0.0.1:${(insforge.address() as { port: number }).port}`;

  server = await startServer({
    NODE_OPTIONS: `--require ${PRELOAD}`,
    DATABASE_URL: 'postgres://fake:fake@127.0.0.1:1/fake',
    INSFORGE_BASE_URL: insforgeUrl,
    STRIPE_SECRET_KEY: 'sk_test_double_never_sent_anywhere',
    STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_monthly',
    STRIPE_PRICE_STARTER_ANNUAL: 'price_starter_annual',
    STRIPE_PRICE_GROWTH_MONTHLY: 'price_growth_monthly',
    STRIPE_PRICE_GROWTH_ANNUAL: 'price_growth_annual',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
    STRIPE_PRICE_PRO_ANNUAL: 'price_pro_annual',
    FAKE_BILLING_STATE_FILE: stateFile,
    FAKE_BILLING_LOG: logFile,
  });

  // Before any request: the server must hold the Stripe double. The real SDK would try
  // the network, and this suite never calls Stripe.
  if (stripeCalls('stripe.constructed').length !== 1) {
    server.stop();
    throw new Error('the server did not load the Stripe double (NODE_OPTIONS preload); refusing to send requests');
  }
}, 60_000);

afterAll(() => {
  server?.stop();
  insforge?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  setWorld({ company: null });
});

describe('checkout grants a free trial once per company (F-B-18)', () => {
  it('grants 14 days to a company that has never had a trial', async () => {
    setWorld({ company: null });
    const res = await checkout(STARTER_MONTHLY);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(createdSession().subscription_data).toEqual({ trial_period_days: PROMISED_TRIAL_DAYS });
  });

  it('still grants it while the card-free trial is running: only a trial that has run out counts as used', async () => {
    // Every company has a trial clock from its first page load. A rule that refused
    // on the clock being set would refuse everyone and end the card trial altogether.
    setWorld({ company: company({ trial_ends_at: iso(9) }) });
    const res = await checkout({ priceId: 'price_growth_monthly', trial: true });

    expect(res.status).toBe(200);
    expect(createdSession().subscription_data).toEqual({ trial_period_days: PROMISED_TRIAL_DAYS });
  });

  it('REFUSES a second trial to a company whose card-free trial has ended (the audited path)', async () => {
    setWorld({ company: EXPIRED });
    const res = await checkout(STARTER_MONTHLY);

    // The subscription is still sold, at once: no trial attached to it.
    expect(res.status).toBe(200);
    expect(createdSession()).not.toHaveProperty('subscription_data');
  });

  it('refuses it when the company row records a subscription Stripe no longer lists', async () => {
    setWorld({
      company: company({
        trial_ends_at: iso(5),
        stripe_customer_id: 'cus_old',
        stripe_subscription_id: 'sub_old',
        subscription_status: 'canceled',
        subscription_plan: 'starter',
      }),
      stripeSubscriptions: [],
    });
    const res = await checkout(STARTER_MONTHLY);

    expect(res.status).toBe(200);
    expect(createdSession()).not.toHaveProperty('subscription_data');
  });

  it('refuses it when Stripe lists a past subscription for the customer, whatever the company row says', async () => {
    setWorld({ company: company({ trial_ends_at: iso(9) }), stripeSubscriptions: [{ id: 'sub_old', status: 'canceled' }] });
    const res = await checkout(STARTER_MONTHLY);

    expect(res.status).toBe(200);
    expect(createdSession()).not.toHaveProperty('subscription_data');
  });

  it('first trial granted once, second refused: the same user, before and after the first trial was used', async () => {
    setWorld({ company: null });
    await checkout(STARTER_MONTHLY);
    expect(createdSession().subscription_data).toEqual({ trial_period_days: PROMISED_TRIAL_DAYS });

    // The trial ran, the customer cancelled: Stripe keeps the subscription, the
    // webhook recorded it on the company.
    setWorld({
      company: company({
        trial_ends_at: iso(-20),
        stripe_customer_id: 'cus_fake_1',
        stripe_subscription_id: 'sub_1',
        subscription_status: 'canceled',
        subscription_plan: 'starter',
      }),
      stripeSubscriptions: [{ id: 'sub_1', status: 'canceled' }],
    });
    await checkout(STARTER_MONTHLY);
    expect(createdSession()).not.toHaveProperty('subscription_data');
  });
});

describe('the client only asks; the server decides', () => {
  it('ignores a client-supplied trial length or subscription_data', async () => {
    setWorld({ company: EXPIRED });
    await checkout({
      ...STARTER_MONTHLY,
      trial_period_days: 90,
      trialDays: 90,
      trial_end: 4_102_444_800,
      subscription_data: { trial_period_days: 90 },
    });

    expect(createdSession()).not.toHaveProperty('subscription_data');
  });

  it('gives a first-time company the server\'s 14 days, never the length it asked for', async () => {
    setWorld({ company: null });
    await checkout({ ...STARTER_MONTHLY, trial_period_days: 90, subscription_data: { trial_period_days: 90 } });

    expect(createdSession().subscription_data).toEqual({ trial_period_days: PROMISED_TRIAL_DAYS });
  });

  it('attaches no trial unless one was asked for', async () => {
    setWorld({ company: null });
    await checkout({ priceId: 'price_starter_monthly' });

    expect(createdSession()).not.toHaveProperty('subscription_data');
  });

  it('attaches no trial to annual billing or to Pro, however the request is phrased', async () => {
    setWorld({ company: null });
    await checkout({ priceId: 'price_starter_annual', trial: true });
    expect(createdSession()).not.toHaveProperty('subscription_data');

    setWorld({ company: null });
    await checkout({ priceId: 'price_pro_monthly', trial: true });
    expect(createdSession()).not.toHaveProperty('subscription_data');
  });
});
