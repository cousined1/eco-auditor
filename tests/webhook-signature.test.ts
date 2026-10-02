/**
 * F-G-04 (c) — /api/webhook must authenticate every delivery before acting on
 * it. A forged "subscription active" event is free access for anyone who can
 * reach the endpoint, so the signature check is a security control and needs a
 * behavioural test that fails when it is weakened. Mutation runs showed that
 * deleting the check, or verifying only when a Stripe-Signature header happens
 * to be present, left every CI-runnable test green.
 *
 * Needs no Docker and no Stripe network: stripe.webhooks.constructEvent verifies
 * offline, and invoice.paid is acknowledged without touching a data store. The
 * server runs with NODE_ENV=production, as deployed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  E2eCleanup,
  e2eEnv,
  freePort,
  registerExitSafety,
  spawnServer,
  waitForServer,
} from './e2e-helpers';

const require = createRequire(import.meta.url);
const Stripe = require('stripe') as new (key: string) => {
  webhooks: {
    generateTestHeaderString: (opts: { payload: string; secret: string; timestamp?: number }) => string;
  };
};

// Offline header generation only; this process makes no Stripe calls.
const signer = new Stripe('sk_test_dummy');
const WEBHOOK_SECRET = 'whsec_signature_guard_test';

const cleanup = new E2eCleanup();
let base = '';

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    const spawned = spawnServer(await freePort(), e2eEnv({
      NODE_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    }));
    cleanup.track(spawned.child);
    base = spawned.base;
    await waitForServer(spawned);
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 60_000);

afterAll(async () => {
  await cleanup.teardown();
});

let eventCounter = 0;
function invoicePaidPayload(): string {
  eventCounter += 1;
  return JSON.stringify({
    id: `evt_sig_guard_${Date.now()}_${eventCounter}`,
    object: 'event',
    created: Math.floor(Date.now() / 1000) - 5,
    type: 'invoice.paid',
    livemode: false,
    data: { object: { id: `in_sig_guard_${eventCounter}` } },
  });
}

function signed(payload: string, secret = WEBHOOK_SECRET, timestamp?: number): string {
  return signer.webhooks.generateTestHeaderString(
    timestamp === undefined ? { payload, secret } : { payload, secret, timestamp }
  );
}

async function deliver(payload: string, signature?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['stripe-signature'] = signature;
  return fetch(`${base}/api/webhook`, { method: 'POST', headers, body: payload });
}

async function expectRejected(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toMatch(/signature/i);
}

describe('F-G-04 — /api/webhook authenticates every delivery', () => {
  it('control: a delivery signed with the endpoint secret is acknowledged', async () => {
    const payload = invoicePaidPayload();
    const res = await deliver(payload, signed(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  }, 30_000);

  it('a delivery with NO Stripe-Signature header is rejected with 400', async () => {
    await expectRejected(await deliver(invoicePaidPayload()));
  }, 30_000);

  it('a delivery signed with a different secret is rejected with 400', async () => {
    const payload = invoicePaidPayload();
    await expectRejected(await deliver(payload, signed(payload, 'whsec_attacker_controlled')));
  }, 30_000);

  it('a body changed after signing is rejected with 400', async () => {
    const original = invoicePaidPayload();
    const header = signed(original);
    const tampered = original.replace('"invoice.paid"', '"customer.subscription.updated"');
    expect(tampered).not.toBe(original);
    await expectRejected(await deliver(tampered, header));
  }, 30_000);

  it('a correctly signed but stale delivery (outside the 5-minute tolerance) is rejected with 400', async () => {
    const payload = invoicePaidPayload();
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    await expectRejected(await deliver(payload, signed(payload, WEBHOOK_SECRET, anHourAgo)));
  }, 30_000);

  it('a header that is not a Stripe signature is rejected with 400', async () => {
    await expectRejected(await deliver(invoicePaidPayload(), 'not-a-signature'));
  }, 30_000);
});
