/**
 * K4 — the CSV import through the real Express routes, a real Postgres (every
 * repo migration applied, 20260930120000 included) and real bearer-token auth.
 * Docker: one throwaway container (tests/e2e-helpers.ts); run by explicit path.
 *
 *   F-E-04 = F-B-06  the same file twice: 409 and unchanged totals; a file with
 *                    errors stores nothing; concurrent uploads make one import
 *   F-E-13           converted units stored with what the file said; strict amounts
 *   F-E-18, F-R2-01  created_at = insert time, activity_date decides the period,
 *                    legacy rows keep their FY totals, undated rows are warned about
 *   F-C-06           history and undo (tenant-scoped; signed-off report warning)
 *   quota            dry runs, refusals and undo spend nothing; commits do
 *   import_id        the browser roles can neither link nor unlink a row
 *
 * Expected factors are worked out by hand from the catalog (KG_PER below), so a
 * changed factor fails this test until someone derives the new value.
 *
 * Tenants: audit/partial (trials), units/race (Growth), legacy (rows in the
 * pre-K4 shapes), quota (a trial near its monthly limit), signed (a signed-off
 * report), b (another tenant), preview (the check against the Dashboard).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  registerExitSafety,
  runCapture,
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const require = createRequire(import.meta.url);
const { CATALOG_VERSION } = require('../server-entries.cjs');

const CONTAINER = uniqueContainerName('fix-tests-pg-csv');

const USERS = {
  audit: { id: 'a4000000-0000-4000-8000-00000000000a', email: 'k4-audit@example.com' },
  partial: { id: 'a4000000-0000-4000-8000-00000000000b', email: 'k4-partial@example.com' },
  units: { id: 'a4000000-0000-4000-8000-00000000000c', email: 'k4-units@example.com' },
  race: { id: 'a4000000-0000-4000-8000-00000000000d', email: 'k4-race@example.com' },
  legacy: { id: 'a4000000-0000-4000-8000-00000000000e', email: 'k4-legacy@example.com' },
  quota: { id: 'a4000000-0000-4000-8000-00000000000f', email: 'k4-quota@example.com' },
  signed: { id: 'a4000000-0000-4000-8000-000000000010', email: 'k4-signed@example.com' },
  b: { id: 'a4000000-0000-4000-8000-000000000011', email: 'k4-b@example.com' },
  preview: { id: 'a4000000-0000-4000-8000-000000000012', email: 'k4-preview@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `k4-token-${user}`;
const THIS_YEAR = String(new Date().getUTCFullYear());

// kg CO2e per `unit`, worked out by hand from emission-factors.json (catalog 2026-09-30, which prices a new
// row; "was" = catalog 2026-07-24): the CO2 plus the CH4 and N2O grams a source's `citation` lists, at the
// AR5 GWP-100 of `gwpBasis` (CH4 28, N2O 265), kept to the catalog's 6 significant figures.
const sf6 = (x: number) => Number(x.toPrecision(6));
const KG_PER: Record<string, number> = {
  'stationary_combustion/natural_gas/therms': sf6((53.06 + (1.0 * 28 + 0.1 * 265) / 1000) / 10), // Hub Table 1 per mmBtu / 10: 5.31145 (was 5.306)
  'stationary_combustion/natural_gas/MCF': sf6(1000 * (0.05444 + (0.00103 * 28 + 0.0001 * 265) / 1000)), // Table 1 per scf x 1,000: 54.4953 (was 54.44)
  'stationary_combustion/wood/short tons': (126 * 28 + 63 * 265) / 1000, // Table 1, CH4 and N2O only: 20.223 (was 1,640); the 1,640 kg CO2 is biogenic, outside the scopes
  'fugitive_emissions/refrigerant_r22/kg': 1760, // AR5 GWP-100, unchanged, but reported beside the scopes now (memo:non-kyoto)
  'fugitive_emissions/refrigerant_r410a/kg': 1924, // AR5 GWP-100 (unchanged)
  'purchased_electricity/CAMX/kWh': 0.19504, // eGRID2023 (unchanged)
  'purchased_electricity/RFCE/kWh': 0.27179, // eGRID2023 (unchanged)
  'purchased_goods/paper/kg': 0.94, // (unchanged)
  'business_travel/rental_car/miles': sf6(0.297 + (0.0059 * 28 + 0.0053 * 265) / 1000), // Table 10 passenger car: 0.29857 (was 0.404)
};
/** kg CO2e per `unit` for a catalog source, as the importer pins it. */
const kgPer = (category: string, source: string, unit: string): number => KG_PER[`${category}/${source}/${unit}`]!;
const tonnes = (category: string, source: string, unit: string, amount: number) => (amount * kgPer(category, source, unit)) / 1000;

