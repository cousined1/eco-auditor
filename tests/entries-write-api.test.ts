/**
 * K2 — the server write API for emission entries and facilities, through the
 * real Express routes, a real Postgres (every repo migration applied, including
 * 20260930100000) and real bearer-token auth. Docker: one throwaway container
 * (tests/e2e-helpers.ts); run by explicit path.
 *
 *   F-D-01   plan, trial end and Scope 3 are enforced where the app writes
 *   F-E-05   every stored value is computed by the server; activity date sets the period
 *   F-E-12   the dashboard reflects a write at once
 *   F-X1-01  concurrent facility creation cannot pass the cap
 *   F-B-08   the export carries what was entered and applied
 *   D-1      until step 4, a browser-role write cannot set or change a pinned factor
 *   step 4   the deferred REVOKE draft closes the direct write path and leaves SELECT
 *
 * Tenants: a, b (default 14-day trial = Starter level), expired (trial over),
 * starter / growth (active subscriptions), race (trial, no facilities),
 * legacy (rows seeded in the pre-K2 shapes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  psqlFile,
  registerExitSafety,
  runCapture,
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-entries');
const REVOKE_DRAFT = resolve(__dirname, '..', 'docs', 'deferred-migrations', '20260930130000_revoke-authenticated-writes.sql');
const RUNBOOK = resolve(__dirname, '..', 'docs', 'runbooks', 'k2-rollout.md');
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION } = createRequire(import.meta.url)('../emission-factors.cjs');

const USERS = {
  a: { id: 'a1000000-0000-4000-8000-00000000000a', email: 'k2-a@example.com' },
  b: { id: 'b1000000-0000-4000-8000-00000000000b', email: 'k2-b@example.com' },
  expired: { id: 'e1000000-0000-4000-8000-00000000000e', email: 'k2-expired@example.com' },
  starter: { id: '51000000-0000-4000-8000-000000000005', email: 'k2-starter@example.com' },
  growth: { id: '61000000-0000-4000-8000-000000000006', email: 'k2-growth@example.com' },
  race: { id: '71000000-0000-4000-8000-000000000007', email: 'k2-race@example.com' },
  legacy: { id: '81000000-0000-4000-8000-000000000008', email: 'k2-legacy@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `k2-token-${user}`;

const CAMX = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-03-15' };
const SCOPE3 = { scope: 'Scope 3', category: 'purchased_goods', source: 'purchased_goods', amount: 500, unit: 'USD', activity_date: '2025-05-01' };
const THIS_YEAR = String(new Date().getUTCFullYear());

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
const company = {} as Record<UserKey, string>;
let entryA = '';

type Body = Record<string, unknown> & { data?: Record<string, unknown> };

function api(user: UserKey, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokenOf(user)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(CONTAINER, `SELECT count(*)::int::text FROM ${sql}`));
}

async function summaryTonnes(user: UserKey, period: string): Promise<number> {
  const res = await api(user, 'GET', `/api/emissions/summary?period=${period}`);
  expect(res.status).toBe(200);
  return ((await json(res)).data as { total_co2e_tonnes: number }).total_co2e_tonnes;
}

/**
 * Runs one statement as the browser's database role for `user`, the way the
 * records API does (role `authenticated`, the user's id as the JWT subject that
 * auth.uid() reads). Quiet mode: the output is the statement's rows only.
 */
