// @vitest-environment node
/**
 * The CSV commit transaction (server-csv-import-routes.cjs runCommit over the
 * pgStore of server-csv-import-store.cjs), driven with a fake pg client that
 * records every statement. It used to
 * test reserveCsvImportQuota/persistCsvEntries in server.cjs, which K4 replaced:
 * the same guarantees hold (one transaction, the company row locked before the
 * quota count, all rows or none, batches below PostgreSQL's parameter limit),
 * plus the new ones: a replayed or duplicate upload writes nothing and spends
 * no quota, "replace" undoes the earlier import in the same transaction, and
 * every row points at its import. The real statements run against Postgres in
 * tests/csv-import-route.test.ts (Docker).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { runCommit } = require('../server-csv-import-routes.cjs');
const { pgStore, rowIdempotencyKey } = require('../server-csv-import-store.cjs');
const { withRlsBypass } = require('../server-entry-routes.cjs');
const { validateCsvImport } = require('../server-csv-import.cjs');
const { CATALOG_VERSION } = require('../server-entries.cjs');

const HEADER = 'scope,category,source,amount,unit,date';
const rowsText = (count: number) =>
  [HEADER, ...Array.from({ length: count }, (_, i) => `Scope 1,stationary_combustion,natural_gas,${i + 1},therms,2025-01-31`)].join('\n');
const reportOf = (count: number) => validateCsvImport(rowsText(count), { now: new Date('2026-09-30T12:00:00Z') });

interface Options {
  used?: number;
  failBatch?: number;
  previous?: Array<Record<string, unknown>>;
  holders?: Array<Record<string, unknown>>;
  /** The ids the company's facilities table still holds. */
  facilities?: string[];
}

function fixture({ used = 0, failBatch = 0, previous = [], holders = [], facilities = [] }: Options = {}) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const batches: number[] = [];
  let committed = false;
  const event = { id: '77', created_at: new Date('2026-09-30T12:00:00Z'), row_count: 0, status: 'committed' };
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push({ sql, values });
      if (sql === 'COMMIT') committed = true;
      if (sql.includes('FROM public.companies WHERE id = $1 FOR UPDATE')) return { rowCount: 1, rows: [{ id: 1 }] };
      if (sql.includes('e.idempotency_key = ANY')) return { rows: holders };
      if (sql.includes('FROM public.facilities')) return { rows: facilities.filter((id) => (values[1] as string[]).includes(id)).map((id) => ({ id })) };
      if (sql.includes("status = 'committed' ORDER BY")) return { rows: previous };
      if (sql.includes('COUNT(*)::int AS used')) return { rows: [{ used }] };
      if (sql.includes('activity_date = ANY')) return { rows: [] };
      if (sql.startsWith('INSERT INTO public.csv_import_events')) return { rows: [{ ...event, row_count: values[1] }] };
      if (sql.startsWith('INSERT INTO public.emission_entries')) {
        batches.push(values.length);
        if (batches.length === failBatch) throw new Error('batch failed');
        return { rowCount: values.length / 20, rows: [] };
      }
      if (sql.startsWith('DELETE FROM public.emission_entries')) return { rowCount: 3, rows: [] };
      if (sql.startsWith('UPDATE public.csv_import_events')) return { rowCount: 1, rows: [{ id: values[0], status: 'undone' }] };
      return { rowCount: 0, rows: [] };
    },
    release() {
      statements.push({ sql: 'RELEASE', values: [] });
    },
  };
  const commit = (request: Record<string, unknown>) =>
    withRlsBypass({ connect: async () => client }, (db: unknown) => runCommit(pgStore(db), { companyId: '1', plan: 'starter', key: null, onDuplicate: null, filename: 'bills.csv', ...request }));
  const sql = () => statements.map((s) => s.sql);
  const inserts = () => statements.filter((s) => s.sql.startsWith('INSERT INTO public.emission_entries'));
  return { commit, statements, sql, inserts, batches, committed: () => committed };
}

