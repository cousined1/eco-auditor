// @vitest-environment node
/**
 * K4 (F-E-04 = F-B-06, F-C-06, F-E-13, F-E-18): the CSV import handlers
 * (server-csv-import-routes.cjs) over a fake pg pool that answers the SQL they
 * send from two arrays (the server has no in-memory store any more, F-G-07). The
 * same flows against real Postgres, with concurrent requests and real tenants,
 * are in tests/csv-import-route.test.ts (Docker).
 *
 * On the code before K4: an identical file imported twice doubled every total
 * with no message; a file with one bad row stored the others, so the fixed
 * re-upload counted them twice and spent a second import; there was no dry
 * run, no history and no undo.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createCsvImportHandlers } = require('../server-csv-import-routes.cjs');
const engine = require('../emissions-engine.cjs');

type Json = Record<string, unknown>;
/** The response fields these tests read; the rest is checked with toMatchObject. */
interface Body extends Json {
  error: string;
  code: string;
  errors: string[];
  warnings: string[];
  data: Json[];
  import: Json & { created_at: string };
  import_id: string;
  imported: number;
  replaced_imports: string[];
}
interface Res { statusCode: number; body: Body; status(code: number): Res; json(body: Body): Res }

function response(): Res {
  const res: Res = {
    statusCode: 200,
    body: {} as Body,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

const HEADER = 'scope,category,source,amount,unit,date,facility_name';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n') + '\n';
const GAS_2025 = 'Scope 1,stationary_combustion,natural_gas,1000,therms,2025-11-20,';
const CAMX_2026 = 'Scope 2,purchased_electricity,CAMX,100000,kWh,2026-02-01,';
const BAD_THERM = 'Scope 1,stationary_combustion,natural_gas,500,thermz,2026-07-01,';

// Factors worked out by hand from emission-factors.json (catalog 2026-09-30, which prices a new row), from
// the natural_gas `citation` (Hub Table 1) at the AR5 GWP-100 of `gwpBasis` (CH4 28, N2O 265), kept to the
// catalog's 6 significant figures. "was" = catalog 2026-07-24.
const sf6 = (x: number) => Number(x.toPrecision(6));
const GAS_PER_THERM = sf6((53.06 + (1.0 * 28 + 0.1 * 265) / 1000) / 10); // (53.06 kg CO2 + 1.0 g CH4 + 0.10 g N2O) per mmBtu / 10 = 5.31145 (was 5.306)
const GAS_PER_MCF = sf6(1000 * (0.05444 + (0.00103 * 28 + 0.0001 * 265) / 1000)); // 1,000 x (0.05444 kg CO2 + 0.00103 g CH4 + 0.00010 g N2O) per scf = 54.4953 (was 54.44)
const CAMX_PER_KWH = 0.19504; // eGRID2023 CAMX (unchanged)
// Tonnes of the rows above.
const GAS_T = (1000 * GAS_PER_THERM) / 1000; // 5.31145
const CAMX_T = (100000 * CAMX_PER_KWH) / 1000; // 19.504
const THERM_500_T = (500 * GAS_PER_THERM) / 1000; // 2.655725

/**
 * A pg pool that answers the statements pgStore and withRlsBypass send
 * (server-csv-import-store.cjs, server-entry-routes.cjs) from three arrays; any
 * other statement throws, and so does the statement `fail.match` names. now() is
 * the transaction's start, as in Postgres.
 * ponytail: ROLLBACK undoes nothing, no test here fails inside a transaction.
 */
function fakePool(entries: Json[], imports: Json[], facilities: Json[], fail?: { match: string; error: Error }) {
  let now = new Date().toISOString();
  let nextId = 1;
  const own = (row: Json, companyId: unknown) => String(row.company_id) === String(companyId);
  const importOf = (companyId: unknown, id: unknown) => imports.find((i) => own(i, companyId) && String(i.id) === String(id));
  const result = (rows: Json[], rowCount = rows.length) => ({ rows, rowCount });
  async function query(sql: string, params: unknown[] = []) {
    const [a, b] = params;
    if (sql === 'BEGIN') now = new Date().toISOString();
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/u.test(sql)) return result([]);
    if (fail && sql.includes(fail.match)) throw fail.error;
    if (sql.includes('FROM public.facilities WHERE company_id = $1 AND id = ANY') && sql.endsWith('FOR KEY SHARE')) {
      return result(facilities.filter((f) => own(f, a) && (b as string[]).includes(String(f.id))).map((f) => ({ id: f.id })));
    }
    if (sql.includes('AS rows_present')) {
      return result(imports.filter((i) => own(i, a)).reverse().map((i) => ({
        ...i, rows_present: entries.filter((e) => own(e, a) && e.import_id === i.id).length, signed_off_reports: [],
      })));
    }
    if (sql.includes('idempotency_key = ANY')) {
      const keys = new Set(b as string[]);
      const ids = new Set(entries.filter((e) => own(e, a) && keys.has(String(e.idempotency_key))).map((e) => e.import_id));
      return result([...ids].map((id) => importOf(a, id) ?? { id: null }));
    }
    if (sql.includes("SET status = 'undone'")) return result([Object.assign(importOf(b, a)!, { status: 'undone', undone_at: now })]);
    if (sql.startsWith('DELETE FROM public.emission_entries')) {
      const kept = entries.filter((e) => !(own(e, b) && String(e.import_id) === String(a)));
      const removed = entries.length - kept.length;
      entries.splice(0, entries.length, ...kept);
      return result([], removed);
    }
    if (sql.includes('FROM public.reports r')) return result([]); // no reports, so none is signed off
    if (sql.includes('INSERT INTO public.csv_import_events')) {
      const [, rowCount, sha, warningCount, filename] = params;
      const event = { id: String(nextId++), company_id: a, created_at: now, row_count: rowCount, warning_count: warningCount, original_filename: filename, status: 'committed', undone_at: null, file_sha256: sha };
      imports.push(event);
      return result([event]);
    }
    if (sql.includes('INSERT INTO public.emission_entries')) {
      const columns = /emission_entries \(([^)]+), imported_at\)/u.exec(sql)![1].split(', ');
      for (let at = 0; at < params.length; at += columns.length) {
        entries.push({ ...Object.fromEntries(columns.map((column, i) => [column, params[at + i]])), imported_at: now, created_at: now });
      }
      return result([]);
    }
    if (sql.includes('AS used')) {
      const month = new Date().toISOString().slice(0, 7);
      return result([{ used: imports.filter((i) => own(i, a) && String(i.created_at).slice(0, 7) === month).length }]);
    }
    if (sql.includes('file_sha256 = $2')) return result(imports.filter((i) => own(i, a) && i.file_sha256 === b && i.status === 'committed').reverse());
    if (sql.includes('csv_import_events WHERE id = $1')) return result([importOf(b, a)].filter((i): i is Json => i !== undefined));
    if (sql.includes('FROM public.companies WHERE id = $1 FOR UPDATE')) return result([{ id: a }]);
    if (sql.includes('activity_date = ANY')) {
      return result(entries.filter((e) => own(e, a) && ((b as string[]).includes(String(e.activity_date)) || (params[2] === true && e.activity_date == null))));
    }
    throw new Error(`fake pool: unexpected SQL ${sql.slice(0, 80)}`);
  }
  return { query, connect: async () => ({ query, release: () => undefined }) };
}

