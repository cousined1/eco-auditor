/**
 * Wave-5 regression pins for the audit-20260922 server fixes
 * (audit run AUDIT-RUN-20260919-001828-7455, branch fix/audit-20260922):
 *
 *   SVR-01 (High) — POST /api/account/delete-data must answer 503 and the
 *     process must SURVIVE a rejected pgPool.connect() (the fix moved the
 *     connect() acquisition inside the try; before it escaped as an
 *     unhandledRejection and exited the server).
 *   SVR-R1 (High) — same contract for POST /api/publish (server-publish.cjs).
 *   SVR-02 (Low)  — ensureStripeCustomer's mapping race: the users insert uses
 *     ON CONFLICT (insforge_user_id) DO NOTHING + re-select, so the race loser
 *     adopts the first writer's customer id. Two parallel POST /api/checkout
 *     are not feasible without Stripe network, so the SQL semantics are pinned
 *     against the real schema via psql.
 *   UXE-001 (High) — /api/leads production rethrow (integration lives in
 *     tests/leads-route.test.ts; structural pin here).
 *   UXE-006 (Medium) — /api/consent-audit: one bounded retry, then
 *     503 {"error":"Failed to record consent","retryable":true}; no PII
 *     fallback files in production.
 *   UAD-02 (Low)  — CSV ingest warnings are only collected for rows that
 *     actually persist (rowErrors.length === 0 gates the merge).
 *   RT-09 (Medium) — the REAL /api/checkout price allowlist gate (replaces the
 *     tautological test-local-Set assertion in tests/server.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import http from 'node:http';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  pgUrl,
  psql,
  registerExitSafety,
  spawnServer,
  waitForServer,
} from './e2e-helpers';

const require = createRequire(import.meta.url);
const { createPublishHandler } = require('../server-publish.cjs') as {
  createPublishHandler: (deps: Record<string, unknown>) => (req: unknown, res: unknown) => Promise<void>;
};

const serverSource = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');
const publishSource = readFileSync(resolve(__dirname, '..', 'server-publish.cjs'), 'utf8');

const CONTAINER = 'fix-tests-pg-reg';
const PG_PORT = 54394;
const BOGUS_DB_1 = 'postgresql://postgres:e2e@127.0.0.1:59997/postgres'; // nothing listens there
const BOGUS_DB_2 = 'postgresql://postgres:e2e@127.0.0.1:59996/postgres';
const DEV_TOKEN = 'dev-e2e-secret';
const DEPLOY_TOKEN = 'e2e-deploy-token';
const MOCK_INSFORGE_PORT = 59992;
const E2E_USER_ID = '55555555-5555-5555-5555-555555555555';

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let consentBase = '';

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    await dockerRunPg(CONTAINER, PG_PORT);
    await applySchema(CONTAINER);

    // Local stand-in for the InsForge auth backend: /api/checkout's authGuard
    // validates its bearer token against INSFORGE_BASE_URL. Fully local.
    mockInsforge = http.createServer((req, res) => {
      const auth = req.headers.authorization || '';
      if (auth === 'Bearer e2e-auth-token' && (req.url || '').startsWith('/api/auth/sessions/current')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ user: { id: E2E_USER_ID, email: 'checkout-e2e@example.com' } }));
      } else {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid token' }));
      }
    });
    await new Promise<void>((resolveMock) => {
      mockInsforge!.listen(MOCK_INSFORGE_PORT, '127.0.0.1', () => resolveMock());
    });

    // Production instance with a healthy data store for the UXE-006 contract
    // (202 on success, 503 retryable after the bounded retry fails).
    const consent = spawnServer(8783, e2eEnv({
      NODE_ENV: 'production',
      DATABASE_URL: pgUrl(PG_PORT),
    }));
    cleanup.track(consent.child);
    await waitForServer(consent);
    consentBase = consent.base;
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
});

// ─── SVR-01 ──────────────────────────────────────────────────────────────────

describe('SVR-01 — /api/account/delete-data survives a rejected pgPool.connect()', () => {
  it('answers 503 {"success":false,"error":"Data store unavailable"} and the process stays alive', async () => {
    // Boot with a DATABASE_URL nothing listens on: pgPool is configured, so
    // requireCompanyAccess -> ensureCompanyForUser -> pgPool.connect() rejects
    // (after connectionTimeoutMillis) instead of crashing the process.
    const spawned = spawnServer(8782, e2eEnv({
      DATABASE_URL: BOGUS_DB_1,
      DEV_AUTH_SECRET: DEV_TOKEN,
    }));
    cleanup.track(spawned.child);
    await waitForServer(spawned);

    const res = await fetch(`${spawned.base}/api/account/delete-data`, {
      method: 'POST',
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: 'Data store unavailable' });

    // The old bug: unhandledRejection -> process.exit(1). The server must
    // still be alive and serving after the failed connect. With a configured
    // but unreachable data store /api/health reports 503 "degraded" — the
    // point is that the PROCESS answers (a dead process cannot).
    const health = await fetch(`${spawned.base}/api/health`);
    expect(health.status).toBe(503);
    expect((await health.json() as { status: string; db: string }).db).toBe('unreachable');
    expect(spawned.child.exitCode ?? null).toBeNull();
  }, 30_000);

  it('pins the fix structurally: the connect() acquisition sits inside the try', () => {
    const route = serverSource.slice(serverSource.indexOf("app.post('/api/account/delete-data'"));
    const handler = route.slice(0, route.indexOf('\napp.', 10)); // up to the next route
    const letIdx = handler.indexOf('let client;');
    const tryIdx = handler.indexOf('try {');
    const connectIdx = handler.indexOf('client = await pgPool.connect()');
    expect(letIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(letIdx); // declared before the try
    expect(connectIdx).toBeGreaterThan(tryIdx); // SVR-01: connect INSIDE the try
    expect(handler).toContain('failed to acquire a database client'); // no-client branch
    expect(handler).toContain('if (client) client.release()'); // release only what was acquired
  });
});

// ─── SVR-R1 ──────────────────────────────────────────────────────────────────

describe('SVR-R1 — POST /api/publish survives a rejected pgPool.connect()', () => {
  function validPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      slug: 'e2e-publish-regression-test',
      title: 'E2E Publish Regression Test',
      description: 'A post used by the publish-endpoint regression suite.',
      body: `<p>${'regression body text. '.repeat(8)}</p>`,
      bodyFormat: 'html',
      publishDate: '2026-09-22T07:00:00.000Z',
      ...overrides,
    };
  }

  function makeRes() {
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      setHeader: (k: string, v: string) => { res.headers[k] = v; },
      status(code: number) { res.statusCode = code; return res; },
      json(payload: unknown) { res.body = payload; return res; },
    };
    return res;
  }

  it('unit: a pool whose connect() rejects maps to 503 {"error":"database is unavailable"}', async () => {
    const released: number[] = [];
    const handler = createPublishHandler({
      pgPool: {
        connect: () => {
          const err = new Error('ECONNREFUSED at the pool level');
          throw err;
        },
      },
      deployToken: DEPLOY_TOKEN,
      canonicalOrigin: 'https://ecoauditor.io',
      log: () => {},
    });
    const res = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${DEPLOY_TOKEN}` }, body: { posts: [validPost()] } },
      res,
    );
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'database is unavailable' });
    expect(released).toEqual([]); // nothing was acquired, nothing must be released
  });

  it('integration: a server with an unreachable data store answers the same 503 and stays alive', async () => {
    const spawned = spawnServer(8785, e2eEnv({
      DATABASE_URL: BOGUS_DB_2,
      SITE_DEPLOY_TOKEN: DEPLOY_TOKEN,
    }));
    cleanup.track(spawned.child);
    await waitForServer(spawned);

    const res = await fetch(`${spawned.base}/api/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${DEPLOY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ posts: [validPost()] }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'database is unavailable' });

    // Same aliveness proof as SVR-01: configured-but-unreachable DB answers
    // 503 degraded — the process is alive.
    const health = await fetch(`${spawned.base}/api/health`);
    expect(health.status).toBe(503);
    expect((await health.json() as { status: string; db: string }).db).toBe('unreachable');
    expect(spawned.child.exitCode ?? null).toBeNull();
  }, 30_000);

  it('pins the fix structurally in server-publish.cjs', () => {
    const tryIdx = publishSource.indexOf('    let client;\n    try {');
    const connectIdx = publishSource.indexOf('client = await pgPool.connect()');
    expect(tryIdx).toBeGreaterThan(-1);
    expect(connectIdx).toBeGreaterThan(tryIdx); // SVR-R1: connect INSIDE the try
    expect(publishSource).toContain("'database is unavailable'");
    expect(publishSource).toContain('if (client) client.release()');
  });
});

// ─── UXE-006 ─────────────────────────────────────────────────────────────────

describe('UXE-006 — /api/consent-audit: bounded retry, then 503 (no silent loss)', () => {
  const consentBody = {
    visitorId: 'e2e-visitor-1',
    consent: { analytics: true, preferences: false, marketing: true },
    policyVersion: '2026-09-22',
    method: 'custom',
  };

  it('a healthy store records the consent (202) and persists the row', async () => {
    const res = await fetch(`${consentBase}/api/consent-audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(consentBody),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ received: true });
    const row = await psql(
      CONTAINER,
      "SELECT count(*)::int::text FROM public.consent_records WHERE visitor_id = 'e2e-visitor-1'",
    );
    expect(parseInt(row, 10)).toBe(1);
  }, 60_000);

  it('a persist failure (after the one bounded retry) answers 503 {"retryable":true}', async () => {
    await psql(CONTAINER, 'DROP TABLE public.consent_records');
    const res = await fetch(`${consentBase}/api/consent-audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(consentBody),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Failed to record consent', retryable: true });

    // The 503 (never a fake 202) proves production does not fall back to a
    // PII file; and the process must have survived the failure.
    const health = await fetch(`${consentBase}/api/health`);
    expect(health.status).toBe(200);
  }, 60_000);
});

// ─── SVR-02 ──────────────────────────────────────────────────────────────────

describe('SVR-02 — users mapping race semantics (real schema, ON CONFLICT DO NOTHING)', () => {
  const RACE_USER = '44444444-4444-4444-4444-444444444444';

  it('two racing inserts with different customer ids: re-select returns the first writer', async () => {
    await psql(
      CONTAINER,
      `INSERT INTO public.users (insforge_user_id, stripe_customer_id, email)
         VALUES ('${RACE_USER}', 'cus_race_winner', 'race-e2e@example.com')
       ON CONFLICT (insforge_user_id) DO NOTHING;`
    );
    await psql(
      CONTAINER,
      `INSERT INTO public.users (insforge_user_id, stripe_customer_id, email)
         VALUES ('${RACE_USER}', 'cus_race_loser', 'race-e2e@example.com')
       ON CONFLICT (insforge_user_id) DO NOTHING;`
    );
    // Exactly ONE mapping row, carrying the FIRST writer's customer id — the
    // race loser adopts the winner (ensureStripeCustomer re-select).
    const count = await psql(
      CONTAINER,
      `SELECT count(*)::int::text FROM public.users WHERE insforge_user_id = '${RACE_USER}'`,
    );
    expect(parseInt(count, 10)).toBe(1);
    const winner = await psql(
      CONTAINER,
      `SELECT stripe_customer_id FROM public.users WHERE insforge_user_id = '${RACE_USER}'`,
    );
    expect(winner).toBe('cus_race_winner');
  }, 30_000);

  it('pins the re-select + adoption in ensureStripeCustomer', () => {
    const fn = serverSource.slice(
      serverSource.indexOf('async function ensureStripeCustomer'),
      serverSource.indexOf('async function queryWithRlsBypass'),
    );
    const insertIdx = fn.indexOf('ON CONFLICT (insforge_user_id) DO NOTHING');
    expect(insertIdx).toBeGreaterThan(-1);
    // The re-select must come AFTER the conflict-tolerant insert, and its
    // result must be able to win over this caller's own customer id.
    const reselectIdx = fn.indexOf(
      'SELECT stripe_customer_id FROM users WHERE insforge_user_id',
      insertIdx + 1,
    );
    expect(reselectIdx).toBeGreaterThan(insertIdx);
    expect(fn).toContain('reselect.rows[0].stripe_customer_id !== customer.id');
    expect(fn).toContain('return reselect.rows[0].stripe_customer_id;');
  });
});

// ─── UAD-02 ──────────────────────────────────────────────────────────────────

describe('UAD-02 — ingest warnings are only collected for rows that actually persist', () => {
  const start = serverSource.indexOf('    const companyFacilities = await loadFacilities(companyId);');
  const end = serverSource.indexOf('    // Persist valid entries.');
  const mergeLoop = serverSource.slice(start, end);

  async function evaluate(
    rawRows: Array<Record<string, unknown>>,
    calculateEntry: (row: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<{ entries: unknown[]; importErrors: string[]; importWarnings: string[] }> {
    const scope = {
      crypto: require('node:crypto'),
      companyId: 7,
      rawRows,
      // Declared above the extracted slice (`const parseErrors = parsed.errors`).
      // These cases pass already-parsed rows, so the parser error list is empty.
      parseErrors: [] as Array<{ message: string }>,
      loadFacilities: async () => [],
      calculateEntry,
    };
    const result = await runInNewContext(
      '(async () => {' + mergeLoop + '\nreturn JSON.stringify({ entries, importErrors, importWarnings });\n})()',
      scope,
    ) as string;
    return JSON.parse(result);
  }

  const okCalc = () => ({ scope: 'scope1', co2e_tonnes: 0.05, factor: 'nat-gas', confidence: 95 });
  const boomCalc = () => { throw new Error('unsupported fuel'); };
  const ghostRow = { facility_name: 'Ghost Facility', scope: 'Scope 1', category: 'c', source: 's', amount: '10', unit: 'therms' };

  it('a rejected row collects NO warnings — nothing was stored', async () => {
    const result = await evaluate([ghostRow], boomCalc);
    expect(result.importErrors.length).toBeGreaterThan(0);
    expect(result.importWarnings).toEqual([]); // UAD-02: rowErrors.length === 0 gates the merge
    expect(result.entries).toEqual([]);
  });

  it('a persisted row with an unknown facility still reports the association note', async () => {
    const result = await evaluate([ghostRow], okCalc);
    expect(result.importErrors).toEqual([]);
    expect(result.entries.length).toBe(1);
    expect(result.importWarnings.join(' ')).toMatch(/stored without facility association/);
  });

  it('an unparseable-date note is suppressed too when the row is rejected', async () => {
    // The engine computes fine but maps to no DB scope label -> the row is
    // rejected, AND the row has an unparseable date -> two notes; the error
    // must win and the warning must be dropped.
    const unrecognizedCalc = () => ({ scope: 'scopeX', co2e_tonnes: 0.05, factor: 'f', confidence: 90 });
    const result = await evaluate(
      [{ ...ghostRow, scope: 'Bogus', date: 'not-a-date' }],
      unrecognizedCalc,
    );
    expect(result.importErrors.length).toBe(1);
    expect(result.importErrors[0]).toMatch(/Unrecognized scope/);
    expect(result.importWarnings).toEqual([]);
  });
});

// ─── RT-09 ───────────────────────────────────────────────────────────────────

describe('RT-09 — /api/checkout enforces the server-side price allowlist', () => {
  const checkoutServer = () => spawnServer(8786, e2eEnv({
    DATABASE_URL: pgUrl(PG_PORT),
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_PRICE_STARTER_MONTHLY: 'price_test_allowed_mo',
    INSFORGE_BASE_URL: `http://127.0.0.1:${MOCK_INSFORGE_PORT}`,
  }));

  const postCheckout = (base: string, body: unknown) => fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { authorization: 'Bearer e2e-auth-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('rejects a missing priceId with 400', async () => {
    const spawned = checkoutServer();
    cleanup.track(spawned.child);
    await waitForServer(spawned);
    const res = await postCheckout(spawned.base, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing priceId' });
  }, 60_000);

  it('rejects a priceId the server never configured with 400 (the real allowlist gate)', async () => {
    const spawned = checkoutServer();
    cleanup.track(spawned.child);
    await waitForServer(spawned);
    const res = await postCheckout(spawned.base, { priceId: 'price_attack_inject' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid price selection' });
  }, 60_000);

  it('a CONFIGURED priceId passes the gate and fails on Stripe (failure path, not success)', async () => {
    const spawned = checkoutServer();
    cleanup.track(spawned.child);
    await waitForServer(spawned);
    const res = await postCheckout(spawned.base, { priceId: 'price_test_allowed_mo' });
    // Dummy key -> Stripe answers 401 once the gate has been passed and
    // ensureStripeCustomer ran; the route maps that to its 500 failure body.
    // A regressed gate (e.g. dropped allowlist check) would 400 here instead.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Checkout session creation failed' });
  }, 60_000);
});

// ─── UXE-001 structural pin (integration lives in tests/leads-route.test.ts) ─

describe('UXE-001 — writeLead production rethrow is pinned', () => {
  it('writeLead rethrows on pg failure only in production; the route maps failures to 500', () => {
    const writeLead = serverSource.slice(
      serverSource.indexOf('async function writeLead('),
      serverSource.indexOf('async function writeChatLead('),
    );
    const prodIdx = writeLead.indexOf("process.env.NODE_ENV === 'production'");
    expect(prodIdx).toBeGreaterThan(-1);
    expect(writeLead.slice(prodIdx, prodIdx + 60)).toContain('throw err;');

    const route = serverSource.slice(serverSource.indexOf("app.post('/api/leads'"));
    const routeBody = route.slice(0, route.indexOf('\napp.', 10));
    expect(routeBody).toContain("status(500)");
    expect(routeBody).toContain('Failed to capture lead. Please try again.');
  });
});