describe('the commit transaction', () => {
  it('locks the company row before it reads anything, and inserts the import then its rows on the same connection', async () => {
    const f = fixture();
    const outcome = await f.commit({ report: reportOf(2) });
    expect(outcome.kind).toBe('committed');
    expect(f.sql().slice(0, 3)).toEqual(['BEGIN', 'SET LOCAL row_security = off', 'SELECT id FROM public.companies WHERE id = $1 FOR UPDATE']);
    expect(f.sql().findIndex((s) => s.startsWith('INSERT INTO public.csv_import_events')))
      .toBeLessThan(f.sql().findIndex((s) => s.startsWith('INSERT INTO public.emission_entries')));
    expect(f.sql().at(-2)).toBe('COMMIT');
    expect(f.sql().at(-1)).toBe('RELEASE');
  });

  it('rolls everything back, the import record included, when a row insert fails', async () => {
    const f = fixture({ failBatch: 1 });
    await expect(f.commit({ report: reportOf(2) })).rejects.toThrow('batch failed');
    expect(f.sql()).toContain('ROLLBACK');
    expect(f.committed()).toBe(false);
    expect(f.sql().at(-1)).toBe('RELEASE');
  });

  it('writes nothing when the locked quota count is at the plan limit', async () => {
    const f = fixture({ used: 10 });
    expect((await f.commit({ report: reportOf(1) })).kind).toBe('quota');
    expect(f.sql().some((s) => s.startsWith('INSERT'))).toBe(false);
  });

  it('an unlimited plan never counts', async () => {
    const f = fixture({ used: 10_000 });
    expect((await f.commit({ report: reportOf(1), plan: 'growth' })).kind).toBe('committed');
    expect(f.sql().some((s) => s.includes('COUNT(*)::int AS used'))).toBe(false);
  });

  it('batches large uploads below the protocol parameter limit, 20 values per row', async () => {
    const f = fixture();
    await f.commit({ report: reportOf(2500) });
    expect(f.batches).toEqual([20000, 20000, 10000]);
    expect(Math.max(...f.batches)).toBeLessThan(65535);
  });

  it('rolls back earlier batches when a later batch fails', async () => {
    const f = fixture({ failBatch: 2 });
    await expect(f.commit({ report: reportOf(2001) })).rejects.toThrow('batch failed');
    expect(f.batches).toHaveLength(2);
    expect(f.sql().at(-2)).toBe('ROLLBACK');
    expect(f.committed()).toBe(false);
  });

  it('every row points at its import, carries its per-row key and import time, and leaves created_at to the database', async () => {
    const f = fixture();
    const report = reportOf(1);
    await f.commit({ report, key: 'upload-key-0001' });
    const [insert] = f.inserts();
    expect(insert.sql).toMatch(/\(company_id, import_id, facility_id, .*, idempotency_key, imported_at\) VALUES \(\$1, .*, \$20, now\(\)\)$/);
    expect(insert.sql).not.toMatch(/created_at/);
    expect(insert.values.slice(0, 2)).toEqual(['1', '77']);
    expect(insert.values.at(-1)).toBe(rowIdempotencyKey('upload-key-0001', 2));
    // Pinned like a manual entry: factor_value, factor_source, catalog_version. Natural gas per therm, by hand from
    // the catalog 2026-09-30 `citation` (Hub Table 1): (53.06 kg CO2 + 1.0 g CH4 x 28 + 0.10 g N2O x 265) / 10.
    const gasPerTherm = Number(((53.06 + (1.0 * 28 + 0.1 * 265) / 1000) / 10).toPrecision(6)); // 5.31145 (catalog 2026-07-24: 5.306)
    expect(insert.values).toEqual(expect.arrayContaining([gasPerTherm, 'epa-efh-2025', CATALOG_VERSION, '2025-01-31', 1, 'therms']));
    expect(CATALOG_VERSION).toMatch(/^2026-09-30\+/);
  });
});

// VERIFY-FINAL-DATA D-1. The file's facilities were read before this transaction; a delete
// (SELECT ... FOR UPDATE on the facility, then DELETE) that commits before the rows' foreign key is
// checked made the INSERT fail with 23503. Behaviour against real Postgres: tests/csv-import-route.test.ts.
describe('the facilities a file names', () => {
  const FACILITY_HEADER = 'scope,category,source,amount,unit,date,facility_name';
  const named = (...names: string[]) => validateCsvImport(
    [FACILITY_HEADER, ...names.map((name, i) => `Scope 1,stationary_combustion,natural_gas,${i + 1},therms,2025-01-31,${name}`)].join('\n'),
    { now: new Date('2026-09-30T12:00:00Z'), facilities: [{ id: '41', name: 'Main Plant' }, { id: '42', name: 'Depot' }] }
  );
  const facilityOf = (insert: { values: unknown[] }, row: number) => insert.values[row * 20 + 2]; // facility_id is the third of 20 columns

  it('are locked FOR KEY SHARE after the company row and before the import is stored, once each', async () => {
    const f = fixture({ facilities: ['41', '42'] });
    expect((await f.commit({ report: named('Main Plant', 'Depot', 'Main Plant', '') })).kind).toBe('committed');
    const sql = f.sql();
    const lock = sql.findIndex((s) => s.includes('FROM public.facilities'));
    expect(sql[lock]).toBe('SELECT id FROM public.facilities WHERE company_id = $1 AND id = ANY($2::bigint[]) FOR KEY SHARE');
    expect(sql.filter((s) => s.includes('FROM public.facilities'))).toHaveLength(1);
    expect(lock).toBeGreaterThan(sql.findIndex((s) => s.includes('FROM public.companies WHERE id = $1 FOR UPDATE')));
    expect(lock).toBeLessThan(sql.findIndex((s) => s.startsWith('INSERT INTO public.csv_import_events')));
    expect(f.statements[lock].values).toEqual(['1', ['41', '42']]);
    expect([0, 1, 2, 3].map((row) => facilityOf(f.inserts()[0], row))).toEqual(['41', '42', '41', null]);
  });

  it('a file that names none takes no facility lock', async () => {
    const f = fixture();
    await f.commit({ report: reportOf(2) });
    expect(f.sql().some((s) => s.includes('FROM public.facilities'))).toBe(false);
  });

  it('a facility that is gone is stored as none, the others stay, and the import says which rows', async () => {
    const f = fixture({ facilities: ['41'] });
    const outcome = await f.commit({ report: named('Main Plant', 'Depot', 'Depot') });
    expect(outcome.kind).toBe('committed');
    expect([0, 1, 2].map((row) => facilityOf(f.inserts()[0], row))).toEqual(['41', null, null]);
    expect(outcome.warnings).toEqual(['2 rows (lines 3 and 4) name a facility that was deleted while the file was being imported: imported without a facility.']);
    expect(outcome.event.row_count).toBe(3);
  });
});

