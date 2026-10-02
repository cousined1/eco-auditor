// @vitest-environment node
/**
 * F-G-07 / F-G-12: one data layer, Postgres. The server used to carry a second,
 * in-memory backend. With no database it served a fixture company (its
 * facilities and entries), skipped the plan check and wrote leads and consent
 * records to JSON files; with a database that failed, the loaders fell back to
 * the same fixtures outside production, and in production with
 * ALLOW_SAMPLE_DATA=true. A missing or failing store now answers 503 on every
 * data route, in every environment, and there is nothing to fall back to.
 *
 * Real spawned servers (tests/helpers/spawn-server.ts), no Docker. On the code
 * before, the requests below answered 200 or 202 from the fixtures and files.
 */
import http from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Spawned } from './helpers/spawn-server';

const ROOT = resolve(__dirname, '..');
const FAKE_BILLING = resolve(__dirname, 'helpers', 'fake-billing-preload.cjs');
const TOKEN = 'data-layer-outage-token';
const CAMX = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-03-15' };
const CSV = 'scope,category,source,amount,unit,date\nScope 1,stationary_combustion,natural_gas,10,therms,2025-01-01\n';
const LEAD = { name: 'Outage Test', email: 'outage-test@example.com', message: 'data layer outage' };
// What the fixtures answered with: the sample company, one of its facilities, an entry id.
const FIXTURE_TEXT = /Green Table Foods|Sacramento HQ|seed-1/;

type Request = [method: string, path: string, body?: string | object];

// Every data route family that answered from the fixtures, a file, or past the skipped plan check.
const DATA_ROUTES: Request[] = [
  ['GET', '/api/emissions/summary?period=2026'],
  ['GET', '/api/emissions/trend?year=2026'],
  ['POST', '/api/calculate', { entries: [CAMX] }],
  ['GET', '/api/companies/41/facilities'],
  ['POST', '/api/companies/41/facilities', { name: 'Outage Plant', type: 'factory', city: 'Fresno' }],
  ['GET', '/api/facilities/5/emissions'],
  ['GET', '/api/company'],
  ['GET', '/api/entries'],
  ['POST', '/api/entries', CAMX],
  ['PATCH', '/api/entries/5', { amount: 2 }],
  ['DELETE', '/api/entries/5'],
  ['POST', '/api/ingest/csv?dry_run=1', CSV],
  ['POST', '/api/ingest/csv', CSV],
  ['GET', '/api/ingest/imports'],
  ['POST', '/api/ingest/imports/5/undo', {}],
  ['GET', '/api/reports'],
  ['GET', '/api/account/export'],
  ['POST', '/api/account/delete-data', {}],
  ['POST', '/api/leads', LEAD],
];

// The reads whose loaders fell back to the fixtures when their query failed.
const FALLBACK_ROUTES: Request[] = [
  ['GET', '/api/emissions/summary?period=2026'],
  ['GET', '/api/emissions/trend?year=2026'],
  ['POST', '/api/calculate', {}],
  ['GET', '/api/companies/41/facilities'],
  ['GET', '/api/facilities/5/emissions'],
  ['GET', '/api/entries'],
  ['GET', '/api/account/export'],
  ['POST', '/api/leads', LEAD],
];

let insforge: http.Server | null = null;
let noDatabase: Spawned;
let noDatabaseSignedIn: Spawned;
const failing = {} as Record<'development' | 'production', Spawned>;

