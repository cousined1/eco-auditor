/**
 * F-B-10 / F-B-18 end to end: the trial lifecycle through the real Express routes
 * and a real Postgres, as deployed (NODE_ENV=production, bearer-token auth). Stripe
 * is the one double (tests/helpers/fake-billing-preload.cjs with FAKE_BILLING_PG=real):
 * the real `stripe` module never loads, so nothing here reaches the network.
 *
 * Docker-based: run it by explicit path only (hermetic helpers, see e2e-helpers.ts).
 *
 *   journey    signs up with no company row, uses the app, and its trial runs out
 *   running    card-free trial, nine days left
 *   ended      trial over, nothing ever bought
 *   cancelled  trial over, a subscription bought and cancelled
 *   paid       active Growth subscription
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  registerExitSafety,
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-trial');
const PRELOAD = path.resolve(__dirname, 'helpers', 'fake-billing-preload.cjs').split(path.sep).join('/');

const USERS = {
  journey: { id: 'a1000000-0000-4000-8000-0000000000a1', email: 'journey@example.com' },
  running: { id: 'a2000000-0000-4000-8000-0000000000a2', email: 'running@example.com' },
  ended: { id: 'a3000000-0000-4000-8000-0000000000a3', email: 'ended@example.com' },
  cancelled: { id: 'a4000000-0000-4000-8000-0000000000a4', email: 'cancelled@example.com' },
  paid: { id: 'a5000000-0000-4000-8000-0000000000a5', email: 'paid@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `trial-token-${user}`;

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
let dir = '';
let stateFile = '';
let logFile = '';

function api(user: UserKey, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokenOf(user)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Billing = Record<string, unknown>;
const billing = async (user: UserKey) => (await (await api(user, 'GET', '/api/billing')).json()) as Billing;

function setStripeSubscriptions(subscriptions: Array<{ id: string; status: string }>) {
  writeFileSync(stateFile, JSON.stringify({ stripeSubscriptions: subscriptions }));
}

/** What the last checkout asked Stripe for. */
async function checkout(user: UserKey, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  writeFileSync(logFile, '');
  const res = await api(user, 'POST', '/api/checkout', body);
  expect(res.status, await res.clone().text()).toBe(200);
  const created = readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { call: string; params: Record<string, unknown> })
    .filter((entry) => entry.call === 'checkout.sessions.create');
  expect(created).toHaveLength(1);
  return created[0]!.params;
}

const STARTER_MONTHLY = { priceId: 'price_starter_monthly', trial: true };

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    dir = mkdtempSync(path.join(tmpdir(), 'eco-k16-trial-'));
    stateFile = path.join(dir, 'state.json');
    logFile = path.join(dir, 'stripe-calls.jsonl');
    setStripeSubscriptions([]);

    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    const users = Object.values(USERS);
    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${users.map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    // `journey` has no company row yet: the app provisions one, with the card-free trial, on first use.
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at, subscription_status, subscription_plan, subscription_current_period_end, stripe_customer_id, stripe_subscription_id) VALUES
         ('${USERS.running.id}', 'Running Co', 'other', now() + interval '9 days', NULL, NULL, NULL, NULL, NULL),
         ('${USERS.ended.id}', 'Ended Co', 'other', now() - interval '2 days', NULL, NULL, NULL, NULL, NULL),
         ('${USERS.cancelled.id}', 'Cancelled Co', 'other', now() - interval '30 days', 'canceled', 'starter', now() - interval '3 days', 'cus_old', 'sub_old'),
         ('${USERS.paid.id}', 'Paid Co', 'other', now() - interval '30 days', 'active', 'growth', now() + interval '20 days', 'cus_paid', 'sub_paid')`
    );

    mockInsforge = http.createServer((req, res) => {
      const key = (Object.keys(USERS) as UserKey[]).find((k) => req.headers.authorization === `Bearer ${tokenOf(k)}`);
      if (key && (req.url || '').startsWith('/api/auth/sessions/current')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ user: { id: USERS[key].id, email: USERS[key].email } }));
        return;
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
    });
    await new Promise<void>((resolveMock) => { mockInsforge!.listen(0, '127.0.0.1', () => resolveMock()); });

    const spawned = spawnServer(await freePort(), e2eEnv({
      NODE_ENV: 'production',
      DATABASE_URL: pgUrl(pgPort),
      INSFORGE_BASE_URL: `http://127.0.0.1:${(mockInsforge.address() as { port: number }).port}`,
      STRIPE_SECRET_KEY: 'sk_test_double_never_sent_anywhere',
      STRIPE_WEBHOOK_SECRET: 'whsec_double',
      STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_monthly',
      STRIPE_PRICE_STARTER_ANNUAL: 'price_starter_annual',
      STRIPE_PRICE_GROWTH_MONTHLY: 'price_growth_monthly',
      STRIPE_PRICE_GROWTH_ANNUAL: 'price_growth_annual',
      STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
      STRIPE_PRICE_PRO_ANNUAL: 'price_pro_annual',
      NODE_OPTIONS: `--require ${PRELOAD}`,
      FAKE_BILLING_PG: 'real',
      FAKE_BILLING_STATE_FILE: stateFile,
      FAKE_BILLING_LOG: logFile,
    }));
    cleanup.track(spawned.child);
    base = spawned.base;
    // The production boot migrates the runtime tables and seeds the blog first, which
    // can outlast the helper's 15 s default on a busy machine.
    await waitForServer(spawned, 90_000);

    // Before any request: the server must hold the Stripe double. The real SDK would try
    // the network, and this suite never calls Stripe.
    const constructed = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l.includes('"stripe.constructed"')) : [];
    if (constructed.length !== 1) throw new Error('the server did not load the Stripe double (NODE_OPTIONS preload); refusing to send requests');
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 180_000);

