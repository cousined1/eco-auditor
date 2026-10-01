/**
 * RT-01 (High) + RT-02 (High) + RT-03 (Medium) — audit run
 * AUDIT-RUN-20260919-001828-7455, branch fix/audit-20260922.
 *
 * REAL /api/webhook route tests (server.cjs: express.raw + constructEvent +
 * the switch over event.type + non-2xx retryable-failure semantics).
 *
 * The old tests/stripe.test.ts "handleWebhookEvent" suite exercised a
 * client-side lookalike whose handlers discard their argument — a no-op table
 * that could not fail (RT-03). Those tests are gone; this file replaces them
 * against the route Stripe actually delivers to.
 *
 * Pattern: spawn-boot integration with a throwaway Postgres container
 * (fix-tests-pg-<pid>-<random>, Docker-assigned port), Stripe-signed events, and direct SQL
 * assertions via psql. The whole suite is wrapped so a crashed beforeAll
 * still tears the container and every spawned server down.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { ChildProcess } from 'node:child_process';
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

const require = createRequire(import.meta.url);
const Stripe = require('stripe') as new (key: string) => {
  webhooks: {
    generateTestHeaderString: (opts: { payload: string; secret: string }) => Promise<string>;
    constructEvent: (payload: unknown, sig: string | undefined, secret: string) => unknown;
  };
};

// Signature helper — a local Stripe instance used ONLY for offline header
// generation; the test process itself makes no Stripe network calls.
const sign = new Stripe('sk_test_dummy');

const CONTAINER = uniqueContainerName('fix-tests-pg');
const WEBHOOK_SECRET = 'whsec_testsecret';

const cleanup = new E2eCleanup();
let pgPort = 0;
// Webhooks need no auth backend: a port nothing listens on. The old fixed
// 59998 was the local e2e stack's live mock InsForge.
let insforgeUnreachable = '';
let baseA = '';
let childA: ChildProcess | null = null;

interface StripeEvent {
  id: string;
  object: 'event';
  created: number;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

let evtCounter = 0;
function stripeEvent(type: string, dataObject: Record<string, unknown>, created: number): StripeEvent {
  evtCounter += 1;
  return {
    id: `evt_e2e_${Date.now()}_${evtCounter}`,
    object: 'event',
    created,
    type,
    livemode: false,
    data: { object: dataObject },
  };
}

function subscriptionObject(customer: string, status: string, priceId: string): Record<string, unknown> {
  return {
    id: `sub_e2e_${customer}`,
    object: 'subscription',
    customer,
    status,
    current_period_end: 2000010000,
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          id: `si_e2e_${customer}`,
          object: 'subscription_item',
          current_period_end: 2000010000,
          price: { id: priceId, object: 'price' },
        },
      ],
    },
  };
}

async function postWebhook(
  event: StripeEvent,
  secret: string,
  headerOverride?: string
): Promise<Response> {
  const payload = JSON.stringify(event);
  const header = headerOverride ?? sign.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${baseA}/api/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
}

/** company subscription columns for a user, as [status, eventAtEpoch, plan]. */
async function companyRow(userId: string): Promise<[string, string, string]> {
  const out = await psql(
    CONTAINER,
    `SELECT subscription_status::text || '|' ||
            COALESCE(extract(epoch from subscription_event_at)::bigint::text, 'null') || '|' ||
            COALESCE(subscription_plan::text, 'null')
       FROM public.companies WHERE user_id = '${userId}'`
  );
  return out.split('|') as [string, string, string];
}