function harness(plan = 'starter', fail?: { match: string; error: Error }) {
  const entries: Json[] = [];
  const imports: Json[] = [];
  const facilities: Json[] = [{ id: '41', company_id: '7', name: 'Main Plant' }];
  const invalidated: string[] = [];
  // Runs once the file's facilities are read and before its transaction starts: where a delete can land.
  const hooks: { afterFacilitiesRead: () => void } = { afterFacilitiesRead: () => {} };
  const handlers = createCsvImportHandlers({
    pool: fakePool(entries, imports, facilities, fail),
    // As server.cjs requireCompanyAccess: the caller's own company, 403 for another.
    requireCompanyAccess: async (req: Json, res: Res, requested: unknown) => {
      if (requested && String(requested) !== req.company) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return null;
      }
      return req.company;
    },
    loadFacilities: async (companyId: string) => {
      const read = facilities.filter((f) => f.company_id === companyId);
      hooks.afterFacilitiesRead();
      return read;
    },
    invalidateCompanyCache: (companyId: string) => invalidated.push(String(companyId)),
    log: () => {},
  });
  const request = (company: string, extra: Json) => ({ company, query: {}, headers: {}, params: {}, body: {}, billing: { plan }, user: { id: `user-${company}` }, ...extra });
  const upload = async (text: string, options: { company?: string; query?: Json; key?: string } = {}) => {
    const res = response();
    await handlers.ingest(request(options.company ?? '7', { query: options.query ?? {}, body: text, headers: options.key ? { 'idempotency-key': options.key } : {} }), res);
    return res;
  };
  const check = (text: string, company = '7') => upload(text, { company, query: { dry_run: '1' } });
  const list = async (company = '7', query: Json = {}) => {
    const res = response();
    await handlers.list(request(company, { query }), res);
    return res;
  };
  const undo = async (id: string, body: Json = {}, company = '7') => {
    const res = response();
    await handlers.undo(request(company, { params: { id }, body }), res);
    return res;
  };
  const tonnes = (year: string, company = '7') =>
    engine.summarizeEntries(entries.filter((e) => e.company_id === company && String(e.activity_date ?? e.created_at).startsWith(year))).total_emissions_tCO2e;
  return { entries, facilities, hooks, invalidated, upload, check, list, undo, tonnes };
}