afterAll(async () => {
  if (mockInsforge) {
    try { mockInsforge.close(); } catch { /* already closed */ }
  }
  await cleanup.teardown();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/billing tells each company where it is', () => {
  it('a running card-free trial', async () => {
    expect(await billing('running')).toMatchObject({ active: true, plan: 'starter', status: 'trialing', trialActive: true, trialEnded: false, trialEligible: true });
  });

  it('a trial that ended with nothing bought', async () => {
    const state = await billing('ended');
    expect(state).toMatchObject({ active: false, plan: null, trialActive: false, trialEnded: true, trialEligible: false });
    const endsAt = Number(await psql(CONTAINER, `SELECT (extract(epoch from trial_ends_at) * 1000)::bigint FROM public.companies WHERE user_id = '${USERS.ended.id}'`));
    expect(Math.abs(Date.parse(String(state.trialEndsAt)) - endsAt)).toBeLessThan(2);
  });

  it('a cancelled subscriber, and a paying customer, are neither', async () => {
    expect(await billing('cancelled')).toMatchObject({ active: false, status: 'canceled', trialEnded: false, trialEligible: false });
    expect(await billing('paid')).toMatchObject({ active: true, plan: 'growth', status: 'active', trialEnded: false, trialEligible: false });
  });
});

describe('the plan gate says why an ended trial was refused', () => {
  it('reason trial_expired and the date, under the usual code', async () => {
    const res = await api('ended', 'GET', '/api/emissions/summary');
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, code: 'upgrade_required', requiredPlan: 'starter', reason: 'trial_expired' });
    const endsAt = Number(await psql(CONTAINER, `SELECT (extract(epoch from trial_ends_at) * 1000)::bigint FROM public.companies WHERE user_id = '${USERS.ended.id}'`));
    expect(Math.abs(Date.parse(String(body.trialEndedAt)) - endsAt)).toBeLessThan(2);
    // One field: the date the paywall names is, to the character, the date the countdown ran to.
    expect(body.trialEndedAt).toBe((await billing('ended')).trialEndsAt);
  });

  it('a cancelled subscriber gets the generic refusal, with no reason', async () => {
    const res = await api('cancelled', 'GET', '/api/emissions/summary');
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'upgrade_required', requiredPlan: 'starter' });
    expect(body).not.toHaveProperty('reason');
  });

  it('a running trial and a paid plan pass as before', async () => {
    expect((await api('running', 'GET', '/api/emissions/summary')).status).toBe(200);
    expect((await api('paid', 'GET', '/api/emissions/summary')).status).toBe(200);
  });
});

describe('checkout against real company rows', () => {
  it('no trial for a company whose card-free trial ended, nor one that cancelled a subscription', async () => {
    expect(await checkout('ended', STARTER_MONTHLY)).not.toHaveProperty('subscription_data');
    expect(await checkout('cancelled', STARTER_MONTHLY)).not.toHaveProperty('subscription_data');
  });

  it('14 days for a running card-free trial', async () => {
    expect((await checkout('running', STARTER_MONTHLY)).subscription_data).toEqual({ trial_period_days: 14 });
  });

  it('refuses it where Stripe lists a past subscription the company row does not show', async () => {
    setStripeSubscriptions([{ id: 'sub_elsewhere', status: 'canceled' }]);
    try {
      expect(await checkout('running', STARTER_MONTHLY)).not.toHaveProperty('subscription_data');
    } finally {
      setStripeSubscriptions([]);
    }
  });

  it('the audited journey: sign up, use the app, let the trial run out, click "Start free trial" again', async () => {
    // Day 0: no company row. Checkout would still offer the card trial...
    expect(await psql(CONTAINER, `SELECT count(*)::text FROM public.companies WHERE user_id = '${USERS.journey.id}'`)).toBe('0');
    expect((await checkout('journey', STARTER_MONTHLY)).subscription_data).toEqual({ trial_period_days: 14 });

    // ...and the first data request provisions the company with the card-free trial.
    expect((await api('journey', 'GET', '/api/emissions/summary')).status).toBe(200);
    expect(await billing('journey')).toMatchObject({ trialActive: true, trialEnded: false, trialEligible: true });

    // Day 15: the trial has run out.
    await psql(CONTAINER, `UPDATE public.companies SET trial_ends_at = now() - interval '1 day' WHERE user_id = '${USERS.journey.id}'`);
    expect(await billing('journey')).toMatchObject({ active: false, trialActive: false, trialEnded: true, trialEligible: false });
    const refused = await api('journey', 'GET', '/api/emissions/summary');
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ reason: 'trial_expired' });

    // The same click that used to hand out a second 14-day trial now sells the plan with none.
    expect(await checkout('journey', STARTER_MONTHLY)).not.toHaveProperty('subscription_data');
  });
});