const USER_WM = '11111111-1111-1111-1111-111111111111'; // deleted -> stale active
const USER_REV = '22222222-2222-2222-2222-222222222222'; // active -> newer deleted
const USER_TIE = '33333333-3333-3333-3333-333333333333'; // same-second tie
const PRICE_ALLOWED = 'price_test_allowed_mo';

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    pgPort = await dockerRunPg(CONTAINER);
    insforgeUnreachable = `http://127.0.0.1:${await freePort()}`;
    await applySchema(CONTAINER);

    await psql(
      CONTAINER,
      `INSERT INTO auth.users (id, email) VALUES
         ('${USER_WM}', 'wm-e2e@example.com'),
         ('${USER_REV}', 'rev-e2e@example.com'),
         ('${USER_TIE}', 'tie-e2e@example.com')
       ON CONFLICT (id) DO NOTHING;
       INSERT INTO public.users (insforge_user_id, stripe_customer_id, email) VALUES
         ('${USER_WM}', 'cus_e2e_wm', 'wm-e2e@example.com'),
         ('${USER_REV}', 'cus_e2e_rev', 'rev-e2e@example.com'),
         ('${USER_TIE}', 'cus_e2e_tie', 'tie-e2e@example.com')
       ON CONFLICT (insforge_user_id) DO NOTHING;`
    );

    // RT-01 server under test. INSFORGE_BASE_URL is deliberately unreachable:
    // /api/webhook carries its own signature verification and needs no auth
    // backend. STRIPE_PRICE_STARTER_MONTHLY is configured so subscription
    // events with that price map to the starter plan (plan-mapping pin).
    const spawned = spawnServer(await freePort(), e2eEnv({
      DATABASE_URL: pgUrl(pgPort),
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_PRICE_STARTER_MONTHLY: PRICE_ALLOWED,
      INSFORGE_BASE_URL: insforgeUnreachable,
    }));
    cleanup.track(spawned.child);
    childA = spawned.child;
    baseA = spawned.base;
    await waitForServer(spawned);
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 180_000);

afterAll(async () => {
  await cleanup.teardown();
});

describe('RT-01 — /api/webhook signature + ack semantics (real route)', () => {
  it('valid signature + invoice.paid acks 200 {received:true} without touching Stripe', async () => {
    const event = stripeEvent('invoice.paid', { id: 'in_e2e_1' }, Math.floor(Date.now() / 1000) - 5);
    const res = await postWebhook(event, WEBHOOK_SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  }, 30_000);

  it('tampered signature (signed with a different secret) is rejected with 400', async () => {
    const event = stripeEvent('invoice.paid', { id: 'in_e2e_2' }, Math.floor(Date.now() / 1000) - 5);
    const res = await postWebhook(event, 'whsec_attacker_controlled');
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/signature/i);
  }, 30_000);

  it('checkout.session.completed whose subscription cannot be fetched answers >=500 so Stripe retries', async () => {
    // session.subscription is an id -> the handler calls
    // stripe.subscriptions.retrieve, which fails against the dummy key
    // (401 from Stripe). The route must surface that as a non-2xx (the
    // retryable contract at server.cjs: "acking 200 on a failed sync is how a
    // paying customer ends up with no entitlement and no recovery path").
    const event = stripeEvent(
      'checkout.session.completed',
      { id: 'cs_e2e_1', object: 'checkout.session', subscription: 'sub_e2e_retrieve_me' },
      Math.floor(Date.now() / 1000) - 5
    );
    const res = await postWebhook(event, WEBHOOK_SECRET);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
  }, 60_000);
});

