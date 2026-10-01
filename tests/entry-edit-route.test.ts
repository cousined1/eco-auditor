/**
 * K5 (F-B-17, and the company half of F-E-08) through the real Express routes, a
 * real Postgres (every repo migration applied, including 20260930121000) and
 * real bearer-token auth. Docker: one throwaway container (tests/e2e-helpers.ts);
 * run by explicit path.
 *
 *   F-B-17  an entry can be edited: the server recomputes (1200 -> 1300 therms is
 *           6373.74 -> 6904.885 kg on catalog 2026-09-30, see the derivation
 *           below), the list, the dashboard and the next report reflect it,
 *           updated_at is set, and the values before the edit are kept in the
 *           append-only entry_history (who, when, old and new)
 *   F-E-08  a report made after the company sets its consolidation approach and
 *           base year prints them; a report made before stays "not specified"
 *   K7 rule a row stored before the entry API (no catalog_version) is edited by
 *           the catalog it was priced with: an edit that keeps its activity keeps
 *           its figure on the frozen 2026-07-24 catalog, an edit that changes the
 *           activity is priced by the current catalog
 *
 * Reports are frozen snapshots (K3): an edit, even after sign-off, never changes
 * a report that already exists, so a signed-off report does not lock its entries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import http from 'node:http';
import currentCatalog from '../emission-factors.json';
import frozenCatalog from '../emission-factors.v1.json';
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

const CONTAINER = uniqueContainerName('fix-tests-pg-entry-edit');

const USERS = {
  a: { id: 'a1000000-0000-4000-8000-00000000000a', email: 'k5-edit-a@example.com' },
  b: { id: 'b1000000-0000-4000-8000-00000000000b', email: 'k5-edit-b@example.com' },
  // Owns the rows seeded by SQL in the pre-entry-API shape (the K7 rule), apart from a's history counts.
  c: { id: 'c1000000-0000-4000-8000-00000000000c', email: 'k5-edit-c@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `k5-edit-token-${user}`;

const GAS = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1200, unit: 'therms', activity_date: '2025-03-15' };

/*
 * Every figure below is derived here from the catalogs' own inputs, never read back from the
 * server, and the first describe checks the derivation against the catalog files themselves.
 *
 * Catalog 2026-09-30 (emission-factors.json), natural gas, epa-efh-2025, gases at IPCC AR5 GWP-100
 * (CH4 28, N2O 265):
 *   per mmBtu   53.06 kg CO2 + 1.0 g CH4 x 28 + 0.10 g N2O x 265
 *               = 53.06 + 0.028 + 0.0265 = 53.1145 kg CO2e
 *   per therm   1 therm = 0.1 mmBtu, so 53.1145 / 10 = 5.31145 kg CO2e
 *   1200 therms x 5.31145 = 6373.74 kg     1300 x 5.31145 = 6904.885 kg     1400 x 5.31145 = 7436.03 kg
 *
 * Frozen catalog 2026-07-24 (emission-factors.v1.json), which prices a row stored without a
 * catalog_version: 53.06 kg CO2 per mmBtu and no CH4 or N2O, so 53.06 / 10 = 5.306 kg per therm
 *   1200 therms x 5.306 = 6367.2 kg
 * (The F-B-17 acceptance figure 1300 therms = 6897.8 kg is 1300 x 5.306: the frozen catalog's.)
 */