async function asBrowser(user: UserKey, statement: string): Promise<string> {
  const res = await runCapture(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq'],
    { input: `SET ROLE authenticated;\nSET "request.jwt.claim.sub" = '${USERS[user].id}';\n${statement};\n`, timeoutMs: 30_000 },
  );
  if (res.code !== 0) throw new Error(res.stderr);
  return res.stdout.trim();
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${Object.values(USERS).map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at, subscription_status, subscription_plan, subscription_current_period_end) VALUES
         ('${USERS.a.id}', 'K2 A Co', 'other', now() + interval '14 days', NULL, NULL, NULL),
         ('${USERS.b.id}', 'K2 B Co', 'other', now() + interval '14 days', NULL, NULL, NULL),
         ('${USERS.expired.id}', 'K2 Expired Co', 'other', now() - interval '1 day', NULL, NULL, NULL),
         ('${USERS.starter.id}', 'K2 Starter Co', 'other', now() - interval '1 day', 'active', 'starter', now() + interval '30 days'),
         ('${USERS.growth.id}', 'K2 Growth Co', 'other', now() - interval '1 day', 'active', 'growth', now() + interval '30 days'),
         ('${USERS.race.id}', 'K2 Race Co', 'other', now() + interval '14 days', NULL, NULL, NULL),
         ('${USERS.legacy.id}', 'K2 Legacy Co', 'other', now() + interval '14 days', NULL, NULL, NULL)`
    );
    for (const line of (await psql(CONTAINER, 'SELECT user_id::text || \'=\' || id::text FROM public.companies')).split('\n')) {
      const [userId, id] = line.split('=');
      const key = (Object.keys(USERS) as UserKey[]).find((k) => USERS[k].id === userId);
      if (key && id) company[key] = id;
    }
    // InsForge's documented default for tables it manages (review R1 §4b): the
    // browser roles hold SELECT/INSERT/UPDATE/DELETE, and RLS checks ownership only.
    await psql(CONTAINER, `GRANT SELECT, INSERT, UPDATE, DELETE ON public.emission_entries, public.facilities TO anon, authenticated;
      GRANT SELECT ON public.companies TO authenticated; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated`);

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

describe('F-E-05 / F-E-12 — the server computes the entry, and the dashboard sees it at once', () => {
  it('a Starter-level trial saves a Scope 2 entry; every stored value is the server\'s, whatever the client sent', async () => {
    const res = await api('a', 'POST', '/api/entries', { ...CAMX, co2e_kg: 999_999, confidence: 5, method: 'EPA emission factor', factor: '1 kWh' });
    expect(res.status).toBe(201);
    entryA = String((await json(res)).data?.id);
    const stored = await psql(
      CONTAINER,
      `SELECT concat_ws('|', scope, category, source, amount, unit, activity_amount, activity_unit, factor_value, factor_source, co2e_kg,
              confidence, method, activity_date, catalog_version ~ '^2026-09-30\\+[0-9a-f]{12}$', created_at > now() - interval '5 minutes')
         FROM public.emission_entries WHERE id = ${Number(entryA)}`
    );
    expect(stored).toBe('Scope 2|purchased_electricity|CAMX|1000|kWh|1000|kWh|0.19504|epa-egrid-2023|195.04|97|calculation|2025-03-15|t|t');
  }, 60_000);

  it('the summary counts an entry in its activity year, within 1 s of the write', async () => {
    const before = await summaryTonnes('a', '2025'); // primes the 5-minute cache
    const started = Date.now();
    expect((await api('a', 'POST', '/api/entries', { ...CAMX, amount: 500, activity_date: '2025-06-01' })).status).toBe(201);
    const after = await summaryTonnes('a', '2025');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(before).toBeCloseTo(0.19504, 6);
    expect(after).toBeCloseTo(0.29256, 6);
    // Entered today, counted in 2025: nothing lands in the year it was typed.
    expect(await summaryTonnes('a', THIS_YEAR)).toBe(0);
  }, 60_000);
});

describe('F-D-01 — plan and trial limits hold where the app writes', () => {
  it('Scope 3 is 402 (naming Growth) for a Starter trial and a Starter subscription, and saves on Growth', async () => {
    for (const user of ['a', 'starter'] as const) {
      const res = await api(user, 'POST', '/api/entries', SCOPE3);
      expect({ user, status: res.status, body: await json(res) })
        .toMatchObject({ user, status: 402, body: { code: 'upgrade_required', requiredPlan: 'growth' } });
    }
    expect((await api('growth', 'POST', '/api/entries', SCOPE3)).status).toBe(201);
    expect(await count(`public.emission_entries WHERE scope = 'Scope 3' AND company_id IN (${company.a}, ${company.starter})`)).toBe(0);
  }, 60_000);

  it('a Scope 3 category relabelled as Scope 1 is refused and nothing is stored', async () => {
    const res = await api('a', 'POST', '/api/entries', { ...SCOPE3, scope: 'Scope 1', category: 'business_travel', source: 'business_travel' });
    expect(res.status).toBe(400);
    expect(await count(`public.emission_entries WHERE category = 'business_travel'`)).toBe(0);
  }, 60_000);

  it('after the trial ends, adding, editing and listing entries and adding a facility are 402; deleting its own entry still works (owner decision)', async () => {
    const own = await psql(
      CONTAINER,
      `WITH ins AS (INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit)
         VALUES (${company.expired}, 'Scope 1', 'stationary_combustion', 'natural_gas', 10, 'therms') RETURNING id)
       SELECT id::text FROM ins`
    );
    for (const [method, path, body] of [
      ['POST', '/api/entries', CAMX],
      ['PATCH', `/api/entries/${own}`, { amount: 20 }],
      ['GET', '/api/entries', undefined],
      ['POST', `/api/companies/${company.expired}/facilities`, { name: 'Expired Plant', type: 'office', city: 'Fresno' }],
    ] as Array<[string, string, unknown]>) {
      const res = await api('expired', method, path, body);
      expect({ method, status: res.status, body: await json(res) })
        .toMatchObject({ method, status: 402, body: { code: 'upgrade_required', requiredPlan: 'starter' } });
    }
    expect((await api('expired', 'DELETE', `/api/entries/${own}`)).status).toBe(200);
    expect(await count(`public.emission_entries WHERE company_id = ${company.expired}`)).toBe(0);
    expect(await count(`public.facilities WHERE company_id = ${company.expired}`)).toBe(0);
  }, 60_000);

  it('F-X1-01: six concurrent facility requests at a cap of 1 yield exactly one 201', async () => {
    const statuses = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      api('race', 'POST', `/api/companies/${company.race}/facilities`, { name: `Race Plant ${i}`, type: 'factory', city: 'Fresno' }).then((res) => res.status)));
    expect(statuses.sort()).toEqual([201, 402, 402, 402, 402, 402]);
    expect(await count(`public.facilities WHERE company_id = ${company.race}`)).toBe(1);
  }, 60_000);

  it('the cap is the plan\'s: seven concurrent requests on Growth (cap 5) yield exactly five', async () => {
    const statuses = await Promise.all(Array.from({ length: 7 }, (_, i) =>
      api('growth', 'POST', `/api/companies/${company.growth}/facilities`, { name: `Growth Plant ${i}`, type: 'office', city: 'Fresno' }).then((res) => res.status)));
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses.filter((status) => status === 402)).toHaveLength(2);
    expect(await count(`public.facilities WHERE company_id = ${company.growth}`)).toBe(5);
  }, 60_000);
});

describe('idempotency', () => {
  it('one Idempotency-Key stores one row, also when the requests race; the same key with another entry is 422', async () => {
    const headers = { 'idempotency-key': 'k2-docker-race-key-0001' };
    const raced = await Promise.all(Array.from({ length: 5 }, () => api('growth', 'POST', '/api/entries', { ...CAMX, amount: 42 }, headers)));
    const bodies = await Promise.all(raced.map(json));
    expect(raced.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(bodies.map((body) => String(body.data?.id))).size).toBe(1);
    expect(await count(`public.emission_entries WHERE idempotency_key = 'k2-docker-race-key-0001'`)).toBe(1);

    const replay = await api('growth', 'POST', '/api/entries', { ...CAMX, amount: 42 }, headers);
    expect(replay.status).toBe(200);
    expect((await api('growth', 'POST', '/api/entries', { ...CAMX, amount: 43 }, headers)).status).toBe(422);
    // Keys are per company: another tenant's identical key is its own entry.
    expect((await api('b', 'POST', '/api/entries', { ...CAMX, amount: 42 }, headers)).status).toBe(201);
  }, 60_000);
});

describe('tenant isolation on the new routes', () => {
  it('B cannot read, add to, edit or delete A\'s entries, nor attach A\'s facility', async () => {
    const facility = await json(await api('a', 'POST', `/api/companies/${company.a}/facilities`, { name: 'K2 A Plant', type: 'factory', city: 'Fresno' }));
    const facilityA = Number(facility.data?.id);
    const entriesBefore = await count(`public.emission_entries WHERE company_id = ${company.a}`);

    for (const [method, path, body, status] of [
      ['GET', `/api/entries?company_id=${company.a}`, undefined, 403],
      ['POST', '/api/entries', { ...CAMX, company_id: company.a }, 403],
      ['PATCH', `/api/entries/${entryA}`, { amount: 1 }, 404],
      ['DELETE', `/api/entries/${entryA}`, undefined, 404],
      ['POST', '/api/entries', { ...CAMX, facility_id: facilityA }, 400],
    ] as Array<[string, string, unknown, number]>) {
      const res = await api('b', method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status });
    }
    expect(await count(`public.emission_entries WHERE company_id = ${company.a}`)).toBe(entriesBefore);
    expect(await psql(CONTAINER, `SELECT activity_amount::text FROM public.emission_entries WHERE id = ${Number(entryA)}`)).toBe('1000');
    expect(await count(`public.emission_entries WHERE facility_id = ${facilityA}`)).toBe(0);
  }, 60_000);

  it('A edits its entry: recomputed, listed with factor, dataset, CO2e and activity date', async () => {
    const edited = await api('a', 'PATCH', `/api/entries/${entryA}`, { amount: 1300, co2e_kg: 1 });
    expect(edited.status).toBe(200);
    const list = await json(await api('a', 'GET', '/api/entries'));
    expect((list.data as unknown as Array<Record<string, unknown>>).find((entry) => String(entry.id) === entryA)).toMatchObject({
      activity_amount: 1300, activity_unit: 'kWh', factor_value: 0.19504, factor_source: 'epa-egrid-2023', co2e_kg: 253.552, activity_date: '2025-03-15',
    });
  }, 60_000);
});

describe('legacy rows (written before K2) summarise exactly as before', () => {
  it('a calculator row, a CSV row and a tampered calculator row: same totals, and the list shows what the totals count', async () => {
    const id = company.legacy;
    await psql(CONTAINER, `INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, co2e_kg, factor, method, confidence) VALUES
      (${id}, 'Scope 1', 'stationary_combustion', 'natural_gas', 6367.2, 'kg CO2e', 6367.2, '1200 therms', 'EPA emission factor', 85),
      (${id}, 'Scope 2', 'purchased_electricity', 'CAMX', 1, 'kg CO2e', 999999, '1000000 kWh', 'EPA emission factor', 85)`);
    await psql(CONTAINER, `INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, co2e_kg, factor, method, confidence, activity_date, created_at) VALUES
      (${id}, 'Scope 1', 'stationary_combustion', 'natural_gas', 1000, 'therms', 5306, '0.005306', 'calculation', 90, '2025-06-30', '2025-06-30T00:00:00Z')`);

    expect(await summaryTonnes('legacy', '2025')).toBeCloseTo(5.306, 6);
    expect(await summaryTonnes('legacy', THIS_YEAR)).toBeCloseTo(6.3682, 6);
    const list = (await json(await api('legacy', 'GET', '/api/entries'))).data as unknown as Array<Record<string, unknown>>;
    expect(list.map((entry) => Number(entry.co2e_kg)).sort((x, y) => x - y)).toEqual([1, 5306, 6367.2]);
    expect(list.every((entry) => entry.factor_source === null)).toBe(true);
  }, 60_000);
});

describe('F-B-08 — the export carries what was entered and applied', () => {
  it('entries with activity, factor, dataset, CO2e and activity date, plus report records and the import log', async () => {
    const res = await api('a', 'GET', '/api/account/export');
    expect(res.status).toBe(200);
    const body = await res.json() as { emissionEntries: Array<Record<string, unknown>>; reports: unknown[]; csvImports: unknown[] };
    expect(body.emissionEntries.find((entry) => String(entry.id) === entryA)).toMatchObject({
      activity_amount: '1300', activity_unit: 'kWh', factor_value: '0.19504', factor_source: 'epa-egrid-2023', co2e_kg: '253.552', activity_date: '2025-03-15',
    });
    expect(body.emissionEntries.every((entry) => !('idempotency_key' in entry))).toBe(true);
    expect(Array.isArray(body.reports)).toBe(true);
    expect(Array.isArray(body.csvImports)).toBe(true);
  }, 60_000);

  // The company row is the profile the customer enters in Settings (K5 added the reporting basis and the base year)
  // plus its dates; the provisioning flag, the onboarding timestamps, the user id and the billing columns stay out.
  it('the company row carries the reporting basis and the base year the company has, and no internal state', async () => {
    await psql(CONTAINER, `UPDATE public.companies SET consolidation_approach = 'operational_control', base_year = 2022 WHERE id = ${company.a}`);
    const set = await (await api('a', 'GET', '/api/account/export')).json() as { company: Record<string, unknown> };
    expect(String(set.company.id)).toBe(company.a);
    expect(set.company).toMatchObject({ consolidation_approach: 'operational_control', base_year: 2022 });
    expect(Object.keys(set.company).sort()).toEqual(['base_year', 'consolidation_approach', 'created_at', 'id', 'industry', 'name', 'trial_ends_at', 'updated_at']);
    // A company that never set them exports the defaults the Settings screen shows as "not specified" and "not set".
    const unset = await (await api('growth', 'GET', '/api/account/export')).json() as { company: Record<string, unknown> };
    expect(unset.company).toMatchObject({ consolidation_approach: 'unspecified', base_year: null });
  }, 60_000);
});

// Moved here from the spawned no-database tests (entries-route-nodb, csv-import-route-nodb,
// server.test's DATA-005), which ran on sample data the server no longer has (F-G-07).
describe('moved from the sample-data tests: validation, delete, units, DATA-005 (tenant b)', () => {
  // kg CO2e per MCF of natural gas at catalog 2026-09-30: 1,000 scf x (0.05444 kg CO2 + 0.00103 g CH4 x 28
  // + 0.00010 g N2O x 265) per scf, kept to the catalog's 6 significant figures (54.4953).
  const PER_MCF = Number((1000 * (0.05444 + (0.00103 * 28 + 0.0001 * 265) / 1000)).toPrecision(6));

  it('refuses an entry without an activity date, and a malformed Idempotency-Key', async () => {
    const res = await api('b', 'POST', '/api/entries', { ...CAMX, activity_date: undefined });
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toMatch(/activity_date is required/);
    expect((await api('b', 'POST', '/api/entries', CAMX, { 'idempotency-key': 'bad key' })).status).toBe(400);
  }, 60_000);

  it('a delete drops the entry from the summary at once, and a second delete is 404', async () => {
    const id = String((await json(await api('b', 'POST', '/api/entries', { ...CAMX, amount: 1300 }))).data?.id);
    const before = await summaryTonnes('b', '2025'); // primes the 5-minute cache
    expect((await api('b', 'DELETE', `/api/entries/${id}`)).status).toBe(200);
    expect(before - (await summaryTonnes('b', '2025'))).toBeCloseTo(0.253552, 6);
    expect((await api('b', 'DELETE', `/api/entries/${id}`)).status).toBe(404);
  }, 60_000);

  it('one unit conversion: /api/calculate converts ccf and refuses a hex amount; POST /api/entries stores 1,000 ccf as 100 MCF', async () => {
    const gas = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: '1,000', unit: 'ccf' };
    const calculated = await api('b', 'POST', '/api/calculate', { entries: [gas] });
    expect(calculated.status).toBe(200);
    expect((await json(calculated)).total_emissions_tCO2e).toBeCloseTo((100 * PER_MCF) / 1000, 6);
    const hex = await api('b', 'POST', '/api/calculate', { ...gas, amount: '0x1F', unit: 'therms' });
    expect(hex.status).toBe(400);
    expect(String((await json(hex)).error)).toMatch(/amount "0x1F" is not a plain number/);

    const stored = await api('b', 'POST', '/api/entries', { ...gas, amount: 1000, activity_date: '2025-05-31' });
    expect(stored.status).toBe(201);
    expect((await json(stored)).data).toMatchObject({
      amount: 100, unit: 'MCF', activity_amount: 1000, activity_unit: 'ccf', factor_value: PER_MCF, co2e_kg: expect.closeTo(100 * PER_MCF, 2),
    });
  }, 60_000);

  it('DATA-005: the export is a JSON attachment of the workspace; delete-data empties it and keeps the company', async () => {
    expect((await api('b', 'POST', `/api/companies/${company.b}/facilities`, { name: 'K2 B Plant', type: 'office', city: 'Fresno' })).status).toBe(201);
    type Export = { exportedAt: string; company: { id: unknown }; facilities: unknown[]; emissionEntries: unknown[] };
    const exported = await api('b', 'GET', '/api/account/export');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('application/json');
    expect(exported.headers.get('content-disposition')).toBe(`attachment; filename="ecoauditor-export-${company.b}.json"`);
    const before = await exported.json() as Export;
    expect(before.exportedAt).toBeTruthy();
    expect(String(before.company.id)).toBe(company.b);
    expect(before.facilities).toHaveLength(1);
    expect(before.emissionEntries.length).toBeGreaterThan(0);

    const deleted = await api('b', 'POST', '/api/account/delete-data', {});
    expect(deleted.status).toBe(200);
    expect(await json(deleted)).toEqual({ deleted: true, deletedEntries: before.emissionEntries.length, deletedFacilities: 1 });

    const after = await (await api('b', 'GET', '/api/account/export')).json() as Export;
    expect(after.emissionEntries).toEqual([]);
    expect(after.facilities).toEqual([]);
    expect(String(after.company.id)).toBe(company.b);
  }, 60_000);
});

describe('D-1 — until step 4, a browser-role write cannot set or change a pinned factor (trigger in 20260930100000)', () => {
  it('a records-API row sent with factor_value 0 is stored unpinned and summarised at the catalog factor, also after a records-API update', async () => {
    const id = await asBrowser('b', `WITH ins AS (INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, activity_date,
        factor_value, factor_source, catalog_version, activity_amount, activity_unit, idempotency_key, imported_at)
      VALUES (${company.b}, 'Scope 2', 'purchased_electricity', 'CAMX', 1000, 'kWh', '2024-03-01', 0, 'forged', 'forged', 1000, 'kWh', 'forged-key-0001', now())
      RETURNING id) SELECT id::text FROM ins`);
    await asBrowser('b', `UPDATE public.emission_entries SET factor_value = 0, amount = 2000 WHERE id = ${id}`);
    expect(await psql(CONTAINER, `SELECT num_nulls(activity_amount, activity_unit, factor_value, factor_source, catalog_version, idempotency_key, imported_at)
      || '|' || amount FROM public.emission_entries WHERE id = ${id}`)).toBe('7|2000');
    // 2000 kWh at CAMX's catalog factor, 0.19504 kg/kWh. Pinned at 0 it would count 0 t.
    expect(await summaryTonnes('b', '2024')).toBeCloseTo(0.39008, 6);
  }, 60_000);

  it('a records-API update of a server-priced row changes neither its pin nor its calculation, and the server still writes both', async () => {
    // notes may be edited; updated_at is bookkeeping that K4's trigger bumps on any UPDATE.
    const rowOf = () => psql(CONTAINER, `SELECT (to_jsonb(e) - 'notes' - 'updated_at')::text FROM public.emission_entries e WHERE id = ${Number(entryA)}`);
    const before = await rowOf();
    await asBrowser('a', `UPDATE public.emission_entries SET factor_value = 0.000001, factor_source = 'forged', catalog_version = 'forged',
      activity_amount = 1, activity_unit = 'USD', idempotency_key = 'forged-key-0002', imported_at = now(), scope = 'Scope 3',
      category = 'purchased_goods', source = 'purchased_goods', amount = 1, unit = 't CO2e', factor = 'forged', method = 'spend_based',
      confidence = 100, co2e_kg = 0, notes = 'edited in the console' WHERE id = ${Number(entryA)}`);
    expect(await rowOf()).toBe(before);
    expect(await psql(CONTAINER, `SELECT notes FROM public.emission_entries WHERE id = ${Number(entryA)}`)).toBe('edited in the console');

    // The server's own role is not affected: an API edit re-prices and re-pins.
    expect((await api('a', 'PATCH', `/api/entries/${entryA}`, { amount: 1400 })).status).toBe(200);
    expect(await psql(CONTAINER, `SELECT concat_ws('|', activity_amount, factor_value, factor_source, co2e_kg) FROM public.emission_entries WHERE id = ${Number(entryA)}`))
      .toBe('1400|0.19504|epa-egrid-2023|273.056');
    // entryA (1400 kWh) plus the 500 kWh entry of 2025-06-01, both at 0.19504 kg/kWh.
    expect(await summaryTonnes('a', '2025')).toBeCloseTo(0.370576, 6);
  }, 60_000);

  it('the runbook\'s old-bundle checks run as written: no pin the server did not write (an edited legacy row included), and a facility past the cap is listed', async () => {
    const block = /Two more checks[\s\S]*?```sql\n([\s\S]*?)```/.exec(readFileSync(RUNBOOK, 'utf8'))?.[1] ?? '';
    const [pins, facilities] = block.split(/;\s*\n/).filter((sql) => sql.includes('SELECT'));
    const bothIdentities = pins.replace("'<image identity>'", `'${CATALOG_VERSION}'`).replace("'<frozen identity>'", `'${LEGACY_CATALOG_VERSION}'`);
    expect(await psql(CONTAINER, bothIdentities)).toBe('');
    // VERIFY-FINAL-DATA D-6: a legacy row (no pin) whose date is edited is written with the FROZEN identity. The page
    // used to list only the image's identity, so its "expected: no rows" query reported that legitimate row.
    const legacyRow = await psql(CONTAINER, `SELECT id FROM public.emission_entries WHERE company_id = ${company.legacy} AND unit = 'therms' AND factor_value IS NULL`);
    const edited = await api('legacy', 'PATCH', `/api/entries/${legacyRow}`, { amount: 1000, unit: 'therms', activity_date: '2025-07-01' });
    expect(edited.status).toBe(200);
    expect(await psql(CONTAINER, `SELECT catalog_version FROM public.emission_entries WHERE id = ${legacyRow}`)).toBe(LEGACY_CATALOG_VERSION);
    expect(await psql(CONTAINER, bothIdentities)).toBe('');
    expect(await psql(CONTAINER, pins.replace("'<image identity>', '<frozen identity>'", `'${CATALOG_VERSION}'`))).toBe(`${LEGACY_CATALOG_VERSION}|1`);
    // A holds one facility, its Starter-trial cap; one more through the records API is past it.
    await asBrowser('a', `INSERT INTO public.facilities (company_id, name) VALUES (${company.a}, 'Console Plant')`);
    expect(await psql(CONTAINER, facilities)).toBe(`${company.a}|starter|2`);
  }, 60_000);
});

describe('K2 step 4 — the deferred REVOKE (docs/deferred-migrations, NOT a migration)', () => {
  it('before it, the browser role writes Scope 3 straight past the plan; after it, it cannot write either table, can still read, and the API still writes', async () => {
    const insertScope3 = `WITH ins AS (INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit)
      VALUES (${company.a}, 'Scope 3', 'purchased_goods', 'purchased_goods', 1, 'USD') RETURNING id) SELECT id::text FROM ins`;
    expect(await asBrowser('a', insertScope3)).toMatch(/^\d+$/); // the K2 hole, at the database
    const readable = await asBrowser('a', 'SELECT count(*)::text FROM public.emission_entries');

    await psqlFile(CONTAINER, readFileSync(REVOKE_DRAFT, 'utf8'));

    await expect(asBrowser('a', insertScope3)).rejects.toThrow(/permission denied for table emission_entries/);
    await expect(asBrowser('a', `UPDATE public.emission_entries SET amount = 2 WHERE id = ${Number(entryA)}`)).rejects.toThrow(/permission denied/);
    await expect(asBrowser('a', `DELETE FROM public.emission_entries WHERE id = ${Number(entryA)}`)).rejects.toThrow(/permission denied/);
    await expect(asBrowser('a', `INSERT INTO public.facilities (company_id, name) VALUES (${company.a}, 'SDK Plant')`)).rejects.toThrow(/permission denied for table facilities/);
    expect(await asBrowser('a', 'SELECT count(*)::text FROM public.emission_entries')).toBe(readable);

    // The draft's own verify query, as written in its header.
    const verify = /--\s+(SELECT concat_ws\('\|',[\s\S]*?\)\);)/.exec(readFileSync(REVOKE_DRAFT, 'utf8'))?.[1].replace(/\n--/g, '\n');
    expect(verify).toBeDefined();
    expect(await psql(CONTAINER, verify!.replace(/;$/, ''))).toBe('f|f|f|f|f|f|t|t');
    expect(await psql(CONTAINER, `SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('emission_entries','facilities')`))
      .toBe('emission_entries_owner_select,facilities_owner_select');

    // The server connects as its own role: the app keeps working.
    expect((await api('growth', 'POST', '/api/entries', { ...CAMX, amount: 5 })).status).toBe(201);
  }, 60_000);
});