function send(server: Spawned, [method, path, body]: Request): Promise<Response> {
  const text = typeof body === 'string';
  return fetch(`${server.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': text ? 'text/csv' : 'application/json' }),
    },
    body: body === undefined ? undefined : text ? body : JSON.stringify(body),
  });
}

/** "METHOD path status" per request, in order, and every body. */
async function answers(server: Spawned, requests: Request[]): Promise<{ lines: string[]; bodies: string }> {
  const lines: string[] = [];
  let bodies = '';
  for (const request of requests) {
    const res = await send(server, request);
    lines.push(`${request[0]} ${request[1]} ${res.status}`);
    bodies += await res.text();
  }
  return { lines, bodies };
}

const all503 = (requests: Request[]) => requests.map(([method, path]) => `${method} ${path} 503`);

beforeAll(async () => {
  // Stand-in for InsForge's GET /api/auth/sessions/current, what authGuard calls.
  insforge = http.createServer((req, res) => {
    const ok = req.headers.authorization === `Bearer ${TOKEN}` && (req.url ?? '').startsWith('/api/auth/sessions/current');
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { user: { id: 'a0000000-0000-4000-8000-0000000000aa', email: 'outage@example.com' } } : { error: 'invalid token' }));
  });
  await new Promise<void>((done) => { insforge!.listen(0, '127.0.0.1', () => done()); });
  const insforgeUrl = `http://127.0.0.1:${(insforge.address() as { port: number }).port}`;
  // The dev user of DEV_COMPANY_ID test-company-1 owned the fixture company.
  const devAuth = { ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: TOKEN, DEV_COMPANY_ID: 'test-company-1', ALLOW_SAMPLE_DATA: 'true' };
  [noDatabase, noDatabaseSignedIn, failing.development, failing.production] = await Promise.all([
    startServer(devAuth),
    startServer({ INSFORGE_BASE_URL: insforgeUrl, ALLOW_SAMPLE_DATA: 'true' }),
    startServer(devAuth, { fakePg: 'data-down' }),
    startServer({ NODE_ENV: 'production', ALLOW_SAMPLE_DATA: 'true', INSFORGE_BASE_URL: insforgeUrl }, { fakePg: 'data-down' }),
  ]);
}, 60_000);

afterAll(() => {
  for (const server of [noDatabase, noDatabaseSignedIn, failing.development, failing.production]) server?.stop();
  insforge?.close();
});

describe('no database configured: every data route answers 503, in development too', () => {
  it('the data routes, a lead included, answer 503 and not one fixture', async () => {
    const { lines, bodies } = await answers(noDatabase, DATA_ROUTES);
    expect(lines).toEqual(all503(DATA_ROUTES));
    expect(bodies).not.toMatch(FIXTURE_TEXT);
  });

  it('a consent record answers the retryable 503 (there is no file to fall back to, F-G-12)', async () => {
    const res = await send(noDatabase, ['POST', '/api/consent-audit', { consent: { analytics: true, preferences: false, marketing: false }, method: 'custom' }]);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Failed to record consent', retryable: true });
  });

  it('the blog API answers 503: no database is not "no posts"', async () => {
    const { lines } = await answers(noDatabase, [['GET', '/api/blog-posts'], ['GET', '/api/blog-posts/some-post']]);
    expect(lines).toEqual(['GET /api/blog-posts 503', 'GET /api/blog-posts/some-post 503']);
  });

  it('billing and trial status answer 503, not a made-up trial', async () => {
    const requests: Request[] = [['GET', '/api/billing'], ['GET', '/api/trial-status'], ['GET', '/api/emissions/summary?period=2026']];
    expect((await answers(noDatabaseSignedIn, requests)).lines).toEqual(all503(requests));
  });

  it('/health and /ready still answer 200: nothing configured is down', async () => {
    const { lines } = await answers(noDatabase, [['GET', '/api/health'], ['GET', '/ready']]);
    expect(lines).toEqual(['GET /api/health 200', 'GET /ready 200']);
  });
});

describe('a database that fails behind a passing plan check: no fixture fallback anywhere', () => {
  it.each(['development', 'production'] as const)('%s (production with ALLOW_SAMPLE_DATA=true) answers 503 and not one fixture', async (env) => {
    const { lines, bodies } = await answers(failing[env], FALLBACK_ROUTES);
    expect(lines).toEqual(all503(FALLBACK_ROUTES));
    expect(bodies).not.toMatch(FIXTURE_TEXT);
  });
});

// D-2 (VERIFY-FINAL-DATA): a facility id beyond bigint reached Postgres, which refuses it
// (22003, out of range); the route answered that as a store failure, 503 and an error log
// line, for a number that can never name a facility. In the data-down double everything
// but the company and billing rows fails, so a 404 is an answer that needed no query, and
// the control shows a well-formed id (up to 18 digits, DB_ID) does still reach the store.
describe('a facility id that cannot exist answers 404 without a query (D-2)', () => {
  const emissionsOf = (id: string) => send(failing.development, ['GET', `/api/facilities/${id}/emissions`]);

  it.each(['9999999999999999999', '99999999999999999999', '9223372036854775808', 'not-a-number'])('GET /api/facilities/%s/emissions', async (id) => {
    expect((await emissionsOf(id)).status).toBe(404);
  });

  it.each(['5', '999999999999999999'])('control: GET /api/facilities/%s/emissions reaches the database', async (id) => {
    expect((await emissionsOf(id)).status).toBe(503);
  });
});