describe('the dry run checks everything and stores nothing', () => {
  it('reports rows, errors, warnings, conversions and totals; no row, no import, no quota', async () => {
    const h = harness();
    const res = await h.check(csv(GAS_2025, 'Scope 1,stationary_combustion,natural_gas,1000,ccf,2025-12-31,North Plant', BAD_THERM));
    expect(res.statusCode).toBe(200);
    const scope1 = GAS_T + (100 * GAS_PER_MCF) / 1000; // 1,000 therms + 1,000 ccf (100 MCF) = 10.76098
    expect(res.body).toMatchObject({
      dry_run: true, total_rows: 3, valid_rows: 2, error_count: 1, can_commit: false, imports_left: 10, duplicate_of: null,
      conversions: ['1 row in ccf converted to MCF (x 0.1): line 3'],
      tonnes: { scope1: expect.closeTo(scope1, 5), scope2: 0, scope3: 0, total: expect.closeTo(scope1, 5), non_kyoto: 0 },
    });
    expect(res.body.errors[0]).toContain('Line 4: unit "thermz" cannot be used for stationary_combustion natural_gas. Use one of: MMBtu, therms, MCF, GJ');
    expect(res.body.warnings).toEqual(['1 row (line 3) names the facility "North Plant", which does not exist: imported without a facility.']);
    expect(h.entries).toEqual([]);
    expect((await h.list()).body.data).toEqual([]);
  });
});

describe('validate all, then commit (F-B-06): nothing is stored while any row has an error', () => {
  it('the file with a bad row is refused whole; the fixed file counts each row once and spends one import', async () => {
    const h = harness();
    const refused = await h.upload(csv(GAS_2025, CAMX_2026, BAD_THERM));
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toMatchObject({ code: 'invalid_file', imported: 0, error_count: 1 });
    expect(refused.body.error).toBe('This file has 1 error. Nothing was imported: fix it and upload the file again.');
    expect(h.entries).toEqual([]);

    const fixed = await h.upload(csv(GAS_2025, CAMX_2026, BAD_THERM.replace('thermz', 'therm')));
    expect(fixed.statusCode).toBe(200);
    expect(fixed.body).toMatchObject({ success: true, imported: 3, total_rows: 3, errors: [] });
    expect(h.tonnes('2025')).toBeCloseTo(GAS_T, 6);
    expect(h.tonnes('2026')).toBeCloseTo(CAMX_T + THERM_500_T, 6); // with the 500 therms the old code refused
    expect((await h.list()).body.data).toHaveLength(1);
  });

  it('stored rows are pinned, point at their import and keep the insert time apart from the activity date', async () => {
    const h = harness();
    const res = await h.upload(csv(GAS_2025.replace(/,$/, ',Main Plant')), { query: { filename: 'C:\\bills\\gas.csv' } });
    expect(res.body.import).toMatchObject({ original_filename: 'gas.csv', row_count: 1, status: 'committed' });
    expect(h.entries[0]).toMatchObject({
      import_id: res.body.import_id, facility_id: '41', activity_date: '2025-11-20', activity_amount: 1000, activity_unit: 'therms',
      factor_value: GAS_PER_THERM, factor_source: 'epa-efh-2025',
      imported_at: res.body.import.created_at, created_at: res.body.import.created_at,
    });
    expect(String(h.entries[0]?.created_at).slice(0, 10)).not.toBe('2025-11-20');
    expect(h.invalidated).toEqual(['7']);
  });
});

