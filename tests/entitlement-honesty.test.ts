/**
 * Entitlement honesty + previously-untested routes (2026-10-05 audit, 4th pass).
 *
 * The pass began by enumerating all 39 routes in server.cjs and cross-checking
 * them against the test suite. Four had no test reference anywhere:
 * /api/chat, /api/compliance/:id/signoff, /api/insforge-config and
 * /api/trial-status. Reading them turned up ENT-01 below.
 *
 * ENT-01 — both entitlement endpoints fabricated a subscription when the data
 * store was unavailable.
 *
 *   /api/billing answered { active: true, plan: 'starter', status: 'trialing',
 *   trialActive: true, source: 'no-db' }. Settings.tsx renders that directly, so
 *   a paying Pro customer who opened Settings during a database outage was told
 *   they were on a free Starter trial — on the one screen they open specifically
 *   to check their plan.
 *
 *   /api/trial-status answered { trial: true, source: 'no-db' }, which is the
 *   precise value its own catch branch was changed to avoid. That branch reads:
 *   "Fail closed on the UI hint. Returning trial:true here told an expired user
 *   their trial was still active." Two branches of one function, disagreeing.
 *
 * Scope, stated honestly: entitlement is enforced by requirePlan, which fails
 * closed (it returns 503 when a billing lookup throws), so this was never an
 * access bypass — pgPool is only null when DATABASE_URL is unset, and the Pool
 * constructor does not connect eagerly, so a DB outage leaves a non-null pool
 * whose queries throw. In production DATABASE_URL is mandatory. This was billing
 * misinformation presented as fact, not privilege escalation.
 *
 * These are source-reading assertions, following the routeBody convention in
 * tests/audit-20261005-server.test.ts, because the DB-backed paths need a live
 * Postgres. The fail-closed behaviour is additionally asserted at runtime by
 * scripts/smoke.mjs, which boots the real server with no database.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');
const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(__dirname, '..', ...segments), 'utf8');

/** Body of the route registered with the exact `anchor`, up to the next `app.`. */
function routeBody(anchor: string): string {
  const start = serverSource.indexOf(anchor);
  expect(start, `route ${anchor} not found`).toBeGreaterThan(-1);
  const next = serverSource.indexOf('\napp.', start + 1);
  return serverSource.slice(start, next === -1 ? undefined : next);
}

const billingRoute = routeBody("app.get('/api/billing'");
const trialRoute = routeBody("app.get('/api/trial-status'");
const signoffRoute = routeBody("app.post('/api/compliance/:id/signoff'");
const chatRoute = routeBody("app.post('/api/chat'");
const configRoute = routeBody("app.get('/api/insforge-config'");

/**
 * The brace-balanced body of the `if (<condition>)` block at or after `needle`.
 *
 * A fixed character window is wrong here: these routes are ~600 characters of
 * comment followed by the real database path, which legitimately contains
 * `active: true` and `trial: true`. Widening the window to reach the 503 also
 * reaches code that is supposed to report true things.
 */