// Lane E's LOCAL_STACK file (evidence/lane-e/stack-common.mjs CSV_2025_2026)
// without the "therm" row the old importer refused, and with its RENEWABLE
// contract row moved to renewable_electricity (catalog 2026-09-30 has no
// RENEWABLE source). Before K4 a second identical import counted every row
// again. With the audit's catalog (2026-07-24) its FY2026 was the audit's case:
// 39.306 t Scope 1 (5.306 + 16.4 + 17.6) and 19.504 t Scope 2 (RENEWABLE at 0).
const AUDIT_FILE = [
  'scope,category,source,amount,unit,date',
  'Scope 1,stationary_combustion,natural_gas,1000,therms,2026-03-15',
  'Scope 1,stationary_combustion,wood,10,short tons,2026-04-10',
  'Scope 1,fugitive_emissions,refrigerant_r22,10,kg,2026-05-01',
  'Scope 2,purchased_electricity,CAMX,100000,kWh,2026-02-01',
  'Scope 2,renewable_electricity,CAMX,100000,kWh,2026-06-01',
  'Scope 1,stationary_combustion,natural_gas,2000,therms,2025-11-20',
  'Scope 2,purchased_electricity,CAMX,50000,kWh,2025-12-01',
].join('\n') + '\n';
// FY2026 with catalog 2026-09-30: Scope 1 5.31145 + 0.20223 = 5.51368 t; R-22 17.6 t beside the scopes;
// wood's biogenic CO2 10 x 1,640 kg = 16.4 t outside them; Scope 2 location-based 2 x 19.504 = 39.008 t,
// market-based 19.504 t (the renewable contract counts 0). FY2025: 10.6229 + 9.752 = 20.3749 t.
const AUDIT_FY2026 = {
  scope1: tonnes('stationary_combustion', 'natural_gas', 'therms', 1000) + tonnes('stationary_combustion', 'wood', 'short tons', 10),
  nonKyoto: tonnes('fugitive_emissions', 'refrigerant_r22', 'kg', 10),
  biogenic: (10 * 1640) / 1000,
  scope2: 2 * tonnes('purchased_electricity', 'CAMX', 'kWh', 100000),
  scope2Market: tonnes('purchased_electricity', 'CAMX', 'kWh', 100000),
};
const AUDIT_FY2025 = tonnes('stationary_combustion', 'natural_gas', 'therms', 2000) + tonnes('purchased_electricity', 'CAMX', 'kWh', 50000);

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
const company = {} as Record<UserKey, string>;

type Json = Record<string, unknown>;
/** The response fields these tests read; the rest is checked with toMatchObject. */
interface Body extends Json {
  data: Json & Json[];
  error: string;
  code: string;
  errors: string[];
  warnings: string[];
  conversions: string[];
  tonnes: { scope1: number; scope2: number; scope3: number; total: number; scope2_market: number; biogenic_co2: number; non_kyoto: number };
  import_id: string;
  imported: number;
  replayed: boolean;
  report: Json & { id: string; pdf_sha256: string };
  csvImports: Json[];
  emissionEntries: Json[];
}

function api(user: UserKey, method: string, path: string, body?: string | Json, headers: Record<string, string> = {}): Promise<Response> {
  const text = typeof body === 'string';
  return fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tokenOf(user)}`,
      ...(body === undefined ? {} : { 'content-type': text ? 'text/csv' : 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : text ? body : JSON.stringify(body),
  });
}

async function json(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

async function must(res: Response, status: number, step: string): Promise<Body> {
  const text = await res.text();
  if (res.status !== status) throw new Error(`${step}: expected ${status}, got ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as Body;
}

async function summary(user: UserKey, year: string): Promise<Json> {
  return (await must(await api(user, 'GET', `/api/emissions/summary?period=${year}`), 200, `summary ${year}`)).data;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(CONTAINER, `SELECT count(*)::int::text FROM ${sql}`));
}

