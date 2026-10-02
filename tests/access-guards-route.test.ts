/**
 * F-G-04 (a) + (b) — tenant isolation and the plan gate, through the real
 * Express routes, a real Postgres and real bearer-token auth.
 *
 * Mutation runs showed that deleting the tenant check (requireCompanyAccess ->
 * resolveAuthorizedCompanyId) or the plan gate (requirePlan's 402) left every
 * test green: the CI-runnable suites ran without a database, where requirePlan
 * was skipped and tenants came from in-memory fixtures (both gone since F-G-07).
 * These tests fail when either control is removed.
 *
 * Setup: one throwaway Postgres (e2e-helpers), a local stand-in for the InsForge
 * auth backend that maps five bearer tokens to five users, and one server with
 * NODE_ENV=production (no dev auth), as deployed.
 *   a, b     two tenants on the default 14-day trial (Starter level)
 *   expired  trial over, no subscription
 *   starter  active Starter subscription
 *   growth   active Growth subscription
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
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

const CONTAINER = uniqueContainerName('fix-tests-pg-guards');

const USERS = {
  a: { id: 'a0000000-0000-4000-8000-00000000000a', email: 'tenant-a@example.com' },
  b: { id: 'b0000000-0000-4000-8000-00000000000b', email: 'tenant-b@example.com' },
  expired: { id: 'e0000000-0000-4000-8000-00000000000e', email: 'expired@example.com' },
  starter: { id: '50000000-0000-4000-8000-000000000005', email: 'starter@example.com' },
  growth: { id: '60000000-0000-4000-8000-000000000006', email: 'growth@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `guard-token-${user}`;

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
const company = {} as Record<UserKey, string>;
let facilityA = '';
let reportA = '';

const CSV_HEADER = 'scope,category,source,amount,unit,facility_name';
const scope1Row = (facility = '') => `Scope 1,stationary_combustion,natural_gas,1000,therms,${facility}`;
const SCOPE3_ROW = 'Scope 3,purchased_goods,purchased_goods,500000,USD,';
const csv = (...rows: string[]) => [CSV_HEADER, ...rows].join('\n') + '\n';

function api(user: UserKey, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${tokenOf(user)}` };
  let payload: string | undefined;
  if (typeof body === 'string') {
    headers['content-type'] = 'text/csv';
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${base}${path}`, { method, headers, body: payload });
}

/** Setup helper: fail beforeAll with the response body when a step misbehaves. */
async function must<T>(res: Response, status: number, step: string): Promise<T> {
  const text = await res.text();
  if (res.status !== status) throw new Error(`${step}: expected ${status}, got ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function rowCount(table: 'facilities' | 'emission_entries' | 'reports' | 'csv_import_events', companyId: string): Promise<number> {
  return Number(await psql(CONTAINER, `SELECT count(*)::int::text FROM public.${table} WHERE company_id = ${Number(companyId)}`));
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    const users = Object.values(USERS);
    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${users.map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    // Billing state is seeded directly: it is what requirePlan reads, and the
    // webhook that normally writes it is covered by webhook-route.test.ts.
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at, subscription_status, subscription_plan, subscription_current_period_end) VALUES
         ('${USERS.a.id}', 'Tenant A Co', 'other', now() + interval '14 days', NULL, NULL, NULL),
         ('${USERS.b.id}', 'Tenant B Co', 'other', now() + interval '14 days', NULL, NULL, NULL),
         ('${USERS.expired.id}', 'Expired Co', 'other', now() - interval '1 day', NULL, NULL, NULL),
         ('${USERS.starter.id}', 'Starter Co', 'other', now() - interval '1 day', 'active', 'starter', now() + interval '30 days'),
         ('${USERS.growth.id}', 'Growth Co', 'other', now() - interval '1 day', 'active', 'growth', now() + interval '30 days')`
    );
    const ids = await psql(CONTAINER, `SELECT user_id::text || '=' || id::text FROM public.companies`);
    for (const line of ids.split('\n')) {
      const [userId, id] = line.split('=');
      const key = (Object.keys(USERS) as UserKey[]).find((k) => USERS[k].id === userId);
      if (key && id) company[key] = id;
    }

    // Stand-in for InsForge's GET /api/auth/sessions/current (what authGuard calls).
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
    }));
    cleanup.track(spawned.child);
    base = spawned.base;
    await waitForServer(spawned);

    // Tenant A's data, created through the same routes a customer uses.
    const facility = await must<{ data: { id: number } }>(
      await api('a', 'POST', `/api/companies/${company.a}/facilities`, { name: 'Tenant A Plant', type: 'factory', city: 'Fresno' }),
      201, 'tenant A creates a facility');
    facilityA = String(facility.data.id);
    const ingest = await must<{ imported: number }>(
      await api('a', 'POST', '/api/ingest/csv', csv(scope1Row('Tenant A Plant'))), 200, 'tenant A imports a CSV');
    if (ingest.imported !== 1) throw new Error(`tenant A import stored ${ingest.imported} rows, expected 1`);
    // The undated row above is placed in the year it was imported, and a period
    // with no entries is no longer saved as a report (K3), so ask for this year.
    const report = await must<{ report_id: number }>(
      await api('a', 'POST', `/api/companies/${company.a}/reports/generate`, { period: String(new Date().getFullYear()) }), 200, 'tenant A generates a report');
    reportA = String(report.report_id);
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

