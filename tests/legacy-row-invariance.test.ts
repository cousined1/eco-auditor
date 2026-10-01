// @vitest-environment node
/**
 * NO SILENT RESTATEMENT (review R2, K7). Summaries recompute every stored row,
 * so a corrected factor or scope rule applied to rows priced before it would
 * change every customer's past totals, signed-off figures included.
 *
 * tests/fixtures/legacy-emission-rows.json holds stored rows of every kind that
 * existed before the 2026-09-30 catalog: CSV imports and older calculator rows
 * (no pin) and K2 entry-API rows pinned to '2026-07-24+9841b57be1f6', across
 * every factor and classification K7 changes (wood, R-22, RENEWABLE, coal,
 * lignite, fuel oils, natural gas vehicle, own-fleet distance, rail, steam and
 * hot water per lb, public transit, the internal estimates) plus rows that
 * never priced. legacy-emission-expected.json is what the engine BEFORE K7
 * computed for them. Every figure must stay identical: per row, per period, on
 * the dashboard, in the trend and per facility. A row that priced before must
 * still price (a catalog change must never orphan a stored row).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const engine = require('../emissions-engine.cjs');
const { CATALOG_VERSION } = require('../emission-factors.cjs');
const { rows } = require('./fixtures/legacy-emission-rows.json');
const expected = require('./fixtures/legacy-emission-expected.json');

type Row = { id: number; activity_date: string | null; created_at: string; catalog_version?: string; factor_value: number | null };
const legacyRows = rows as Row[];
const yearOf = (row: Row) => Number(String(row.activity_date || row.created_at).slice(0, 4));
const summarize = (subset: Row[], period: string) => engine.summarizeEntries(subset, { companyId: 'c1', period });
const pick = (s: { total_emissions_tCO2e: number; by_scope: unknown; by_category: unknown; confidence_score: number; errors?: unknown[] }) => ({
  total_emissions_tCO2e: s.total_emissions_tCO2e,
  by_scope: s.by_scope,
  by_category: s.by_category,
  confidence_score: s.confidence_score,
  excluded: s.errors ? s.errors.length : 0,
});

describe('legacy rows summarise exactly as before the 2026-09-30 catalog', () => {
  it('covers every kind of stored row and was recorded before the change', () => {
    expect(legacyRows.length).toBe(40);
    expect(legacyRows.filter((r) => r.catalog_version).length).toBe(4);
    expect(expected.perRow).toHaveLength(legacyRows.length);
  });

  it('each row: identical CO2e, scope, category, factor, confidence and provisional flag; the same rows excluded', () => {
    for (const [index, row] of legacyRows.entries()) {
      const before = expected.perRow[index];
      if (before.excluded) {
        expect(() => engine.calculateEntry(row), `row ${row.id} priced now but did not before`).toThrow();
        continue;
      }
      const now = engine.calculateEntry(row);
      expect({
        id: row.id,
        co2e_tonnes: now.co2e_tonnes,
        scope: now.scope,
        normalized_category: now.normalized_category,
        factor: now.factor,
        confidence: now.confidence,
        provisional: now.provenance ? now.provenance.verified === false : false,
      }, `row ${row.id}`).toEqual(before);
      // Classified by the frozen catalog: in its scope, no memo line, and a
      // market-based Scope 2 value equal to its (legacy) location-based one.
      expect(now.pricing_catalog, `row ${row.id}`).toBe('2026-07-24');
      expect(now.reporting_bucket, `row ${row.id}`).toBe(now.scope);
      expect(now.biogenic_co2_tonnes, `row ${row.id}`).toBeUndefined();
      if (now.scope === 'scope2') expect(now.scope2_market_tonnes, `row ${row.id}`).toBe(now.co2e_tonnes);
    }
  });

  it('each period: identical totals, scope split, category split and confidence', () => {
    expect(pick(summarize(legacyRows.filter((r) => yearOf(r) === 2026), '2026'))).toEqual(expected.summary2026);
    expect(pick(summarize(legacyRows.filter((r) => yearOf(r) === 2025), '2025'))).toEqual(expected.summary2025);
    expect(pick(summarize(legacyRows, 'all'))).toEqual(expected.summaryAll);
  });

  it('the new lines stay empty for legacy data: no biogenic or non-Kyoto memo, market-based Scope 2 equal to location-based', () => {
    const s = summarize(legacyRows.filter((r) => yearOf(r) === 2026), '2026');
    expect(s.biogenic_co2_t).toBe(0);
    expect(s.non_kyoto_tCO2e).toBe(0);
    expect(s.scope2_market_tCO2e).toBe(s.by_scope.scope2);
  });

  it('the dashboard, the monthly and quarterly trend and the facility split are identical', () => {
    const s2026 = summarize(legacyRows.filter((r) => yearOf(r) === 2026), '2026');
    const s2025 = summarize(legacyRows.filter((r) => yearOf(r) === 2025), '2025');
    expect(engine.toDashboardSummary(s2026, s2025)).toMatchObject(expected.dashboard2026);
    expect(engine.buildTrend(legacyRows, { year: 2026, period: 'monthly' })).toEqual(expected.trend2026);
    expect(engine.buildTrend(legacyRows, { year: 2025, period: 'quarterly' })).toEqual(expected.trend2025Quarterly);
    expect(engine.buildFacilityEmissions([{ id: 1, company_id: 'c1' }, { id: 2, company_id: 'c1' }], legacyRows)).toEqual(expected.facilities);
  });

  it('a wood and an R-22 entry written through K2 before this catalog stay in Scope 1 (their pin names 2026-07-24)', () => {
    for (const id of [29, 30]) {
      const row = legacyRows.find((r) => r.id === id) as Row;
      const priced = engine.calculateEntry(row);
      expect(priced.scope, String(id)).toBe('scope1');
      expect(priced.reporting_bucket, String(id)).toBe('scope1');
    }
  });

  it('negative control: the same rows priced by the current catalog would NOT match, so a restatement cannot pass this file', () => {
    const restated = legacyRows
      .filter((r) => yearOf(r) === 2026)
      .map((r) => (r.catalog_version ? r : { ...r, catalog_version: CATALOG_VERSION }));
    const s = summarize(restated, '2026');
    expect(s.by_scope.scope1).not.toBe(expected.summary2026.by_scope.scope1);
    expect(s.non_kyoto_tCO2e).toBeGreaterThan(0);
    expect(s.biogenic_co2_t).toBeGreaterThan(0);
  });
});