// D-S6: the Stripe-backed routes check the token and nothing else (no plan check), so
// their first failure in an outage is the database, reached through ensureStripeCustomer.
// They answered 500; every other data route answers 503. `stripe` is the double of
// tests/helpers/fake-billing-preload.cjs, whose own pg is left alone (the data-down double
// answers), so nothing here can reach Stripe, and its call log proves the routes never
// asked it anything. POST /api/checkout/verify is not here: its first call is
// stripe.checkout.sessions.retrieve, which the double does not offer.
describe('the Stripe-backed routes with the database down answer 503, not 500 (D-S6)', () => {
  let billing: Spawned;
  let dir = '';
  let stripeLog = '';

  const stripeCalls = (): string[] =>
    existsSync(stripeLog)
      ? readFileSync(stripeLog, 'utf8').split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { call: string }).call)
      : [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'eco-outage-billing-'));
    stripeLog = join(dir, 'stripe-calls.jsonl');
    const { port } = insforge!.address() as { port: number };
    billing = await startServer(
      {
        INSFORGE_BASE_URL: `http://127.0.0.1:${port}`,
        STRIPE_SECRET_KEY: 'sk_test_double_never_sent_anywhere',
        STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_monthly',
        FAKE_BILLING_PG: 'real',
        FAKE_BILLING_LOG: stripeLog,
      },
      { fakePg: 'data-down', preload: [FAKE_BILLING] },
    );
    // Before any request: the server must hold the Stripe double, not the real SDK.
    if (stripeCalls().join() !== 'stripe.constructed') {
      billing.stop();
      throw new Error('the server did not load the Stripe double; refusing to send requests');
    }
  }, 60_000);

  afterAll(() => {
    billing?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['PATCH', '/api/subscription', { planId: 'starter', billing: 'monthly' }, 'Subscription change failed'],
    ['DELETE', '/api/subscription', undefined, 'Cancellation failed'],
    ['POST', '/api/checkout', { priceId: 'price_starter_monthly' }, 'Checkout session creation failed'],
    ['POST', '/api/portal', {}, 'Billing portal session creation failed'],
  ] as const)('%s %s answers 503 and keeps its own message', async (method, path, body, error) => {
    const res = await fetch(`${billing.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error });
  });

  it('never asked Stripe anything: the database failed first', () => {
    expect(stripeCalls()).toEqual(['stripe.constructed']);
  });
});

// VERIFY-FINAL-SEC, the same defect class as D-S6: four more catches logged the error and answered a
// fixed 500 when the store failed behind a passing plan check (the data-down double: the company and
// billing rows answer, everything else drops the connection). The pin that keeps the next one from
// appearing is tests/server-failure-status.test.ts.
describe('the report and account routes answer 503, not 500, when the store fails behind a passing plan check', () => {
  it.each([
    ['GET', '/api/reports', undefined, 'Failed to load reports'],
    ['GET', '/api/reports/5/download', undefined, 'Failed to load report PDF'],
    ['POST', '/api/reports/5/signoff', {}, 'Failed to sign off report'],
    ['POST', '/api/account/delete-data', {}, 'Failed to delete audit data'],
  ] as const)('%s %s answers 503 and keeps its own message', async (method, path, body, error) => {
    const res = await send(failing.development, [method, path, body]);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error });
  });
});

describe('one data layer in the source', () => {
  // ".data" as a path (the old file store's directory), not a property like event.data.
  const FORBIDDEN = /allowSampleData|ALLOW_SAMPLE_DATA|sample(?:Entries|Facilities|Companies|EmissionEntries)|memoryStore|LEADS_FILE|CONSENT_FILE|readLeads|ensureLeadsDir|appendConsentRecordToFile|ingestJobs|recordIngestJob|!pgPool\b|pgPool \?|(?:^|[\s'"`/\\(])\.data(?:[/'"`\\]|$)/m;

  it('no server module holds a sample store, a file store or a "no database" branch', () => {
    const files = readdirSync(ROOT).filter((name) => /^server.*\.cjs$/.test(name));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect({ file, found: FORBIDDEN.exec(readFileSync(resolve(ROOT, file), 'utf8'))?.[0] ?? null }).toEqual({ file, found: null });
    }
  });
});