describe('RT-02 — subscription_event_at watermark ordering (real webhook -> real Postgres)', () => {
  it('a stale "active" event arriving after "deleted" does NOT resurrect the cancellation', async () => {
    // 1. canceled@2000000000 applies (first event: subscription_event_at is NULL).
    const deleted = stripeEvent(
      'customer.subscription.deleted',
      subscriptionObject('cus_e2e_wm', 'canceled', PRICE_ALLOWED),
      2000000000
    );
    const deletedRes = await postWebhook(deleted, WEBHOOK_SECRET);
    expect(deletedRes.status).toBe(200);

    let row = await companyRow(USER_WM);
    expect(row[0]).toBe('canceled');
    expect(row[1]).toBe('2000000000');

    // 2. A STALE active@1999999999 arrives out of order — must be skipped.
    const stale = stripeEvent(
      'customer.subscription.updated',
      subscriptionObject('cus_e2e_wm', 'active', PRICE_ALLOWED),
      1999999999
    );
    const staleRes = await postWebhook(stale, WEBHOOK_SECRET);
    expect(staleRes.status).toBe(200); // correct skip is acked so Stripe stops retrying

    row = await companyRow(USER_WM);
    expect(row[0]).toBe('canceled');
    expect(row[1]).toBe('2000000000');
    // The stale event changed NOTHING: the row still reflects the deleted
    // event verbatim (its recognized price maps to the starter plan).
    expect(row[2]).toBe('starter');
  }, 60_000);

  it('a same-second "active" event cannot overwrite a canceled row (tie-break)', async () => {
    // Stripe's event.created has 1-second resolution; two events in the same
    // second used to let the last-arriving one win and flip canceled -> active.
    const deleted = stripeEvent(
      'customer.subscription.deleted',
      subscriptionObject('cus_e2e_tie', 'canceled', PRICE_ALLOWED),
      2000000002
    );
    expect((await postWebhook(deleted, WEBHOOK_SECRET)).status).toBe(200);

    const sameSecondActive = stripeEvent(
      'customer.subscription.updated',
      subscriptionObject('cus_e2e_tie', 'active', PRICE_ALLOWED),
      2000000002
    );
    expect((await postWebhook(sameSecondActive, WEBHOOK_SECRET)).status).toBe(200);

    const row = await companyRow(USER_TIE);
    expect(row[0]).toBe('canceled');
    expect(row[1]).toBe('2000000002');
  }, 60_000);

  it('reverse order sanity: active then NEWER deleted ends canceled (and maps the plan)', async () => {
    const active = stripeEvent(
      'customer.subscription.created',
      subscriptionObject('cus_e2e_rev', 'active', PRICE_ALLOWED),
      2000000000
    );
    const activeRes = await postWebhook(active, WEBHOOK_SECRET);
    expect(activeRes.status).toBe(200);
    const row = await companyRow(USER_REV);
    expect(row[0]).toBe('active');
    expect(row[2]).toBe('starter'); // STRIPE_PRICE_STARTER_MONTHLY mapping
    expect(row[1]).toBe('2000000000');

    const deleted = stripeEvent(
      'customer.subscription.deleted',
      subscriptionObject('cus_e2e_rev', 'canceled', PRICE_ALLOWED),
      2000000001
    );
    const deletedRes = await postWebhook(deleted, WEBHOOK_SECRET);
    expect(deletedRes.status).toBe(200);

    const row2 = await companyRow(USER_REV);
    expect(row2[0]).toBe('canceled');
    expect(row2[1]).toBe('2000000001');
  }, 60_000);
});

describe('RT-04/RT-05 wiring — extracted server-http-utils.cjs is what the server runs', () => {
  it('/api/video answers 206 with Content-Range from parseRange', async () => {
    const size = Number(
      (await import('node:fs')).statSync('static/eco-auditor-intro.mp4').size
    );
    const res = await fetch(`${baseA}/api/video`, { headers: { range: 'bytes=0-999' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-999/${size}`);
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  }, 30_000);

  it('/api/video answers 416 for a start beyond the file size', async () => {
    const res = await fetch(`${baseA}/api/video`, { headers: { range: 'bytes=99999999999-' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
  }, 30_000);

  it('GET / serves the HTML shell with Cache-Control: no-cache, no-transform (express.static setHeaders)', async () => {
    const res = await fetch(`${baseA}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
  }, 30_000);
});

describe('RT-01 — missing STRIPE_WEBHOOK_SECRET contract (second spawn)', () => {
  it('answers 503 {"error":"Webhook signature secret not configured"} and stays alive', async () => {
    // Kill server A first (per the suite contract) so the missing-secret spawn
    // is the only server in play for this assertion.
    childA?.kill('SIGTERM');
    if (childA && childA.pid && process.platform === 'win32') {
      const { spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/F', '/T', '/PID', String(childA.pid)], { stdio: 'ignore' });
    }
    childA = null;
    baseA = '';

    const spawned = spawnServer(await freePort(), e2eEnv({
      DATABASE_URL: pgUrl(pgPort),
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      // STRIPE_WEBHOOK_SECRET deliberately unset
      INSFORGE_BASE_URL: insforgeUnreachable,
    }));
    cleanup.track(spawned.child);
    await waitForServer(spawned);

    const event = stripeEvent('invoice.paid', { id: 'in_e2e_3' }, Math.floor(Date.now() / 1000) - 5);
    const payload = JSON.stringify(event);
    const header = sign.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await fetch(`${spawned.base}/api/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      body: payload,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Webhook signature secret not configured' });

    // The 503 is a controlled rejection, not a crash: the process must answer.
    const health = await fetch(`${spawned.base}/api/health`);
    expect(health.status).toBe(200);
  }, 60_000);
});