describe('uploads that store nothing and spend nothing', () => {
  it('the same file again (409): no insert, no quota count', async () => {
    const report = reportOf(3);
    const previous = [{ id: '5', created_at: new Date('2026-09-01T00:00:00Z'), row_count: 3, file_sha256: report.fileSha256, status: 'committed' }];
    const f = fixture({ previous });
    const outcome = await f.commit({ report });
    expect(outcome).toMatchObject({ kind: 'duplicate', previous: { id: '5' } });
    expect(f.sql().some((s) => s.startsWith('INSERT') || s.includes('COUNT(*)::int AS used'))).toBe(false);
  });

  it('a retried commit with the same Idempotency-Key returns the stored import', async () => {
    const report = reportOf(3);
    const f = fixture({ holders: [{ id: '5', row_count: 3, file_sha256: report.fileSha256, status: 'committed' }] });
    expect(await f.commit({ report, key: 'upload-key-0001' })).toMatchObject({ kind: 'replayed', event: { id: '5' } });
    expect(f.sql().some((s) => s.startsWith('INSERT'))).toBe(false);
    const keys = f.statements.find((s) => s.sql.includes('e.idempotency_key = ANY'))?.values[1];
    expect(keys).toEqual([2, 3, 4].map((line) => rowIdempotencyKey('upload-key-0001', line)));
  });

  it('the same key for another file is refused', async () => {
    const f = fixture({ holders: [{ id: '5', row_count: 3, file_sha256: 'f'.repeat(64), status: 'committed' }] });
    expect((await f.commit({ report: reportOf(3), key: 'upload-key-0001' })).kind).toBe('key_reused');
    expect(f.sql().some((s) => s.startsWith('INSERT'))).toBe(false);
  });
});

describe('the caller\'s choice for a file imported before', () => {
  const report = reportOf(3);
  const previous = [{ id: '5', created_at: new Date('2026-09-01T00:00:00Z'), row_count: 3, file_sha256: report.fileSha256, status: 'committed' }];

  it('replace: the earlier import\'s rows go and it is marked undone, in the same transaction, before the new rows', async () => {
    const f = fixture({ previous });
    const outcome = await f.commit({ report, onDuplicate: 'replace' });
    expect(outcome).toMatchObject({ kind: 'committed', replaced: ['5'] });
    const sql = f.sql();
    const removed = sql.findIndex((s) => s.startsWith('DELETE FROM public.emission_entries WHERE import_id = $1 AND company_id = $2'));
    const undone = sql.findIndex((s) => s.startsWith('UPDATE public.csv_import_events'));
    expect(removed).toBeGreaterThan(-1);
    expect(undone).toBeGreaterThan(removed);
    expect(sql.findIndex((s) => s.startsWith('INSERT INTO public.emission_entries'))).toBeGreaterThan(undone);
    expect(f.statements[removed].values).toEqual(['5', '1']);
  });

  it('import anyway: imported with a warning that says it was imported before', async () => {
    const f = fixture({ previous });
    const outcome = await f.commit({ report, onDuplicate: 'import_anyway' });
    expect(outcome.kind).toBe('committed');
    expect(outcome.warnings[0]).toMatch(/^This file was already imported on 2026-09-01 \(3 rows\)/);
    expect(f.sql().some((s) => s.startsWith('DELETE'))).toBe(false);
  });
});
