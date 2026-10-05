/**
 * Audit run 2026-10-05 — server + workflow regression pins.
 *
 * BILL-01 (Critical) — POST /api/checkout/verify derived its ordering watermark
 * from the wall clock. The guard in syncSubscriptionRecord only accepts a write
 * when it is newer than the stored subscription_event_at, so a wall-clock
 * watermark always wins. Replaying an OLD checkout session id therefore
 * overwrote the customer's LIVE subscription with the old, canceled one and
 * answered verified:true. Buy Growth (session A), cancel, buy Pro (session B),
 * revisit the old confirmation link -> a paying Pro customer is 402'd off the
 * plan until the next genuine Stripe event. The watermark is now session.created.
 *
 * BILL-02 (Medium) — stripe.checkout.sessions.create had no idempotency key, so
 * two concurrent /api/checkout calls (double-click, or a retry after a network
 * timeout) both passed the "no active subscription" check and both created a
 * live, billable session.
 *
 * BILL-03 (Low) — reports.period is an unconstrained TEXT column and the
 * generate route validated nothing, unlike the summary route.
 *
 * The Stripe and Postgres network paths are not reachable from a unit test, so
 * these pin the decisions in source — the same structural approach the earlier
 * server regression suites use for Stripe-only logic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');

/**
 * Returns the body of the route registered with the exact `anchor`
 * (`app.post('/api/checkout', …`), up to the next `app.` registration (or EOF
 * for the last route). Anchoring on the method matters: a `GET /api/checkout`
 * 404 stub is registered before the real POST route.
 */
function routeBody(anchor: string): string {
  const start = serverSource.indexOf(anchor);
  expect(start, `route ${anchor} not found`).toBeGreaterThan(-1);
  const next = serverSource.indexOf('\napp.', start + 1);
  return serverSource.slice(start, next === -1 ? undefined : next);
}

const verifyRoute = routeBody("app.post('/api/checkout/verify'");
const checkoutRoute = routeBody("app.post('/api/checkout',");
const reportGenerateRoute = routeBody("app.post('/api/companies/:id/reports/generate'");

describe('BILL-01 checkout verify cannot roll back a live entitlement', () => {
  it('watermarks the sync with the session creation time, not the wall clock', () => {
    // A wall-clock watermark is newer than every stored subscription_event_at,
    // so the ordering guard can never reject a replayed old session.
    expect(verifyRoute).toContain('session.created');
    expect(verifyRoute).toMatch(/Number\.isFinite\(sessionCreated\)/);
    // The sync must receive the session-derived watermark.
    expect(verifyRoute).toMatch(/syncSubscriptionRecord\([\s\S]*?,\s*readAt\s*\)/);
  });

  it('does not pass a bare wall-clock timestamp to the sync', () => {
    // The exact defect: `const readAt = Math.floor(Date.now() / 1000);` with no
    // session-derived branch. Now it may only appear as the fallback.
    const bareClock = /const readAt = Math\.floor\(Date\.now\(\) \/ 1000\);/;
    expect(verifyRoute).not.toMatch(bareClock);
  });

  it('still verifies ownership of the session before syncing', () => {
    // The fix must not have relaxed the cross-account check.
    expect(verifyRoute).toMatch(/sessionCustomer !== customerId/);
    expect(verifyRoute).toContain('does not belong to your account');
  });
});

describe('BILL-02 checkout creation is idempotent', () => {
  it('passes an idempotency key when creating the checkout session', () => {
    expect(checkoutRoute).toContain('idempotencyKey');
    expect(checkoutRoute).toMatch(
      /checkout\.sessions\.create\(\s*sessionParams\s*,\s*\{\s*idempotencyKey\s*\}\s*\)/
    );
  });

  it('keeps the existing-subscription guard', () => {
    expect(checkoutRoute).toContain('subscription_exists');
    expect(checkoutRoute).toContain('findActiveSubscription');
  });
});

describe('BILL-03 report period is validated', () => {
  it('rejects a period that is not a 4-digit year', () => {
    expect(reportGenerateRoute).toMatch(/SUMMARY_PERIOD_PATTERN\.test\(period\)/);
    expect(reportGenerateRoute).toContain('period must be a 4-digit year');
    // The check must reject before the value reaches the insert.
    expect(reportGenerateRoute.indexOf('SUMMARY_PERIOD_PATTERN.test')).toBeLessThan(
      reportGenerateRoute.indexOf('INSERT INTO public.reports')
    );
  });
});

describe('shared ordering guard still forbids resurrecting a cancellation', () => {
  it('keeps the same-second tie-break that blocks an active-over-canceled overwrite', () => {
    // Untouched by this work, but it is the guard BILL-01 now relies on, so it
    // is pinned here rather than assumed.
    expect(serverSource).toContain('subscription_status IS DISTINCT FROM \'canceled\'');
    expect(serverSource).toContain('subscription_event_at < $9::timestamptz');
  });
});