const KG = { 1200: 6373.74, 1300: 6904.885, 1400: 7436.03 } as const;
const FROZEN_KG_1200 = 6367.2;

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
const company = {} as Record<UserKey, string>;
let entryId = '';
let firstReport = '';
let secondReport = '';
let thirdReport = '';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function api(user: UserKey, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokenOf(user)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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

async function generate(user: UserKey): Promise<string> {
  const res = await api(user, 'POST', `/api/companies/${company[user]}/reports/generate`, { period: '2025' });
  expect(res.status).toBe(200);
  return String((await json(res)).report_id);
}

/** The stored PDF's bytes: its text is uncompressed, one `(line) Tj` per line. */
async function download(user: UserKey, reportId: string): Promise<{ bytes: Buffer; text: string }> {
  const res = await api(user, 'GET', `/api/reports/${reportId}/download`);
  expect(res.status).toBe(200);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, text: bytes.toString('latin1') };
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const snapshotTotal = async (reportId: string) => Number(await psql(CONTAINER, `SELECT snapshot->>'total_emissions_tCO2e' FROM public.reports WHERE id = ${reportId}`));

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${Object.values(USERS).map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at) VALUES
         ('${USERS.a.id}', 'K5 Edit A Co', 'Manufacturing', now() + interval '14 days'),
         ('${USERS.b.id}', 'K5 Edit B Co', 'Manufacturing', now() + interval '14 days'),
         ('${USERS.c.id}', 'K5 Edit C Co', 'Manufacturing', now() + interval '14 days')`
    );
    for (const line of (await psql(CONTAINER, 'SELECT user_id::text || \'=\' || id::text FROM public.companies')).split('\n')) {
      const [userId, id] = line.split('=');
      const key = (Object.keys(USERS) as UserKey[]).find((k) => USERS[k].id === userId);
      if (key && id) company[key] = id;
    }

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

describe('the figures this file expects are the catalogs\' own arithmetic', () => {
  type Catalog = { version: string; gwpBasis?: string; categories: Array<{ key: string; sources: Array<{ key: string; units: Record<string, number>; citation?: string }> }> };
  const naturalGas = (catalog: unknown) => {
    const source = (catalog as Catalog).categories.find((c) => c.key === 'stationary_combustion')?.sources.find((s) => s.key === 'natural_gas');
    if (!source) throw new Error('natural_gas is not in the catalog');
    return source;
  };

  it('2026-09-30: 53.06 kg CO2 + 1.0 g CH4 x 28 + 0.10 g N2O x 265 = 53.1145 kg per mmBtu, a tenth of it per therm', () => {
    expect((currentCatalog as Catalog).version).toBe('2026-09-30');
    expect((currentCatalog as Catalog).gwpBasis).toBe('ipcc-ar5-gwp100');
    expect(naturalGas(currentCatalog).citation).toContain('53.06 kg CO2, 1.0 g CH4, 0.10 g N2O per mmBtu');
    const perMmbtu = 53.06 + (1.0 * 28) / 1000 + (0.10 * 265) / 1000;
    expect(perMmbtu).toBeCloseTo(53.1145, 10);
    expect(naturalGas(currentCatalog).units.MMBtu).toBeCloseTo(perMmbtu, 10);
    expect(naturalGas(currentCatalog).units.therms).toBeCloseTo(perMmbtu / 10, 10);
    for (const [therms, kg] of Object.entries(KG)) expect(Number(therms) * (perMmbtu / 10)).toBeCloseTo(kg, 6);
  });

  it('2026-07-24 (frozen): 53.06 kg CO2 per mmBtu and no CH4 or N2O, so 5.306 kg per therm', () => {
    expect((frozenCatalog as Catalog).version).toBe('2026-07-24');
    expect(naturalGas(frozenCatalog).units.MMBtu).toBe(53.06);
    expect(naturalGas(frozenCatalog).units.therms).toBe(5.306);
    expect(1200 * (53.06 / 10)).toBeCloseTo(FROZEN_KG_1200, 6);
  });
});

describe('F-B-17 — editing an entry', () => {
  it('a new entry of 1200 therms is 6373.74 kg; a report made now freezes that', async () => {
    const res = await api('a', 'POST', '/api/entries', GAS);
    expect(res.status).toBe(201);
    const body = await json(res);
    entryId = String(body.data.id);
    expect(body.data).toMatchObject({ activity_amount: 1200, co2e_kg: KG[1200], factor_value: 5.31145, pricing_catalog: '2026-09-30', updated_at: null });
    firstReport = await generate('a');
    expect(await snapshotTotal(firstReport)).toBeCloseTo(KG[1200] / 1000, 5);
  }, 60_000);

  it('1200 -> 1300 therms: the server recomputes (1300 x 5.31145 = 6904.885 kg), sets updated_at, and the list and the dashboard show it at once', async () => {
    const before = await summaryTonnes('a', '2025'); // primes the 5-minute cache
    expect(before).toBeCloseTo(KG[1200] / 1000, 5);
    const res = await api('a', 'PATCH', `/api/entries/${entryId}`, { amount: 1300 });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toMatchObject({ id: Number(entryId), activity_amount: 1300, activity_unit: 'therms', co2e_kg: KG[1300], activity_date: '2025-03-15', scope: 'Scope 1' });
    expect(typeof body.data.updated_at).toBe('string');
    expect(Date.now() - Date.parse(body.data.updated_at)).toBeLessThan(60_000);

    expect(await summaryTonnes('a', '2025')).toBeCloseTo(KG[1300] / 1000, 5);
    const listed = (await json(await api('a', 'GET', '/api/entries'))).data as Array<Body>;
    expect(listed.find((entry) => String(entry.id) === entryId)).toMatchObject({ co2e_kg: KG[1300], updated_at: body.data.updated_at });
    expect(await psql(CONTAINER, `SELECT concat_ws('|', co2e_kg, amount, activity_amount, (updated_at IS NOT NULL)::text) FROM public.emission_entries WHERE id = ${entryId}`))
      .toBe(`${KG[1300]}|1300|1300|true`);
  }, 60_000);

  it('the values before the edit are kept: who, when, old and new, in entry_history', async () => {
    expect(await count(`public.entry_history WHERE entry_id = ${entryId}`)).toBe(1);
    const row = JSON.parse(await psql(CONTAINER, `SELECT row_to_json(h)::text FROM public.entry_history h WHERE entry_id = ${entryId}`));
    expect(row).toMatchObject({
      entry_id: Number(entryId),
      company_id: Number(company.a),
      changed_by: USERS.a.id,
      old_values: { activity_amount: 1200, activity_unit: 'therms', co2e_kg: KG[1200], scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', activity_date: '2025-03-15', facility_id: null, factor_value: 5.31145 },
      new_values: { activity_amount: 1300, activity_unit: 'therms', co2e_kg: KG[1300], activity_date: '2025-03-15', factor_value: 5.31145 },
    });
    expect(Date.now() - Date.parse(row.changed_at)).toBeLessThan(120_000);
  });

  it('saving what is already stored is not an edit: no history row, updated_at unchanged', async () => {
    const stamp = await psql(CONTAINER, `SELECT updated_at::text FROM public.emission_entries WHERE id = ${entryId}`);
    const res = await api('a', 'PATCH', `/api/entries/${entryId}`, { amount: 1300, activity_date: '2025-03-15' });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ co2e_kg: KG[1300] });
    expect(await count(`public.entry_history WHERE entry_id = ${entryId}`)).toBe(1);
    expect(await psql(CONTAINER, `SELECT updated_at::text FROM public.emission_entries WHERE id = ${entryId}`)).toBe(stamp);
  });

  it('a second edit adds a second row and leaves the first as it was; a date edit keeps the pinned factor', async () => {
    const firstRow = await psql(CONTAINER, `SELECT row_to_json(h)::text FROM public.entry_history h WHERE entry_id = ${entryId} ORDER BY id LIMIT 1`);
    const res = await api('a', 'PATCH', `/api/entries/${entryId}`, { activity_date: '2025-04-01', facility_id: null });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ co2e_kg: KG[1300], factor_value: 5.31145, activity_date: '2025-04-01' });
    expect(await count(`public.entry_history WHERE entry_id = ${entryId}`)).toBe(2);
    expect(await psql(CONTAINER, `SELECT row_to_json(h)::text FROM public.entry_history h WHERE entry_id = ${entryId} ORDER BY id LIMIT 1`)).toBe(firstRow);
    const latest = JSON.parse(await psql(CONTAINER, `SELECT row_to_json(h)::text FROM public.entry_history h WHERE entry_id = ${entryId} ORDER BY id DESC LIMIT 1`));
    expect(latest.old_values.activity_date).toBe('2025-03-15');
    expect(latest.new_values.activity_date).toBe('2025-04-01');
  });

  it('entry_history is append-only for every writer: an UPDATE is refused', async () => {
    const res = await runCapture(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', `UPDATE public.entry_history SET changed_by = 'someone-else' WHERE entry_id = ${entryId}`],
      { timeoutMs: 30_000 },
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/entry_history is append-only/);
    expect(await count(`public.entry_history WHERE entry_id = ${entryId} AND changed_by = '${USERS.a.id}'`)).toBe(2);
  });

  it('another tenant cannot edit the entry (404) and leaves no history', async () => {
    const res = await api('b', 'PATCH', `/api/entries/${entryId}`, { amount: 1 });
    expect(res.status).toBe(404);
    expect(await psql(CONTAINER, `SELECT amount::text FROM public.emission_entries WHERE id = ${entryId}`)).toBe('1300');
    expect(await count(`public.entry_history WHERE entry_id = ${entryId}`)).toBe(2);
  });

  it('bad edits are refused without touching the entry or its history', async () => {
    for (const body of [{ amount: 0 }, { amount: -5 }, { amount: '1300' }, { unit: 'bushels' }, { activity_date: '2999-01-01' }, { category: 'nonsense' }, { co2e_kg: 1 }]) {
      const res = await api('a', 'PATCH', `/api/entries/${entryId}`, body);
      const after = { body, status: res.status };
      // co2e_kg is not an editable field: the edit is a no-op, never a number the client chose.
      expect(after).toEqual({ body, status: 'co2e_kg' in body ? 200 : 400 });
    }
    expect(await psql(CONTAINER, `SELECT co2e_kg::text FROM public.emission_entries WHERE id = ${entryId}`)).toBe(String(KG[1300]));
    expect(await count(`public.entry_history WHERE entry_id = ${entryId}`)).toBe(2);
  });
});

describe('the next report reflects the edit; the earlier one does not change', () => {
  it('a report made after the edit has the new total; the first report is frozen at the old one', async () => {
    const firstBytes = (await download('a', firstReport)).bytes;
    secondReport = await generate('a');
    expect(await snapshotTotal(secondReport)).toBeCloseTo(KG[1300] / 1000, 5);
    expect(await snapshotTotal(firstReport)).toBeCloseTo(KG[1200] / 1000, 5);
    expect(sha256((await download('a', firstReport)).bytes)).toBe(sha256(firstBytes));
  }, 60_000);
});

describe('F-E-08 — the company\'s reporting basis on reports', () => {
  it('reports made before the company set it say "not specified" and "not set"', async () => {
    for (const report of [firstReport, secondReport]) {
      const { text } = await download('a', report);
      expect(text).toContain('(Consolidation approach: not specified) Tj');
      expect(text).toContain('(Base year: not set) Tj');
    }
  });

  it('a report made after it was set prints the approach and the base year, and the earlier ones still do not', async () => {
    const before = sha256((await download('a', firstReport)).bytes);
    const set = await api('a', 'PATCH', `/api/companies/${company.a}`, { consolidation_approach: 'financial_control', base_year: 2019 });
    expect(set.status).toBe(200);
    thirdReport = await generate('a');
    const third = (await download('a', thirdReport)).text;
    expect(third).toContain('(Consolidation approach: Financial control) Tj');
    expect(third).toContain('(Base year: 2019) Tj');
    expect(await psql(CONTAINER, `SELECT concat_ws('|', snapshot->>'consolidation_approach', snapshot->>'base_year') FROM public.reports WHERE id = ${thirdReport}`)).toBe('financial_control|2019');

    const first = await download('a', firstReport);
    expect(first.text).toContain('(Consolidation approach: not specified) Tj');
    expect(first.text).not.toContain('Financial control');
    expect(sha256(first.bytes)).toBe(before);
    expect(await psql(CONTAINER, `SELECT concat_ws('|', snapshot->>'consolidation_approach', snapshot->>'base_year') FROM public.reports WHERE id = ${firstReport}`)).toBe('');
  }, 60_000);

  it('changing the basis again changes the next report only', async () => {
    expect((await api('a', 'PATCH', `/api/companies/${company.a}`, { consolidation_approach: 'equity_share', base_year: null })).status).toBe(200);
    const fourth = await generate('a');
    const { text } = await download('a', fourth);
    expect(text).toContain('(Consolidation approach: Equity share) Tj');
    expect(text).toContain('(Base year: not set) Tj');
    expect((await download('a', thirdReport)).text).toContain('(Consolidation approach: Financial control) Tj');
  }, 60_000);
});

describe('a signed-off report does not lock its entries', () => {
  it('the entry can still be edited after sign-off, and the signed-off report is byte for byte the same', async () => {
    const signed = await api('a', 'POST', `/api/reports/${thirdReport}/signoff`, {});
    expect(signed.status).toBe(200);
    expect((await json(signed)).report).toMatchObject({ id: thirdReport, status: 'final' });
    const bytes = (await download('a', thirdReport)).bytes;

    const res = await api('a', 'PATCH', `/api/entries/${entryId}`, { amount: 1400 });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ activity_amount: 1400, co2e_kg: KG[1400] });
    expect(sha256((await download('a', thirdReport)).bytes)).toBe(sha256(bytes));
    expect(await psql(CONTAINER, `SELECT status FROM public.reports WHERE id = ${thirdReport}`)).toBe('final');
    // The list says which report is final and what period it covers: what the SPA's
    // "a signed-off report covers this period" warning is built from.
    const list = (await json(await api('a', 'GET', '/api/reports'))).reports as Array<Body>;
    expect(list.find((report) => report.id === thirdReport)).toMatchObject({ status: 'final', period_start: '2025-01-01', period_end: '2025-12-31' });
  }, 60_000);
});

describe('erasure takes the edit trail with it', () => {
  it('deleting an entry deletes its history', async () => {
    expect(await count(`public.entry_history WHERE entry_id = ${entryId}`)).toBe(3);
    expect((await api('a', 'DELETE', `/api/entries/${entryId}`)).status).toBe(200);
    expect(await count(`public.entry_history WHERE company_id = ${company.a}`)).toBe(0);
  });

  it('"Delete my audit data" leaves no edit history either', async () => {
    const created = await api('a', 'POST', '/api/entries', GAS);
    const id = String((await json(created)).data.id);
    expect((await api('a', 'PATCH', `/api/entries/${id}`, { amount: 10 })).status).toBe(200);
    expect(await count(`public.entry_history WHERE company_id = ${company.a}`)).toBe(1);
    expect((await api('a', 'POST', '/api/account/delete-data', {})).status).toBe(200);
    expect(await count(`public.entry_history WHERE company_id = ${company.a}`)).toBe(0);
    expect(await count(`public.emission_entries WHERE company_id = ${company.a}`)).toBe(0);
  });
});

/**
 * A row as it was stored before the entry API (K2): CSV-shaped, amount and unit hold the
 * activity, and nothing is pinned (no activity_amount, factor_value or catalog_version). It is
 * priced by the frozen catalog: 1200 therms x 5.306 = 6367.2 kg.
 */
async function seedLegacyGas(): Promise<string> {
  return psql(
    CONTAINER,
    `WITH ins AS (
       INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, co2e_kg, factor, method, confidence, activity_date, created_at)
       VALUES (${company.c}, 'Scope 1', 'stationary_combustion', 'natural_gas', 1200, 'therms', ${FROZEN_KG_1200}, '0.005306', 'calculation', 90, '2025-03-15', '2025-03-15T00:00:00Z')
       RETURNING id)
     SELECT id::text FROM ins`
  );
}

describe('a row stored before the entry API has no pin: an edit follows the catalog that priced it (K7)', () => {
  let keepsId = '';
  let changesId = '';
  const pinOf = (id: string) => psql(
    CONTAINER,
    `SELECT concat_ws('|', co2e_kg, COALESCE(activity_amount::text, '-'), COALESCE(factor_value::text, '-'), COALESCE(left(catalog_version, 10), '-')) FROM public.emission_entries WHERE id = ${id}`
  );
  const historyOf = async (id: string) => JSON.parse(await psql(CONTAINER, `SELECT row_to_json(h)::text FROM public.entry_history h WHERE entry_id = ${id}`));

  beforeAll(async () => {
    keepsId = await seedLegacyGas();
    changesId = await seedLegacyGas();
  }, 60_000);

  it('is stored without a pin, and an edit of it has to send its amount, unit and date', async () => {
    expect(await pinOf(keepsId)).toBe(`${FROZEN_KG_1200}|-|-|-`);
    const res = await api('c', 'PATCH', `/api/entries/${keepsId}`, { activity_date: '2025-04-01' });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/amount, unit and activity_date/);
    expect(await pinOf(keepsId)).toBe(`${FROZEN_KG_1200}|-|-|-`);
    expect(await count(`public.entry_history WHERE company_id = ${company.c}`)).toBe(0);
  }, 60_000);

  it('an edit that keeps its activity keeps its figure on the frozen catalog (1200 x 5.306 = 6367.2 kg, not 1200 x 5.31145 = 6373.74) and writes that pin', async () => {
    const res = await api('c', 'PATCH', `/api/entries/${keepsId}`, { amount: 1200, unit: 'therms', activity_date: '2025-04-01' });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({
      id: Number(keepsId),
      activity_amount: 1200,
      activity_unit: 'therms',
      activity_date: '2025-04-01',
      co2e_kg: FROZEN_KG_1200,
      factor_value: 5.306,
      pricing_catalog: '2026-07-24',
      method: 'calculation',
      confidence: 90,
      catalog_version: expect.stringMatching(/^2026-07-24\+/),
    });
    expect(await pinOf(keepsId)).toBe(`${FROZEN_KG_1200}|1200|5.306|2026-07-24`);
    // The history shows a pin being written, and a figure that did not move.
    expect(await historyOf(keepsId)).toMatchObject({
      changed_by: USERS.c.id,
      old_values: { activity_amount: null, co2e_kg: FROZEN_KG_1200, factor_value: null, catalog_version: null, activity_date: '2025-03-15' },
      new_values: { activity_amount: 1200, co2e_kg: FROZEN_KG_1200, factor_value: 5.306, catalog_version: expect.stringMatching(/^2026-07-24\+/), activity_date: '2025-04-01' },
    });
  }, 60_000);

  it('an edit that changes its activity is a new calculation at the current catalog (1300 x 5.31145 = 6904.885 kg) and pins it there', async () => {
    const res = await api('c', 'PATCH', `/api/entries/${changesId}`, { amount: 1300, unit: 'therms', activity_date: '2025-03-15' });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({
      id: Number(changesId),
      activity_amount: 1300,
      co2e_kg: KG[1300],
      factor_value: 5.31145,
      pricing_catalog: '2026-09-30',
      catalog_version: expect.stringMatching(/^2026-09-30\+/),
    });
    expect(await pinOf(changesId)).toBe(`${KG[1300]}|1300|5.31145|2026-09-30`);
    expect(await historyOf(changesId)).toMatchObject({
      changed_by: USERS.c.id,
      old_values: { amount: 1200, activity_amount: null, co2e_kg: FROZEN_KG_1200, catalog_version: null },
      new_values: { activity_amount: 1300, co2e_kg: KG[1300], factor_value: 5.31145, catalog_version: expect.stringMatching(/^2026-09-30\+/) },
    });
  }, 60_000);

  it('the dashboard and the list count each row at the catalog that priced it: 6367.2 + 6904.885 = 13272.085 kg', async () => {
    expect(await summaryTonnes('c', '2025')).toBeCloseTo((FROZEN_KG_1200 + KG[1300]) / 1000, 5);
    const listed = (await json(await api('c', 'GET', '/api/entries'))).data as Array<Body>;
    expect(Object.fromEntries(listed.map((entry) => [String(entry.id), [entry.co2e_kg, entry.pricing_catalog]]))).toEqual({
      [keepsId]: [FROZEN_KG_1200, '2026-07-24'],
      [changesId]: [KG[1300], '2026-09-30'],
    });
  });
});
