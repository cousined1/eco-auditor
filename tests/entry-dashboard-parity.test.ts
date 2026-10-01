// @vitest-environment node
/**
 * F-E-10: a row the engine could not price vanished from every total with no
 * message, and the entry list could show a number no total used. Now:
 * - the summary (and the dashboard summary) carries excluded_rows: count and
 *   reasons;
 * - the entry list's per-row CO2e (presentEntry) is the value the totals count,
 *   for every stored row shape, legacy or pinned, and a row the totals leave out
 *   is flagged in the list instead of shown as a number;
 * - every read that feeds the engine carries the row's pin, so the dashboard
 *   and the list price a row with the same catalog.
 * On the code before K7, excluded_rows did not exist and the summary loader
 * did not select catalog_version.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const engine = require('../emissions-engine.cjs');
const entries = require('../server-entries.cjs');
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION } = require('../emission-factors.cjs');
const { rows: legacyRows } = require('./fixtures/legacy-emission-rows.json');

const NOW = new Date('2026-09-30T12:00:00Z');
const newRow = (input: Record<string, unknown>, id: number) => {
  const checked = entries.validateEntryInput({ activity_date: '2026-09-01', ...input }, NOW);
  if (!checked.ok) throw new Error(checked.error);
  return { ...checked.row, id, company_id: 7, created_at: '2026-09-30T10:00:00.000Z' };
};
const pinnedRows = [
  newRow({ scope: 'Scope 1', category: 'stationary_combustion', source: 'wood', amount: 10, unit: 'short tons' }, 101),
  newRow({ scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r22', amount: 10, unit: 'kg' }, 102),
  newRow({ scope: 'Scope 2', category: 'renewable_electricity', source: 'CAMX', amount: 100000, unit: 'kWh' }, 103),
  newRow({ scope: 'Scope 1', category: 'mobile_combustion', source: 'lng', amount: 100, unit: 'gallons' }, 104),
];
const allRows = [...legacyRows, ...pinnedRows];

describe('excluded rows are reported, not dropped (F-E-10)', () => {
  it('the summary counts them and gives each reason with the entry ids', () => {
    const s = engine.summarizeEntries(allRows);
    expect(s.excluded_rows.count).toBe(2);
    expect(s.excluded_rows.reasons).toEqual([
      { reason: expect.stringMatching(/^Unknown category: made_up_category\./), count: 1, entry_ids: [32] },
      { reason: 'Unsupported Scope 1 source/unit: natural_gas therm', count: 1, entry_ids: [33] },
    ]);
  });

  it('the dashboard summary passes them on with the market-based and memo lines', () => {
    const s = engine.summarizeEntries(pinnedRows);
    const dashboard = engine.toDashboardSummary(s, null);
    expect(dashboard.excluded_rows).toEqual({ count: 0, reasons: [] });
    expect(dashboard.biogenic_co2_tonnes).toBeCloseTo(16.4, 6);
    expect(dashboard.non_kyoto_co2e_tonnes).toBeCloseTo(17.6, 6);
    expect(dashboard.scope2_co2e_tonnes).toBeCloseTo(19.504, 6);
    expect(dashboard.scope2_market_co2e_tonnes).toBe(0);
  });

  it('caps the ids it lists but not the count', () => {
    const broken = Array.from({ length: 30 }, (_, i) => ({ id: i, scope: 'Scope 1', category: 'nope', source: 'x', amount: 1, unit: 'kg' }));
    const s = engine.summarizeEntries(broken);
    expect(s.excluded_rows.count).toBe(30);
    expect(s.excluded_rows.reasons[0].count).toBe(30);
    expect(s.excluded_rows.reasons[0].entry_ids).toHaveLength(20);
  });

  it('the summary route logs them and returns them through the dashboard summary', () => {
    const server = readFileSync(resolve('server.cjs'), 'utf8');
    const route = server.slice(server.indexOf("app.get('/api/emissions/summary'"), server.indexOf("app.get('/api/emissions/trend'"));
    expect(route).toMatch(/summary\.excluded_rows\.count > 0/);
    expect(route).toMatch(/log\('warn', 'Emission entries excluded from totals'/);
    expect(route).toMatch(/toDashboardSummary\(summary, priorSummary\)/);
  });
});

describe('the entry list shows the number the totals count, for every stored row (F-E-10)', () => {
  it('presentEntry and summarizeEntries agree row by row, legacy and pinned', () => {
    const counted = new Map<number, { co2e_tonnes: number; reporting_bucket: string }>(
      engine.summarizeEntries(allRows).entries.map((row: { id: number; co2e_tonnes: number; reporting_bucket: string }) => [row.id, row]),
    );
    for (const row of allRows) {
      const shown = entries.presentEntry(row);
      const total = counted.get(row.id);
      if (!total) {
        expect(shown.co2e_kg, `row ${row.id}`).toBeNull();
        expect(shown.calculation_error, `row ${row.id}`).toBeTruthy();
        continue;
      }
      expect(shown.co2e_kg, `row ${row.id}`).toBeCloseTo(total.co2e_tonnes * 1000, 3);
      expect(shown.reporting_bucket, `row ${row.id}`).toBe(total.reporting_bucket);
    }
  });

  it('a row reported beside the scopes says so, with its memo quantity', () => {
    const [wood, r22, renewable] = pinnedRows.map((row) => entries.presentEntry(row));
    expect(wood).toMatchObject({ reporting_bucket: 'scope1', co2e_kg: 202.23, biogenic_co2_kg: 16400, pricing_catalog: '2026-09-30' });
    expect(r22).toMatchObject({ reporting_bucket: 'memo:non-kyoto', co2e_kg: 17600 });
    expect(renewable).toMatchObject({ reporting_bucket: 'scope2', co2e_kg: 19504, scope2_market_co2e_kg: 0 });
    expect(entries.presentEntry(legacyRows[1])).toMatchObject({ reporting_bucket: 'scope1', co2e_kg: 16400, pricing_catalog: '2026-07-24' });
  });
});

describe('every path prices a row with the catalog it names', () => {
  it('every emission_entries read that selects factor_value also selects catalog_version', () => {
    const sources = [readFileSync(resolve('server.cjs'), 'utf8'), readFileSync(resolve('server-entry-routes.cjs'), 'utf8')];
    const selects = sources.flatMap((text) => [...text.matchAll(/SELECT ([^;`']*?) FROM (?:public\.)?emission_entries/g)].map((m) => m[1] ?? ''));
    const priced = selects.filter((columns) => /factor_value|ENTRY_COLUMNS/.test(columns));
    expect(priced.length).toBeGreaterThanOrEqual(2);
    for (const columns of priced) {
      if (columns.includes('ENTRY_COLUMNS')) continue;
      expect(columns, columns).toMatch(/catalog_version/);
    }
    expect(entries.ENTRY_COLUMNS).toMatch(/catalog_version/);
  });

  it('a calculator preview is priced by the current catalog, not read as a legacy row', () => {
    const server = readFileSync(resolve('server.cjs'), 'utf8');
    const route = server.slice(server.indexOf("app.post('/api/calculate'"), server.indexOf('const SUMMARY_PERIOD_PATTERN'));
    expect(route).toMatch(/catalog_version: CATALOG_VERSION/);
  });

  it('a new entry is pinned to the current catalog and priced by it', () => {
    const row = newRow({ scope: 'Scope 1', category: 'stationary_combustion', source: 'fuel_oil_4', amount: 1000, unit: 'gallons' }, 1);
    expect(row).toMatchObject({ catalog_version: CATALOG_VERSION, factor_value: 10.9962, co2e_kg: 10996.2 });
  });

  it('editing only the date or notes of a row stored without a pin keeps its legacy price and pins it there', () => {
    const csvRow = legacyRows.find((r: { id: number }) => r.id === 8); // fuel oil No. 4, 10.69 kg/gal in the frozen catalog
    const edited = entries.validateEntryEdit(csvRow, { scope: 'Scope 1', category: 'stationary_combustion', source: 'fuel_oil_4', amount: 1000, unit: 'gallons', activity_date: '2026-02-20', notes: 'invoice 7' }, NOW);
    expect(edited.ok).toBe(true);
    expect(edited.row).toMatchObject({ factor_value: 10.69, co2e_kg: 10690, catalog_version: LEGACY_CATALOG_VERSION, confidence: 90, notes: 'invoice 7' });
  });

  it('a stored row whose source the current catalog retired can still have its date edited', () => {
    const coal = legacyRows.find((r: { id: number }) => r.id === 6);
    const edited = entries.validateEntryEdit(coal, { scope: 'Scope 1', category: 'stationary_combustion', source: 'coal', amount: 100, unit: 'short tons', activity_date: '2026-01-25' }, NOW);
    expect(edited.ok).toBe(true);
    expect(edited.row).toMatchObject({ factor_value: 2070, co2e_kg: 207000, catalog_version: LEGACY_CATALOG_VERSION });
  });

  it('changing the activity is a new calculation at the current catalog', () => {
    const csvRow = legacyRows.find((r: { id: number }) => r.id === 8);
    const edited = entries.validateEntryEdit(csvRow, { scope: 'Scope 1', category: 'stationary_combustion', source: 'fuel_oil_4', amount: 2000, unit: 'gallons', activity_date: '2026-02-11' }, NOW);
    expect(edited.row).toMatchObject({ factor_value: 10.9962, co2e_kg: 21992.4, catalog_version: CATALOG_VERSION });
  });
});