describe('the same file twice (F-E-04)', () => {
  it('answers 409 "already imported on <date> (n rows)" and changes no total', async () => {
    const h = harness();
    expect((await h.upload(csv(GAS_2025, CAMX_2026))).statusCode).toBe(200);
    const before = [h.tonnes('2025'), h.tonnes('2026')];
    const again = await h.upload(csv(GAS_2025, CAMX_2026).replace(/\n/g, '\r\n'));
    expect(again.statusCode).toBe(409);
    expect(again.body.code).toBe('duplicate_file');
    expect(again.body.error).toMatch(/^This file was already imported on \d{4}-\d{2}-\d{2} \(2 rows\)\. Nothing was imported\./);
    expect([h.tonnes('2025'), h.tonnes('2026')]).toEqual(before);
    expect((await h.list()).body.data).toHaveLength(1);
    expect((await h.check(csv(GAS_2025, CAMX_2026))).body.warnings[0]).toMatch(/^This file was already imported on/);
  });

  it('replace: the earlier import is undone and the file stored once, in one step', async () => {
    const h = harness();
    const first = await h.upload(csv(GAS_2025, CAMX_2026));
    const replaced = await h.upload(csv(GAS_2025, CAMX_2026), { query: { on_duplicate: 'replace' } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.body.replaced_imports).toEqual([first.body.import_id]);
    expect(h.entries).toHaveLength(2);
    expect(h.entries.every((entry) => entry.import_id === replaced.body.import_id)).toBe(true);
    expect((await h.list()).body.data.map((i: Json) => i.status)).toEqual(['committed', 'undone']);
  });

  it('import anyway: two identical deliveries are real data, stored twice with a warning', async () => {
    const h = harness();
    await h.upload(csv(GAS_2025));
    const anyway = await h.upload(csv(GAS_2025), { query: { on_duplicate: 'import_anyway' } });
    expect(anyway.statusCode).toBe(200);
    expect(anyway.body.warnings[0]).toMatch(/^This file was already imported on/);
    expect(h.tonnes('2025')).toBeCloseTo(2 * GAS_T, 6);
  });

  it('a row that matches a stored one is a warning with its line, never dropped', async () => {
    const h = harness();
    await h.upload(csv(GAS_2025));
    const text = csv(GAS_2025, 'Scope 1,stationary_combustion,natural_gas,999,therms,2025-11-21,');
    expect((await h.check(text)).body).toMatchObject({ overlapping_rows: 1, duplicate_of: null });
    const res = await h.upload(text);
    expect(res.statusCode).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.warnings.at(-1)).toMatch(/^1 row \(line 2\) matches an entry already stored/);
  });
});