/**
 * One statement as the browser's database role for `user`, the way the records
 * API runs it (role authenticated, the user's id as the JWT subject auth.uid() reads).
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

const csv = (...rows: string[]) => ['scope,category,source,amount,unit,date', ...rows].join('\n') + '\n';

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${Object.values(USERS).map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    const trial = (user: UserKey) => `('${USERS[user].id}', 'K4 ${user} Co', 'other', now() + interval '14 days', NULL, NULL, NULL)`;
    const growth = (user: UserKey) => `('${USERS[user].id}', 'K4 ${user} Co', 'other', now() - interval '1 day', 'active', 'growth', now() + interval '30 days')`;
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at, subscription_status, subscription_plan, subscription_current_period_end) VALUES
         ${[trial('audit'), trial('partial'), growth('units'), growth('race'), trial('legacy'), trial('quota'), trial('signed'), trial('b'), trial('preview')].join(',\n         ')}`
    );
    for (const line of (await psql(CONTAINER, 'SELECT user_id::text || \'=\' || id::text FROM public.companies')).split('\n')) {
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

describe('F-E-04 = F-B-06: nothing is counted twice', () => {
  it('the audit\'s file imported twice: 409 "already imported on <date> (7 rows)", and FY2026 is unchanged', async () => {
    const dry = await must(await api('audit', 'POST', '/api/ingest/csv?dry_run=1&filename=stack.csv', AUDIT_FILE), 200, 'dry run');
    expect(dry).toMatchObject({ valid_rows: 7, error_count: 0, can_commit: true, duplicate_of: null });
    // The preview adds up as the Dashboard does: R-22 beside the scopes, the renewable contract location-based.
    expect(dry.tonnes.non_kyoto).toBeCloseTo(AUDIT_FY2026.nonKyoto, 6);
    expect(dry.tonnes.total).toBeCloseTo(AUDIT_FY2026.scope1 + AUDIT_FY2026.scope2 + AUDIT_FY2025, 5);
    expect(await count(`public.emission_entries WHERE company_id = ${company.audit}`)).toBe(0);

    const first = await must(await api('audit', 'POST', '/api/ingest/csv?filename=stack.csv', AUDIT_FILE), 200, 'first import');
    expect(first.imported).toBe(7);
    const fy2026 = await summary('audit', '2026');
    expect(fy2026).toMatchObject({
      scope1_co2e_tonnes: expect.closeTo(AUDIT_FY2026.scope1, 5),
      scope2_co2e_tonnes: expect.closeTo(AUDIT_FY2026.scope2, 5),
      scope2_market_co2e_tonnes: expect.closeTo(AUDIT_FY2026.scope2Market, 5),
      non_kyoto_co2e_tonnes: expect.closeTo(AUDIT_FY2026.nonKyoto, 5),
      biogenic_co2_tonnes: expect.closeTo(AUDIT_FY2026.biogenic, 5),
    });
    const fy2025 = (await summary('audit', '2025')).total_co2e_tonnes;
    expect(fy2025).toBeCloseTo(AUDIT_FY2025, 5);

    const again = await api('audit', 'POST', '/api/ingest/csv?filename=stack-again.csv', AUDIT_FILE.replace(/\n/g, '\r\n'));
    expect(again.status).toBe(409);
    const refusal = await json(again);
    expect(refusal.code).toBe('duplicate_file');
    expect(refusal.error).toMatch(new RegExp(`^This file was already imported on ${new Date().toISOString().slice(0, 10)} \\(7 rows\\)\\. Nothing was imported\\.`));
    expect(await summary('audit', '2026')).toMatchObject({ scope1_co2e_tonnes: fy2026.scope1_co2e_tonnes, scope2_co2e_tonnes: fy2026.scope2_co2e_tonnes });
    expect((await summary('audit', '2025')).total_co2e_tonnes).toBe(fy2025);
    expect(await count(`public.csv_import_events WHERE company_id = ${company.audit}`)).toBe(1);
    expect(await count(`public.emission_entries WHERE company_id = ${company.audit}`)).toBe(7);
  }, 60_000);

  it('the check shows what the Dashboard will: the audit file plus a wood and an R-22 row, dry run = Dashboard after the import, scope by scope and memo by memo', async () => {
    // FY2025 gets memo lines of its own: 5 short tons of wood, 2 kg of R-22.
    const file = AUDIT_FILE + 'Scope 1,stationary_combustion,wood,5,short tons,2025-10-15\nScope 1,fugitive_emissions,refrigerant_r22,2,kg,2025-10-15\n';
    const dry = await must(await api('preview', 'POST', '/api/ingest/csv?dry_run=1', file), 200, 'dry run');
    expect(dry).toMatchObject({ valid_rows: 9, error_count: 0 });
    await must(await api('preview', 'POST', '/api/ingest/csv', file), 200, 'import');

    // The Dashboard shows one year at a time; the file covers FY2025 and FY2026.
    const years = [await summary('preview', '2025'), await summary('preview', '2026')];
    const dashboard = (field: string) => years.reduce((sum, year) => sum + Number(year[field]), 0);
    expect(dry.tonnes).toEqual({
      scope1: expect.closeTo(dashboard('scope1_co2e_tonnes'), 6),
      scope2: expect.closeTo(dashboard('scope2_co2e_tonnes'), 6),
      scope3: expect.closeTo(dashboard('scope3_co2e_tonnes'), 6),
      total: expect.closeTo(dashboard('total_co2e_tonnes'), 6),
      scope2_market: expect.closeTo(dashboard('scope2_market_co2e_tonnes'), 6),
      biogenic_co2: expect.closeTo(dashboard('biogenic_co2_tonnes'), 6),
      non_kyoto: expect.closeTo(dashboard('non_kyoto_co2e_tonnes'), 6),
    });

    // And both are what the catalog says (KG_PER): FY2026 as above, plus FY2025's 2,000 therms, 50,000 kWh
    // CAMX, 5 short tons of wood (CH4 and N2O 0.101115 t; biogenic CO2 5 x 1,640 kg = 8.2 t) and 2 kg of R-22.
    const camx2025 = tonnes('purchased_electricity', 'CAMX', 'kWh', 50000); // 9.752
    expect(dry.tonnes).toMatchObject({
      scope1: expect.closeTo(AUDIT_FY2026.scope1 + tonnes('stationary_combustion', 'natural_gas', 'therms', 2000) + tonnes('stationary_combustion', 'wood', 'short tons', 5), 6), // 16.237695
      scope2: expect.closeTo(AUDIT_FY2026.scope2 + camx2025, 6), // 48.76
      scope3: 0,
      scope2_market: expect.closeTo(AUDIT_FY2026.scope2Market + camx2025, 6), // 29.256
      biogenic_co2: expect.closeTo(AUDIT_FY2026.biogenic + (5 * 1640) / 1000, 6), // 24.6
      non_kyoto: expect.closeTo(AUDIT_FY2026.nonKyoto + tonnes('fugitive_emissions', 'refrigerant_r22', 'kg', 2), 6), // 21.12
    });
  }, 60_000);

  it('a file with a bad row stores nothing and spends nothing; the fixed file counts each row once (RFCE n = 1)', async () => {
    const bad = csv('Scope 1,stationary_combustion,natural_gas,500,thermz,2026-07-01', 'Scope 2,purchased_electricity,RFCE,10000,kWh,2026-08-01');
    const refused = await api('partial', 'POST', '/api/ingest/csv', bad);
    expect(refused.status).toBe(422);
    expect((await json(refused)).errors).toEqual([expect.stringMatching(/^Line 2: unit "thermz" cannot be used for stationary_combustion natural_gas\./)]);
    expect(await count(`public.emission_entries WHERE company_id = ${company.partial}`)).toBe(0);
    expect(await count(`public.csv_import_events WHERE company_id = ${company.partial}`)).toBe(0);

    await must(await api('partial', 'POST', '/api/ingest/csv', bad.replace('thermz', 'therm')), 200, 'fixed file');
    expect(await count(`public.emission_entries WHERE company_id = ${company.partial} AND source = 'RFCE'`)).toBe(1);
    expect(await count(`public.csv_import_events WHERE company_id = ${company.partial}`)).toBe(1);
    // 500 therms + 10,000 kWh RFCE: each once (2.655725 + 2.7179 = 5.373625 t).
    expect((await summary('partial', '2026')).total_co2e_tonnes)
      .toBeCloseTo(tonnes('stationary_combustion', 'natural_gas', 'therms', 500) + tonnes('purchased_electricity', 'RFCE', 'kWh', 10000), 5);
  }, 60_000);

  it('concurrent uploads: five tabs with the same file make one import (four 409s); five retries of one upload make one import (four replays)', async () => {
    const fileA = csv('Scope 1,stationary_combustion,natural_gas,42,therms,2025-10-01', 'Scope 2,purchased_electricity,CAMX,4200,kWh,2025-10-01');
    const tabs = await Promise.all(Array.from({ length: 5 }, (_, i) => api('race', 'POST', '/api/ingest/csv', fileA, { 'idempotency-key': `k4-race-tab-000${i}` })));
    expect(tabs.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409]);

    const fileB = csv('Scope 1,stationary_combustion,natural_gas,43,therms,2025-10-02');
    const retries = await Promise.all(Array.from({ length: 5 }, () => api('race', 'POST', '/api/ingest/csv', fileB, { 'idempotency-key': 'k4-race-retry-0001' })));
    const bodies = await Promise.all(retries.map(json));
    expect(retries.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(bodies.filter((body) => body.replayed === false)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.import_id)).size).toBe(1);

    expect(await count(`public.csv_import_events WHERE company_id = ${company.race}`)).toBe(2);
    expect(await count(`public.emission_entries WHERE company_id = ${company.race}`)).toBe(3);
  }, 60_000);
});

describe('F-E-13 / F-E-18: what a row stores', () => {
  it('therm, "1,200", ccf, lb, tons and km: stored in the catalog unit with what the file said, pinned, linked to the import, created_at = insert time', async () => {
    const file = csv(
      'Scope 1,stationary_combustion,natural_gas,"1,200",therm,2025-01-31',
      'Scope 1,stationary_combustion,natural_gas,1000,ccf,2025-02-28',
      'Scope 1,fugitive_emissions,refrigerant_r410a,10,lb,2025-03-31',
      // Priced per kg only, so "tons" is converted (landfill is priced per short ton since catalog 2026-09-30).
      'Scope 3,purchased_goods,paper,2,tons,2025-04-30',
      'Scope 3,business_travel,rental_car,100,km,2025-05-31',
    );
    const dry = await must(await api('units', 'POST', '/api/ingest/csv?dry_run=1', file), 200, 'dry run');
    expect(dry.conversions).toHaveLength(4);
    expect(dry.warnings).toContain('Line 5: "tons" is read as US short tons (2,000 lb); write "tonnes" for metric tons.');
    const committed = await must(await api('units', 'POST', '/api/ingest/csv', file), 200, 'commit');

    // The flags: linked to this import; imported_at is the import's created_at and
    // the row's own (the insert time, recent); this catalog version pinned; never edited.
    const stored = JSON.parse(await psql(
      CONTAINER,
      `SELECT json_agg(json_build_object(
                'unit', e.unit, 'amount', e.amount, 'activity_unit', e.activity_unit, 'activity_amount', e.activity_amount,
                'factor_value', e.factor_value, 'co2e_kg', e.co2e_kg, 'factor_source', e.factor_source, 'activity_date', e.activity_date,
                'linked', e.import_id = ${Number(committed.import_id)},
                'imported_at_is_insert_time', e.imported_at = i.created_at AND e.imported_at = e.created_at,
                'recent', e.created_at > now() - interval '5 minutes',
                'pinned', e.catalog_version = '${CATALOG_VERSION}', 'never_updated', e.updated_at IS NULL) ORDER BY e.id)
         FROM public.emission_entries e LEFT JOIN public.csv_import_events i ON i.id = e.import_id
        WHERE e.company_id = ${company.units}`
    ));
    // Each source's `factorSource` in the catalog.
    const DATASET: Record<string, string> = { natural_gas: 'epa-efh-2025', refrigerant_r410a: 'ipcc-ar5-gwp100', paper: 'internal-estimate', rental_car: 'epa-efh-2025' };
    const row = (category: string, source: string, unit: string, amount: number, activityUnit: string, activityAmount: number, date: string) => ({
      unit, amount: expect.closeTo(amount, 9), activity_unit: activityUnit, activity_amount: activityAmount,
      factor_value: kgPer(category, source, unit), co2e_kg: expect.closeTo(amount * kgPer(category, source, unit), 2),
      factor_source: DATASET[source], activity_date: date,
      linked: true, imported_at_is_insert_time: true, recent: true, pinned: true, never_updated: true,
    });
    // 10 lb x 0.45359237 = 4.5359237 kg; 2 short tons x 2,000 lb x 0.45359237 = 1,814.36948 kg;
    // 100 km / 1.609344 = 62.1371192237 miles (12 significant digits).
    expect(stored).toEqual([
      row('stationary_combustion', 'natural_gas', 'therms', 1200, 'therms', 1200, '2025-01-31'),
      row('stationary_combustion', 'natural_gas', 'MCF', 100, 'ccf', 1000, '2025-02-28'),
      row('fugitive_emissions', 'refrigerant_r410a', 'kg', 4.5359237, 'lb', 10, '2025-03-31'),
      row('purchased_goods', 'paper', 'kg', 1814.36948, 'tons', 2, '2025-04-30'),
      row('business_travel', 'rental_car', 'miles', 62.1371192237, 'km', 100, '2025-05-31'),
    ]);
    // 6.37374 + 5.44953 + 8.727117 + 1.705507 + 0.018552 = 22.274446 t
    expect((await summary('units', '2025')).total_co2e_tonnes).toBeCloseTo(
      tonnes('stationary_combustion', 'natural_gas', 'therms', 1200) + tonnes('stationary_combustion', 'natural_gas', 'MCF', 100) +
        tonnes('fugitive_emissions', 'refrigerant_r410a', 'kg', 4.5359237) + tonnes('purchased_goods', 'paper', 'kg', 1814.36948) +
        tonnes('business_travel', 'rental_car', 'miles', 62.1371192237),
      4,
    );
  }, 60_000);

  it('every header problem at once; hex, scientific and blank amounts are each refused on their line; nothing stored', async () => {
    const header = await must(await api('units', 'POST', '/api/ingest/csv?dry_run=1', 'scope,unit,date\nScope 1,therms,2025-01-01\n'), 200, 'bad header');
    expect(header.errors[0]).toMatch(/^missing required columns: category, source, amount /);
    const before = await count(`public.emission_entries WHERE company_id = ${company.units}`);
    const res = await api('units', 'POST', '/api/ingest/csv', csv(
      'Scope 1,stationary_combustion,natural_gas,0x1F,therms,2025-01-01',
      'Scope 1,stationary_combustion,natural_gas,1e999,therms,2025-01-01',
      'Scope 1,stationary_combustion,natural_gas,,therms,2025-01-01',
    ));
    expect(res.status).toBe(422);
    expect((await json(res)).errors.map((error: string) => error.slice(0, 20))).toEqual(['Line 2: amount "0x1F', 'Line 3: amount "1e99', 'Line 4: amount is bl']);
    expect(await count(`public.emission_entries WHERE company_id = ${company.units}`)).toBe(before);
  }, 60_000);

  it('an edit through the entry API sets updated_at and keeps created_at and the import link', async () => {
    const id = await psql(CONTAINER, `SELECT min(id)::text FROM public.emission_entries WHERE company_id = ${company.units}`);
    const before = await psql(CONTAINER, `SELECT created_at::text || '|' || import_id FROM public.emission_entries WHERE id = ${id}`);
    await must(await api('units', 'PATCH', `/api/entries/${id}`, { notes: 'meter swap' }), 200, 'PATCH notes');
    expect(await psql(CONTAINER, `SELECT created_at::text || '|' || import_id || '|' || (updated_at IS NOT NULL)::int FROM public.emission_entries WHERE id = ${id}`))
      .toBe(`${before}|1`);
  }, 60_000);
});

describe('F-R2-01: the period is the activity date, and history does not move', () => {
  it('legacy rows keep their FY totals; a new dated row lands in its year; an undated one in the import year, warned before commit', async () => {
    const id = company.legacy;
    // As the importer and the calculator stored rows before K4: a dated CSV row
    // carried its date in created_at too; undated rows kept the insert time. No
    // pinned factor: they are priced from the 2026-07-24 catalog, the one they
    // were stored under (emission-factors.v1.json, frozen: no catalog_version).
    await psql(CONTAINER, `INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, factor, method, confidence, co2e_kg, activity_date, created_at) VALUES
      (${id}, 'Scope 1', 'stationary_combustion', 'natural_gas', 1000, 'therms', '0.005306', 'calculation', 90, 5306, '2025-06-30', '2025-06-30T00:00:00Z'),
      (${id}, 'Scope 2', 'purchased_electricity', 'CAMX', 100000, 'kWh', '0.00019504', 'calculation', 97, 19504, '2026-01-01', '2026-01-01T00:00:00Z'),
      (${id}, 'Scope 1', 'mobile_combustion', 'diesel', 100, 'gallons', '0.01021', 'calculation', 88, 1021, NULL, '2025-12-31T23:30:00Z'),
      (${id}, 'Scope 1', 'stationary_combustion', 'natural_gas', 6367.2, 'kg CO2e', '1200 therms', 'EPA emission factor', 85, 6367.2, NULL, '2025-03-01T10:00:00Z')`);
    const legacy2025 = 5.306 + 1.021 + 6.3672;
    expect((await summary('legacy', '2025')).total_co2e_tonnes).toBeCloseTo(legacy2025, 6);
    expect((await summary('legacy', '2026')).total_co2e_tonnes).toBeCloseTo(19.504, 6);

    const file = csv('Scope 1,stationary_combustion,natural_gas,100,therms,2025-03-15', 'Scope 2,purchased_electricity,CAMX,1000,kWh,');
    const dry = await must(await api('legacy', 'POST', '/api/ingest/csv?dry_run=1', file), 200, 'dry run');
    expect(dry.warnings).toContain(`1 row (line 3) has no date: counted in ${THIS_YEAR}, the year of the import. Add a date (for a bill, the end of its period) to count a row in the year the activity happened.`);
    await must(await api('legacy', 'POST', '/api/ingest/csv', file), 200, 'commit');

    const dated = tonnes('stationary_combustion', 'natural_gas', 'therms', 100);
    const undated = tonnes('purchased_electricity', 'CAMX', 'kWh', 1000);
    expect((await summary('legacy', '2025')).total_co2e_tonnes).toBeCloseTo(legacy2025 + dated, 5);
    expect((await summary('legacy', THIS_YEAR)).total_co2e_tonnes).toBeCloseTo((THIS_YEAR === '2026' ? 19.504 : 0) + undated, 5);
    const trend = (await must(await api('legacy', 'GET', '/api/emissions/trend?year=2025'), 200, 'trend')).data;
    expect(trend.reduce((sum, month) => sum + Number(month.scope1) + Number(month.scope2) + Number(month.scope3), 0)).toBeCloseTo(legacy2025 + dated, 5);
    expect(await psql(CONTAINER, `SELECT activity_date::text || '|' || (created_at > now() - interval '5 minutes')::int FROM public.emission_entries WHERE company_id = ${id} AND amount = 100 AND unit = 'therms'`))
      .toBe('2025-03-15|1');
  }, 60_000);
});

describe('quota: only a commit spends an import; undo refunds nothing', () => {
  it('dry runs, a refused file and a 409 leave the count; commits add one each; at the limit both steps are 402', async () => {
    const id = company.quota;
    await psql(CONTAINER, `INSERT INTO public.csv_import_events (company_id, row_count) SELECT ${id}, 1 FROM generate_series(1, 8)`);
    const events = () => count(`public.csv_import_events WHERE company_id = ${id}`);
    const fileA = csv('Scope 1,stationary_combustion,natural_gas,7,therms,2025-01-01');

    for (let i = 0; i < 3; i++) await must(await api('quota', 'POST', '/api/ingest/csv?dry_run=1', fileA), 200, 'dry run');
    expect(await events()).toBe(8);
    const first = await must(await api('quota', 'POST', '/api/ingest/csv', fileA), 200, 'commit A');
    expect(await events()).toBe(9);
    expect((await api('quota', 'POST', '/api/ingest/csv', fileA)).status).toBe(409);
    expect((await api('quota', 'POST', '/api/ingest/csv', csv('Scope 1,stationary_combustion,natural_gas,x,therms,2025-01-01'))).status).toBe(422);
    await must(await api('quota', 'POST', `/api/ingest/imports/${first.import_id}/undo`, {}), 200, 'undo A');
    expect(await events()).toBe(9);
    await must(await api('quota', 'POST', '/api/ingest/csv', csv('Scope 1,stationary_combustion,natural_gas,8,therms,2025-01-01')), 200, 'commit B');
    expect(await events()).toBe(10);

    const fileC = csv('Scope 1,stationary_combustion,natural_gas,9,therms,2025-01-01');
    for (const path of ['/api/ingest/csv', '/api/ingest/csv?dry_run=1']) {
      const res = await api('quota', 'POST', path, fileC);
      expect({ path, status: res.status, body: await json(res) }).toMatchObject({ path, status: 402, body: { code: 'upgrade_required', requiredPlan: 'growth' } });
    }
    expect(await psql(CONTAINER, `SELECT string_agg(COALESCE(status, 'legacy'), ',' ORDER BY id) FROM public.csv_import_events WHERE company_id = ${id}`))
      .toBe('legacy,legacy,legacy,legacy,legacy,legacy,legacy,legacy,undone,committed');
  }, 60_000);
});

describe('history and undo', () => {
  it('another tenant can neither list nor undo an import (403 naming the company, 404 by id), and nothing of it changes', async () => {
    const listA = await must(await api('audit', 'GET', '/api/ingest/imports'), 200, 'A lists');
    const importA = listA.data[0];
    expect(importA).toMatchObject({ original_filename: 'stack.csv', row_count: 7, status: 'committed', rows_present: 7, signed_off_reports: [] });

    expect((await must(await api('b', 'GET', '/api/ingest/imports'), 200, 'B lists')).data).toEqual([]);
    expect((await api('b', 'GET', `/api/ingest/imports?company_id=${company.audit}`)).status).toBe(403);
    expect((await api('b', 'POST', `/api/ingest/imports/${importA.id}/undo`, { confirm_signed_off: true })).status).toBe(404);
    expect((await api('b', 'POST', '/api/ingest/imports/not-a-number/undo', {})).status).toBe(404);
    expect(await count(`public.emission_entries WHERE import_id = ${Number(importA.id)}`)).toBe(7);
    expect(await psql(CONTAINER, `SELECT status FROM public.csv_import_events WHERE id = ${Number(importA.id)}`)).toBe('committed');
  }, 60_000);

  it('an import inside a signed-off report\'s period: the undo is refused until confirmed; the report keeps its bytes', async () => {
    const committed = await must(await api('signed', 'POST', '/api/ingest/csv?filename=fy2025.csv', csv(
      'Scope 1,stationary_combustion,natural_gas,1000,therms,2025-06-30', 'Scope 2,purchased_electricity,CAMX,10000,kWh,2025-09-30',
    )), 200, 'import FY2025');
    const outside = await must(await api('signed', 'POST', '/api/ingest/csv', csv('Scope 1,stationary_combustion,natural_gas,10,therms,2026-06-30')), 200, 'import FY2026');
    const report = (await must(await api('signed', 'POST', `/api/companies/${company.signed}/reports/generate`, { period: '2025' }), 200, 'generate')).report;
    await must(await api('signed', 'POST', `/api/reports/${report.id}/signoff`, { pdf_sha256: report.pdf_sha256 }), 200, 'sign off');
    const pdf = Buffer.from(await (await api('signed', 'GET', `/api/reports/${report.id}/download`)).arrayBuffer());

    const listed = (await must(await api('signed', 'GET', '/api/ingest/imports'), 200, 'list')).data;
    expect(listed.find((item) => item.id === committed.import_id)?.signed_off_reports).toEqual([
      { id: String(report.id), title: expect.any(String), period: '2025', period_start: '2025-01-01', period_end: '2025-12-31' },
    ]);
    expect(listed.find((item) => item.id === outside.import_id)?.signed_off_reports).toEqual([]);

    const refused = await api('signed', 'POST', `/api/ingest/imports/${committed.import_id}/undo`, {});
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({
      code: 'signed_off_report',
      error: 'This import falls in a period with a signed-off report. Undoing it will not change that report; generate a new report afterwards.',
      reports: [{ id: String(report.id) }],
    });
    expect(await count(`public.emission_entries WHERE import_id = ${Number(committed.import_id)}`)).toBe(2);

    const undone = await must(await api('signed', 'POST', `/api/ingest/imports/${committed.import_id}/undo`, { confirm_signed_off: true }), 200, 'confirmed undo');
    expect(undone).toMatchObject({ removed_rows: 2, import: { status: 'undone' } });
    expect((await summary('signed', '2025')).total_co2e_tonnes).toBe(0);
    const again = Buffer.from(await (await api('signed', 'GET', `/api/reports/${report.id}/download`)).arrayBuffer());
    expect(createHash('sha256').update(again).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));

    // Outside every signed-off period: no confirmation needed.
    await must(await api('signed', 'POST', `/api/ingest/imports/${outside.import_id}/undo`, {}), 200, 'undo FY2026');
  }, 90_000);

  // Moved from the spawned no-database test, which ran it on sample data (F-G-07).
  it('an undo shows on the dashboard at once, not after the 5-minute cache', async () => {
    const importP = (await must(await api('partial', 'GET', '/api/ingest/imports'), 200, 'list')).data[0];
    expect(Number((await summary('partial', '2026')).total_co2e_tonnes)).toBeGreaterThan(0); // primes the cache
    await must(await api('partial', 'POST', `/api/ingest/imports/${importP.id}/undo`, {}), 200, 'undo');
    expect((await summary('partial', '2026')).total_co2e_tonnes).toBe(0);
  }, 60_000);

  it('the account export links each imported row to its import', async () => {
    const res = await must(await api('units', 'GET', '/api/account/export'), 200, 'export');
    const imports = res.csvImports;
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ status: 'committed', row_count: 5, warning_count: 1 });
    expect(res.emissionEntries.map((entry) => String(entry.import_id))).toEqual(Array(5).fill(String(imports[0]?.id)));
  }, 60_000);
});

describe('import_id is the server\'s to set (browser roles, until the deferred REVOKE)', () => {
  it('as authenticated, an insert or an update can neither link nor unlink a row; the server role can', async () => {
    // InsForge's default grants on the tables it manages (docs/runbooks/k2-rollout.md, step 0).
    await psql(CONTAINER, `GRANT SELECT, INSERT, UPDATE ON public.emission_entries TO authenticated;
      GRANT SELECT ON public.companies TO authenticated; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated`);
    const importId = await psql(CONTAINER, `SELECT min(import_id)::text FROM public.emission_entries WHERE company_id = ${company.units}`);
    const linked = await psql(CONTAINER, `SELECT min(id)::text FROM public.emission_entries WHERE import_id = ${importId}`);
    const state = (id: string) =>
      psql(CONTAINER, `SELECT coalesce(import_id::text, 'null') || '|' || coalesce(notes, '') || '|' || coalesce(updated_at::text, 'null') FROM public.emission_entries WHERE id = ${id}`);

    // An insert that names an import (and an edit time) is stored unlinked and unedited.
    const added = await asBrowser('units', `WITH ins AS (INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, import_id, updated_at, notes)
      VALUES (${company.units}, 'Scope 1', 'stationary_combustion', 'natural_gas', 1, 'therms', ${importId}, '2000-01-01', 'browser row') RETURNING id) SELECT id::text FROM ins`);
    expect(await state(added)).toBe('null|browser row|null');

    // Updates go through (the notes change) but the link does not move, either way.
    await asBrowser('units', `UPDATE public.emission_entries SET import_id = NULL, notes = 'browser unlink' WHERE id = ${linked}`);
    await asBrowser('units', `UPDATE public.emission_entries SET import_id = ${importId}, notes = 'browser link' WHERE id = ${added}`);
    expect((await state(linked)).split('|').slice(0, 2)).toEqual([importId, 'browser unlink']);
    expect((await state(added)).split('|').slice(0, 2)).toEqual(['null', 'browser link']);

    // The server's own role (this connection's) sets it.
    await psql(CONTAINER, `UPDATE public.emission_entries SET import_id = ${importId} WHERE id = ${added}`);
    expect((await state(added)).split('|')[0]).toBe(importId);
    await psql(CONTAINER, `DELETE FROM public.emission_entries WHERE id = ${added}`);
  }, 60_000);
});