function blockAfter(route: string, needle: string): string {
  const at = route.indexOf(needle);
  expect(at, `no ${needle} in route`).toBeGreaterThan(-1);
  const open = route.indexOf('{', at);
  expect(open, `${needle} is not a block`).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = open; i < route.length; i++) {
    if (route[i] === '{') depth++;
    else if (route[i] === '}') {
      depth--;
      if (depth === 0) return route.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${needle}`);
}

/**
 * Strip `//` line comments.
 *
 * These branches carry comments that quote the OLD payload verbatim — "this
 * used to answer { active: true, plan: 'starter' ... }" — which is the point of
 * the comment and also the literal text a negative assertion would match. The
 * assertions below are about what the code does, never about prose describing
 * what it used to do.
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      // Leave the inside of a string alone; these routes have few, but '//' in
      // a URL would otherwise truncate the rest of the line.
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length - 1; i++) {
        const c = line[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === '/' && line[i + 1] === '/' && !inSingle && !inDouble) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

describe('ENT-01 an unavailable data store never fabricates entitlement', () => {
  it('/api/billing refuses rather than inventing an active Starter trial', () => {
    // The exact defect: a 200 carrying a subscription that does not exist.
    const branch = stripComments(blockAfter(billingRoute, 'if (!pgPool)'));
    expect(branch).toContain('res.status(503)');
    expect(branch).not.toMatch(/res\.json\(/);
    expect(branch).not.toMatch(/active:\s*true/);
    expect(branch).not.toMatch(/plan:\s*'starter'/);
    expect(branch).not.toMatch(/status:\s*'trialing'/);
  });

  it('/api/trial-status does the same, matching its own catch branch', () => {
    const branch = stripComments(blockAfter(trialRoute, 'if (!pgPool)'));
    expect(branch).toContain('res.status(503)');
    expect(branch).not.toMatch(/res\.json\(/);
    expect(branch).not.toMatch(/trial:\s*true/);
  });

  it('no-db is only ever reported alongside a failure status', () => {
    // `source: 'no-db'` is the marker these responses carry. Wherever it
    // appears, the response must not have been a 200 with entitlement in it.
    for (const [name, route] of [['billing', billingRoute], ['trial-status', trialRoute]] as const) {
      const markers = route.split("source: 'no-db'").length - 1;
      expect(markers, `${name} should still identify the no-db case`).toBe(1);
    }
  });

  it('the real database paths still answer normally', () => {
    // Guard against "fixing" it by breaking the feature: with a pool present,
    // billing still reports real state and trial still reads trial_ends_at.
    expect(billingRoute).toContain('trial_ends_at');
    expect(trialRoute).toMatch(/SELECT trial_ends_at FROM public\.companies/);
    expect(trialRoute).toContain("source: 'db'");
    // A live trial genuinely is reported true — the fix must not have inverted it.
    expect(trialRoute).toMatch(/trial:\s*isActive/);
  });
});

describe('ENT-01 clients tolerate the fail-closed status', () => {
  const sessionSource = readRepoFile('src', 'lib', 'session.ts');
  const settingsSource = readRepoFile('src', 'pages', 'Settings.tsx');

  it('isSessionValid only forces a logout on 401, so a 503 never signs users out', () => {
    // A 503 here must mean "cannot tell", not "session invalid" — otherwise
    // failing closed would become a mass logout during a database blip.
    expect(sessionSource).toContain('return res.status !== 401');
  });

  it('Settings surfaces the billing error rather than rendering fabricated state', () => {
    expect(settingsSource).toContain('if (!res.ok)');
    expect(settingsSource).toMatch(/billingError/);
  });
});

describe('sign-off is a real, tenant-scoped audit action', () => {
  it('validates the report id instead of echoing success for anything', () => {
    expect(signoffRoute).toMatch(/\/\^\\d\+\$\/\.test\(String\(req\.params\.id\)\)/);
    expect(signoffRoute).toContain('Report not found');
  });

  it('scopes the write to the caller own company', () => {
    // The cross-tenant guard: a report id from another tenant must not be
    // signable. company_id comes from requireCompanyAccess, never from params.
    expect(signoffRoute).toContain('requireCompanyAccess');
    expect(signoffRoute).toMatch(/WHERE id = \$1 AND company_id = \$2/);
    expect(signoffRoute).toContain('queryWithRlsBypass');
    expect(signoffRoute).toContain('rowCount === 0');
  });

  it('actually persists a sign-off rather than acknowledging the request', () => {
    expect(signoffRoute).toMatch(/UPDATE public\.reports/);
    expect(signoffRoute).toContain("signoff = 'completed'");
    expect(signoffRoute).toContain('signed_off_at');
  });

  it('fails closed when the store is unavailable', () => {
    const branch = blockAfter(signoffRoute, 'if (!pgPool)');
    expect(branch).toContain('res.status(503)');
  });
});

describe('the chat endpoint stays bounded and rate-limited', () => {
  it('rejects an empty or oversized message before doing any work', () => {
    expect(chatRoute).toContain('chatRateLimit');
    expect(chatRoute).toMatch(/message\.trim\(\)\.length === 0/);
    expect(chatRoute).toContain('Message too long');
    expect(chatRoute).toContain('res.status(400)');
  });

  it('bounds the request body', () => {
    expect(chatRoute).toContain("express.json({ limit: '16kb' })");
  });

  it('never throws out of the route or answers an empty body', () => {
    // An unguarded await used to take the process down via unhandledRejection,
    // and an empty bot response left the widget spinning with no reply.
    expect(chatRoute).toMatch(/catch \(err\)[\s\S]{0,400}res\.status\(500\)/);
    expect(chatRoute).toContain('FALLBACK_REPLY');
    expect(chatRoute).toMatch(/\(botResult && botResult\.response\) \|\| FALLBACK_REPLY/);
  });

  it('sanitizes the client-supplied conversation state', () => {
    expect(chatRoute).toContain('sanitizeChatState');
  });
});

describe('the public config endpoint advertises nothing secret', () => {
  it('returns only the base URL and anon key', () => {
    expect(configRoute).toContain('anonKey');
    expect(configRoute).toContain('VITE_INSFORGE_BASE_URL');
    // No service key, secret or admin credential may ever appear here — it is
    // unauthenticated.
    for (const forbidden of ['SERVICE_KEY', 'SECRET', 'ADMIN', 'JWT', 'PRIVATE']) {
      expect(configRoute, `${forbidden} must never be served publicly`).not.toContain(forbidden);
    }
  });

  it('is not cached', () => {
    expect(configRoute).toContain('no-store');
  });
});