describe('Idempotency-Key: a retried commit stores nothing twice', () => {
  it('the same key and file return the stored import; the same key with another file is 422', async () => {
    const h = harness();
    const first = await h.upload(csv(GAS_2025), { key: 'upload-0001-abcd' });
    const retry = await h.upload(csv(GAS_2025), { key: 'upload-0001-abcd' });
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatchObject({ replayed: true, import_id: first.body.import_id, imported: 1 });
    expect(h.entries).toHaveLength(1);
    const reused = await h.upload(csv(GAS_2025.replace('1000', '1001')), { key: 'upload-0001-abcd' });
    expect(reused.statusCode).toBe(422);
    expect(reused.body.code).toBe('idempotency_key_reused');
    expect((await h.upload(csv(GAS_2025), { key: 'bad key' })).statusCode).toBe(400);
    expect((await h.upload(csv(GAS_2025), { query: { on_duplicate: 'merge' } })).statusCode).toBe(400);
  });
});

describe('quota: only a commit spends an import', () => {
  it('ten dry runs, a refused file and a 409 cost nothing; an undo refunds nothing; the eleventh commit is 402', async () => {
    const h = harness('starter');
    for (let i = 0; i < 10; i++) expect((await h.check(csv(GAS_2025))).statusCode).toBe(200);
    expect((await h.upload(csv(BAD_THERM))).statusCode).toBe(422);
    const first = await h.upload(csv(GAS_2025));
    expect((await h.upload(csv(GAS_2025))).statusCode).toBe(409);
    expect((await h.undo(first.body.import_id)).statusCode).toBe(200);
    for (let i = 2; i <= 10; i++) expect((await h.upload(csv(GAS_2025.replace('1000', String(1000 + i))))).statusCode).toBe(200);
    const eleventh = await h.upload(csv(CAMX_2026));
    expect(eleventh.statusCode).toBe(402);
    expect(eleventh.body).toMatchObject({ code: 'upgrade_required', requiredPlan: 'growth' });
    expect((await h.check(csv(CAMX_2026))).statusCode).toBe(402);
  });

  it('Scope 3 on Starter is refused whole (402), even as a mislabelled row; Growth imports it', async () => {
    const h = harness('starter');
    const scope3 = 'Scope 1,purchased_goods,purchased_goods,500,USD,2025-01-01,';
    const res = await h.upload(csv(GAS_2025, scope3));
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ code: 'upgrade_required', requiredPlan: 'growth' });
    expect(h.entries).toEqual([]);
    expect((await harness('growth').upload(csv('Scope 3,purchased_goods,purchased_goods,500,USD,2025-01-01,'))).statusCode).toBe(200);
  });
});

describe('history and undo', () => {
  it('lists imports newest first; undo removes the rows, keeps the import as undone, and cannot run twice', async () => {
    const h = harness();
    const a = await h.upload(csv(GAS_2025), { query: { filename: 'a.csv' } });
    await h.upload(csv(CAMX_2026), { query: { filename: 'b.csv' } });
    const listed = (await h.list()).body.data;
    expect(listed.map((i: Json) => [i.original_filename, i.status, i.row_count, i.rows_present])).toEqual([['b.csv', 'committed', 1, 1], ['a.csv', 'committed', 1, 1]]);

    const undone = await h.undo(a.body.import_id);
    expect(undone.statusCode).toBe(200);
    expect(undone.body).toMatchObject({ removed_rows: 1, import: { status: 'undone' } });
    expect(h.tonnes('2025')).toBe(0);
    expect(h.tonnes('2026')).toBeCloseTo(CAMX_T, 6);
    expect((await h.undo(a.body.import_id)).body).toMatchObject({ code: 'already_undone' });
    expect((await h.undo('999')).statusCode).toBe(404);
  });

  it('another company cannot see or undo the import, and naming its company is 403', async () => {
    const h = harness();
    const a = await h.upload(csv(GAS_2025));
    expect((await h.list('8')).body.data).toEqual([]);
    expect((await h.undo(a.body.import_id, {}, '8')).statusCode).toBe(404);
    expect(h.entries).toHaveLength(1);
    expect((await h.list('8', { company_id: '7' })).statusCode).toBe(403);
  });
});