describe('F-G-04 (a) — a tenant can never reach another tenant\'s data', () => {
  it('control: tenant A reads its own summary, facilities, facility emissions and report', async () => {
    expect((await api('a', 'GET', `/api/emissions/summary?company_id=${company.a}`)).status).toBe(200);
    const facilities = await api('a', 'GET', `/api/companies/${company.a}/facilities`);
    expect(facilities.status).toBe(200);
    expect(JSON.stringify(await facilities.json())).toContain('Tenant A Plant');
    expect((await api('a', 'GET', `/api/facilities/${facilityA}/emissions`)).status).toBe(200);
    const download = await api('a', 'GET', `/api/reports/${reportA}/download`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 60_000);

  it('B naming A\'s company id to READ is refused with 403', async () => {
    const reads: Array<[string, string, unknown?]> = [
      ['GET', `/api/emissions/summary?company_id=${company.a}`],
      ['GET', `/api/emissions/trend?company_id=${company.a}`],
      ['GET', `/api/companies/${company.a}/facilities`],
      ['POST', '/api/calculate', { company_id: company.a }],
    ];
    for (const [method, path, body] of reads) {
      const res = await api('b', method, path, body);
      expect({ method, path, status: res.status, body: await res.json() })
        .toEqual({ method, path, status: 403, body: { success: false, error: 'Forbidden' } });
    }
  }, 60_000);

  it('B naming A\'s company id to WRITE is refused with 403 and A\'s rows are untouched', async () => {
    const writes: Array<[string, string, unknown]> = [
      ['POST', `/api/companies/${company.a}/facilities`, { name: 'Planted by B', type: 'office', city: 'Elsewhere' }],
      ['POST', `/api/ingest/csv?company_id=${company.a}`, csv(scope1Row())],
      ['POST', `/api/companies/${company.a}/reports/generate`, { period: '2026' }],
    ];
    for (const [method, path, body] of writes) {
      const res = await api('b', method, path, body);
      expect({ method, path, status: res.status, body: await res.json() })
        .toEqual({ method, path, status: 403, body: { success: false, error: 'Forbidden' } });
    }
    expect({
      facilities: await rowCount('facilities', company.a),
      entries: await rowCount('emission_entries', company.a),
      reports: await rowCount('reports', company.a),
      signoff: await psql(CONTAINER, `SELECT signoff FROM public.reports WHERE id = ${Number(reportA)}`),
    }).toEqual({ facilities: 1, entries: 1, reports: 1, signoff: 'pending' });
  }, 60_000);

  // A's import is covered by tests/csv-import-route.test.ts (another tenant can neither list nor undo it).
  it('A\'s facility and report are invisible to B by id (404, as for ids that do not exist)', async () => {
    for (const path of [`/api/facilities/${facilityA}/emissions`, `/api/reports/${reportA}/download`]) {
      const res = await api('b', 'GET', path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    expect(await psql(CONTAINER, `SELECT signoff FROM public.reports WHERE id = ${Number(reportA)}`)).toBe('pending');
  }, 60_000);

  // F-A-18: the compliance-tracking routes were retired. They answer 410 to everyone,
  // before any lookup, so there is no data path to guard; this pins that they stay
  // retired (and leave A's report untouched) instead of silently coming back unguarded.
  it('the retired compliance routes answer 410 without data, for A and for B', async () => {
    for (const who of ['a', 'b'] as const) {
      for (const [method, path, body] of [
        ['GET', `/api/companies/${company.a}/compliance`, undefined],
        ['POST', `/api/compliance/${reportA}/signoff`, { company_id: company.a }],
      ] as Array<[string, string, unknown]>) {
        const res = await api(who, method, path, body);
        expect({ who, method, path, status: res.status, success: (await res.json() as { success?: boolean }).success })
          .toEqual({ who, method, path, status: 410, success: false });
      }
    }
    expect(await psql(CONTAINER, `SELECT signoff FROM public.reports WHERE id = ${Number(reportA)}`)).toBe('pending');
  }, 60_000);

  it('B\'s account export and delete-data are confined to B\'s company', async () => {
    const exported = await api('b', 'GET', '/api/account/export');
    expect(exported.status).toBe(200);
    const body = await exported.json() as { company: { id: unknown } };
    expect(String(body.company.id)).toBe(company.b);
    expect(JSON.stringify(body)).not.toContain('Tenant A Plant');

    expect((await api('b', 'POST', '/api/account/delete-data')).status).toBe(200);
    expect({ facilities: await rowCount('facilities', company.a), entries: await rowCount('emission_entries', company.a) })
      .toEqual({ facilities: 1, entries: 1 });
  }, 60_000);
});

describe('F-G-04 (b) — paid features stay behind the plan gate', () => {
  it('an expired trial without a subscription gets 402 upgrade_required, and nothing is stored', async () => {
    const calls: Array<[string, string, unknown?]> = [
      ['GET', '/api/emissions/summary'],
      ['GET', `/api/companies/${company.expired}/facilities`],
      ['POST', '/api/ingest/csv', csv(scope1Row())],
    ];
    for (const [method, path, body] of calls) {
      const res = await api('expired', method, path, body);
      const json = await res.json() as { code?: string; requiredPlan?: string };
      expect({ method, path, status: res.status, code: json.code, requiredPlan: json.requiredPlan })
        .toEqual({ method, path, status: 402, code: 'upgrade_required', requiredPlan: 'starter' });
    }
    expect(await rowCount('emission_entries', company.expired)).toBe(0);
    expect(await rowCount('csv_import_events', company.expired)).toBe(0);
  }, 60_000);

  it('a Starter account importing a Scope 3 row gets 402 naming the growth plan, and nothing is stored', async () => {
    const res = await api('starter', 'POST', '/api/ingest/csv', csv(scope1Row(), SCOPE3_ROW));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ success: false, code: 'upgrade_required', requiredPlan: 'growth' });
    expect(await rowCount('emission_entries', company.starter)).toBe(0);
  }, 60_000);

  it('a Starter account cannot calculate Scope 3 either (402)', async () => {
    const res = await api('starter', 'POST', '/api/calculate', {
      scope: 'Scope 3', category: 'purchased_goods', source: 'purchased_goods', amount: 500000, unit: 'USD',
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'upgrade_required', requiredPlan: 'growth' });
  }, 60_000);

  it('control: the same Starter account imports a Scope 1 file', async () => {
    const res = await api('starter', 'POST', '/api/ingest/csv', csv(scope1Row()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, imported: 1 });
    expect(await rowCount('emission_entries', company.starter)).toBe(1);
  }, 60_000);

  it('control: a Growth account imports the same Scope 3 row', async () => {
    const res = await api('growth', 'POST', '/api/ingest/csv', csv(SCOPE3_ROW));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, imported: 1 });
    expect(await rowCount('emission_entries', company.growth)).toBe(1);
  }, 60_000);
});