describe('UAD-02 (moved from audit-20260922-regressions): no message describes storage that did not happen', () => {
  it('a file with a rejected row stores nothing, and says so', async () => {
    const h = harness();
    const res = await h.upload(csv('Scope 1,stationary_combustion,unobtainium,10,therms,2025-01-01,Ghost Facility'));
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/Nothing was imported/);
    expect(h.entries).toEqual([]);
  });

  it('a stored row with an unknown facility reports the facility note', async () => {
    const h = harness();
    const res = await h.upload(csv('Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,Ghost Facility'));
    expect(res.statusCode).toBe(200);
    expect(h.entries).toHaveLength(1);
    expect(res.body.warnings.join(' ')).toMatch(/"Ghost Facility", which does not exist: imported without a facility/);
  });

  it('an unparseable date is an error on its line, never a row stored at the import time', async () => {
    const h = harness();
    const res = await h.upload(csv('Scope 1,stationary_combustion,natural_gas,10,therms,not-a-date,'));
    expect(res.statusCode).toBe(422);
    expect(res.body.errors).toEqual(['Line 2: date "not-a-date" is not a date: use YYYY-MM-DD (or M/D/YYYY).']);
    expect(h.entries).toEqual([]);
  });
});

describe('a facility deleted between the check of a file and its commit (D-1)', () => {
  // VERIFY-FINAL-DATA D-1: the file's facilities are read before its transaction, so a delete in between
  // (removeFacility, server-company-routes.cjs) failed the rows' foreign key: 23503, which was answered 503.
  it('a facility deleted after the file was checked is imported without one, and the response says so', async () => {
    const h = harness();
    h.facilities.push({ id: '42', company_id: '7', name: 'Depot' });
    h.hooks.afterFacilitiesRead = () => h.facilities.splice(1); // the Depot goes, Main Plant stays
    const res = await h.upload(csv(
      'Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,Main Plant',
      'Scope 1,stationary_combustion,natural_gas,20,therms,2025-01-02,Depot',
      'Scope 1,stationary_combustion,natural_gas,30,therms,2025-01-03,'
    ));
    expect(res.statusCode).toBe(200);
    expect(res.body.imported).toBe(3);
    expect(h.entries.map((e) => e.facility_id)).toEqual(['41', null, null]);
    expect(res.body.warnings).toEqual(['1 row (line 3) names a facility that was deleted while the file was being imported: imported without a facility.']);
  });

  it('the overlap check reads such a row as it is stored, without the deleted facility', async () => {
    const h = harness();
    expect((await h.upload(csv('Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,'))).statusCode).toBe(200);
    h.hooks.afterFacilitiesRead = () => h.facilities.splice(0);
    const res = await h.upload(csv(
      'Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,Main Plant',
      'Scope 1,stationary_combustion,natural_gas,11,therms,2025-01-01,'
    ));
    expect(res.statusCode).toBe(200);
    expect(res.body.warnings.join(' ')).toContain('1 row (line 2) matches an entry already stored');
  });
});

// VERIFY-FINAL-DATA D-1: any error with a code used to answer 503 ("retry later"), a constraint or data
// error included. The outage test is the one the entry routes use (isOutage).
describe('a failed commit, history or undo answers 503 for an outage only', () => {
  const coded = (code: string) => Object.assign(new Error('driver text of ' + code), { code });
  const cases: Array<[string, number, Error]> = [
    ['23503 (foreign key)', 500, coded('23503')],
    ['22003 (numeric out of range)', 500, coded('22003')],
    ['08006 (connection failure)', 503, coded('08006')],
    ['57014 (statement timeout)', 503, coded('57014')],
    ['ECONNRESET', 503, coded('ECONNRESET')],
    ['a pool timeout, which carries no code', 503, new Error('timeout exceeded when trying to connect')],
  ];
  it.each(cases)('%s answers %i, without the driver text', async (_name, status, error) => {
    const commit = await harness('starter', { match: 'INSERT INTO public.emission_entries', error }).upload(csv(GAS_2025));
    const history = await harness('starter', { match: 'AS rows_present', error }).list();
    const undone = await harness('starter', { match: 'csv_import_events WHERE id = $1', error }).undo('1');
    for (const res of [commit, history, undone]) {
      expect(res.statusCode).toBe(status);
      expect(JSON.stringify(res.body)).not.toContain('driver text');
    }
  });
});
