import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  calculateEntry,
  summarizeEntries,
  buildTrend,
  parseEmissionCsv,
  getComplianceStatus,
  buildFacilityEmissions,
  normalizeScope,
} = require('../emissions-engine.cjs');

describe('normalizeScope', () => {
  it('treats every separator the same so a label cannot mean two things', () => {
    // The server's Scope 3 paywall gates on this; a separate copy that did not
    // strip '/' let "Scope/3" through the gate and into the engine as scope3.
    expect(normalizeScope('Scope/3')).toBe('scope3');
    expect(normalizeScope('scope 3')).toBe('scope3');
    expect(normalizeScope('SCOPE-3')).toBe('scope3');
    expect(normalizeScope('3')).toBe('scope3');
    expect(() => normalizeScope('scope 4')).toThrow(/Invalid scope/);
  });
});

describe('EPA emissions engine', () => {
  it('calculates 50,000 therms of natural gas as 265.3 tCO2e', () => {
    const result = calculateEntry({
      scope: '1',
      category: 'stationary_combustion',
      source: 'natural_gas',
      amount: 50000,
      unit: 'therms',
    });

    expect(result.co2e_tonnes).toBeCloseTo(265.3, 3);
    expect(result.scope).toBe('scope1');
    expect(result.confidence).toBeGreaterThanOrEqual(85);
  });

  // Regression: natural_gas.gj was 50.68 — a kg-scale value in a tonnes table,
  // inflating every GJ row ~1000x. The three natural-gas units must agree once
  // converted to a common energy basis.
  it('keeps natural gas units mutually consistent (gj is tonnes, not kg)', () => {
    // 1 MMBtu = 10 therms = 1.055056 GJ, so equal energy must give equal CO2e.
    const viaTherms = calculateEntry({
      scope: '1',
      category: 'stationary_combustion',
      source: 'natural_gas',
      amount: 10, // 1 MMBtu
      unit: 'therms',
    });
    const viaGj = calculateEntry({
      scope: '1',
      category: 'stationary_combustion',
      source: 'natural_gas',
      amount: 1.055056, // 1 MMBtu
      unit: 'gj',
    });

    expect(viaGj.co2e_tonnes).toBeCloseTo(viaTherms.co2e_tonnes, 5);
    // Absolute sanity bound: 1 MMBtu of natural gas is ~53 kg CO2e, never ~53 t.
    expect(viaGj.co2e_tonnes).toBeLessThan(0.1);
  });

  it('prices Scope 2 at the published eGRID rate with no T&D gross-up', () => {
    const result = calculateEntry({
      scope: '2',
      category: 'purchased_electricity',
      source: 'CAMX',
      amount: 250,
      unit: 'MWh',
    });

    expect(result.co2e_tonnes).toBeCloseTo(48.76, 6);
  });

  // Regression: an unrecognised subregion used to fall back to CAMX silently,
  // pricing a coal-heavy grid at California's rate. It must fail the row.
  it('rejects an unknown eGRID subregion instead of defaulting to CAMX', () => {
    expect(() =>
      calculateEntry({
        scope: '2',
        category: 'purchased_electricity',
        source: 'NOT_A_SUBREGION',
        amount: 100,
        unit: 'MWh',
      }),
    ).toThrow(/Unsupported eGRID subregion/);
  });

  // eGRID2023 Rev 2 published values, so a drifting table is caught.
  it('uses published eGRID2023 rates for the highest and lowest subregions', () => {
    const nyup = calculateEntry({
      scope: '2', category: 'purchased_electricity', source: 'NYUP', amount: 1, unit: 'MWh',
    });
    const srmw = calculateEntry({
      scope: '2', category: 'purchased_electricity', source: 'SRMW', amount: 1, unit: 'MWh',
    });

    // Published t/MWh, applied directly: T&D losses are Scope 3 Cat 3, not Scope 2.
    expect(nyup.co2e_tonnes).toBeCloseTo(0.11013, 6);
    expect(srmw.co2e_tonnes).toBeCloseTo(0.56636, 6);
    // A coal-heavy grid must never price below a hydro/nuclear-heavy one.
    expect(srmw.co2e_tonnes).toBeGreaterThan(nyup.co2e_tonnes * 4);
  });

  // Regression: entries persisted by the in-app calculator arrive already in
  // kg CO2e (amount = calculatedKg, unit = 'kg CO2e'). The engine must NOT
  // re-apply an activity factor — it must pass them through as tonnes. See C3.
  it('passes pre-calculated kg CO2e entries through without re-applying factors', () => {
    const result = calculateEntry({
      scope: 'Scope 1',
      category: 'Stationary Combustion',
      source: 'Natural Gas',
      amount: 265100, // kg CO2e already computed by the calculator
      unit: 'kg CO2e',
      confidence: 85,
    });
    expect(result.co2e_tonnes).toBeCloseTo(265.1, 6);
    expect(result.factor).toBe(0.001);
    expect(result.confidence).toBe(85);
  });

  it('does not throw or inflate Scope 2 kg CO2e passthrough entries', () => {
    // Previously this Scope 2 row was re-multiplied by an eGRID factor (~217x).
    const result = calculateEntry({
      scope: 'Scope 2',
      category: 'Purchased Electricity',
      source: 'Grid Electricity',
      amount: 417,
      unit: 'kg CO2e',
    });
    expect(result.co2e_tonnes).toBeCloseTo(0.417, 6);
  });

  it('summarizes entries by scope and category with average confidence', () => {
    const summary = summarizeEntries([
      { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 50000, unit: 'therms' },
      { scope: '2', category: 'purchased_electricity', source: 'CAMX', amount: 250, unit: 'MWh' },
      { scope: '3', category: 'purchased_goods', source: 'purchased_goods', amount: 500000, unit: 'USD' },
    ], { companyId: 'company-1', period: '2026' });

    expect(summary.company_id).toBe('company-1');
    expect(summary.period).toBe('2026');
    expect(summary.by_scope.scope1).toBeCloseTo(265.3, 3);
    expect(summary.by_scope.scope2).toBeCloseTo(48.76, 6);
    expect(summary.by_scope.scope3).toBeCloseTo(125, 3);
    expect(summary.total_emissions_tCO2e).toBeCloseTo(439.06, 6);
    expect(summary.confidence_score).toBeGreaterThan(70);
  });

  it('parses CSV rows into emission entries', () => {
    const rows = parseEmissionCsv([
      'scope,category,source,amount,unit,method,confidence',
      '1,stationary_combustion,natural_gas,50000,therms,calculation,85',
      '2,purchased_electricity,CAMX,250,MWh,calculation,90',
    ].join('\n'));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ scope: '1', source: 'natural_gas', amount: 50000 });
    expect(rows[1]).toMatchObject({ scope: '2', source: 'CAMX', amount: 250 });
  });

  it('returns SB 253 and CSRD compliance status', () => {
    const status = getComplianceStatus({ revenue: 1_200_000_000, region: 'CA', employees: 600 });

    expect(status.frameworks.sb253.applicable).toBe(true);
    expect(status.frameworks.sb253.next_deadline).toContain('2026');
    expect(status.frameworks.csrd.applicable).toBe(false);
  });

  it('breaks emissions down by facility', () => {
    const facilities = [
      { id: 'hq', name: 'Sacramento HQ', type: 'office', city: 'Sacramento' },
      { id: 'plant', name: 'Fresno Plant', type: 'factory', city: 'Fresno' },
    ];
    const rows = [
      { facility_id: 'hq', scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' },
      { facility_id: 'plant', scope: '2', category: 'purchased_electricity', source: 'CAMX', amount: 100, unit: 'MWh' },
    ];

    const result = buildFacilityEmissions(facilities, rows);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'hq', scope1_tCO2e: 5.306 });
    expect(result[1].scope2_tCO2e).toBeCloseTo(19.504, 5);
  });
});

describe('H21: per-row fault isolation in summarizeEntries', () => {
  it("skips an unsupported entry instead of 500-ing the whole company", () => {
    const entries = [
      { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' },
      { scope: '1', category: 'stationary_combustion', source: 'fuel_oil', amount: 10, unit: 'gallons' }, // unsupported source/unit
      { scope: '2', category: 'purchased_electricity', source: 'CAMX', amount: 100, unit: 'MWh' },
    ];

    const summary = summarizeEntries(entries, { companyId: "c1" });

    // Good rows are still summed; the bad row is reported, not thrown.
    expect(summary.total_emissions_tCO2e).toBeGreaterThan(0);
    expect(summary.entries).toHaveLength(2);
    expect(summary.errors).toBeDefined();
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].error).toMatch(/Unsupported Scope 1/);
  });

  it("returns a clean summary with no errors when every row is valid", () => {
    const entries = [
      { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' },
    ];
    const summary = summarizeEntries(entries);
    expect(summary.errors).toBeUndefined();
    expect(summary.entries).toHaveLength(1);
  });
});

describe('H5: buildTrend covers 12 months and filters by year', () => {
  const entries = [
    { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms', created_at: '2026-01-15T00:00:00.000Z' },
    { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 2000, unit: 'therms', created_at: '2026-10-15T00:00:00.000Z' },
    { scope: '2', category: 'purchased_electricity', source: 'CAMX', amount: 100, unit: 'MWh', created_at: '2026-12-20T00:00:00.000Z' },
    { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 5000, unit: 'therms', created_at: '2025-10-15T00:00:00.000Z' }, // prior year, must be excluded
  ];

  it("returns 12 monthly buckets for the selected year", () => {
    const monthly = buildTrend(entries, { period: 'monthly', year: 2026 });
    expect(monthly).toHaveLength(12);
    expect(monthly[0].month).toBe('Jan');
    expect(monthly[11].month).toBe('Dec');
    // Q4 months now exist (previously only Jan-Sep).
    expect(monthly[9].scope1).toBeGreaterThan(0); // Oct
    expect(monthly[11].scope2).toBeGreaterThan(0); // Dec
  });

  it("does not aggregate entries from other years into the selected year", () => {
    const monthly = buildTrend(entries, { period: 'monthly', year: 2026 });
    const total2026 = monthly.reduce((sum, m) => sum + m.scope1 + m.scope2 + m.scope3, 0);
    const monthly2025 = buildTrend(entries, { period: 'monthly', year: 2025 });
    // The 2025 Oct entry (5000 therms) must show in 2025, not 2026.
    // The old assertion here -- monthly[9] < monthly2025[9] + monthly[9] --
    // is a tautology whenever monthly2025[9] > 0, so it could never fail and
    // tested nothing. Pin the actual values instead:
    //   2026 Oct = 2000 therms x 5.306 kg = 10.612 t
    //   2025 Oct = 5000 therms x 5.306 kg = 26.53 t
    expect(monthly2025[9].scope1).toBeCloseTo(26.53, 3);
    expect(monthly[9].scope1).toBeCloseTo(10.612, 3);
    expect(total2026).toBeGreaterThan(0);
  });

  it("returns 4 quarterly buckets including Q4", () => {
    const quarterly = buildTrend(entries, { period: 'quarterly', year: 2026 });
    expect(quarterly).toHaveLength(4);
    expect(quarterly.map((q) => q.quarter)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(quarterly[3].scope1).toBeGreaterThan(0); // Q4 contains Oct
  });
});

// REL-002: Number(null), Number(''), and Number('   ') are all 0, so a
// missing/blank amount used to silently compute a 0 tCO2e row. It must be a
// row-level error; an explicit 0 stays valid.
describe('REL-002: null/blank amount is a row error, not a silent zero', () => {
  const row = (amount: unknown) => ({
    scope: '1',
    category: 'stationary_combustion',
    source: 'natural_gas',
    amount,
    unit: 'therms',
  });

  it.each([null, undefined, '', '   '])('rejects amount %j instead of computing 0 tCO2e', (amount) => {
    expect(() => calculateEntry(row(amount))).toThrow(/Amount is required/);
  });

  it('keeps an explicit 0 as valid data', () => {
    const result = calculateEntry(row(0));
    expect(result.co2e_tonnes).toBe(0);
  });

  it('keeps negative-amount handling unchanged', () => {
    expect(() => calculateEntry(row(-5))).toThrow(/non-negative/);
  });

  it('rejects a blank CSV amount cell instead of importing 0', () => {
    expect(() =>
      parseEmissionCsv('scope,category,source,amount,unit\n1,stationary_combustion,natural_gas,,therms\n'),
    ).toThrow(/CSV row 2 has an invalid amount/);
  });

  it('surfaces the rejected row through summarizeEntries fault isolation', () => {
    const summary = summarizeEntries([
      row(''),
      { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' },
    ]);
    expect(summary.entries).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].error).toMatch(/Amount is required/);
  });
});

// REL-001: factors self-flagged verified:false must not reach inventories
// looking identical to citation-tracked ones — the computed row carries
// provenance so reports can disclose them.
describe('REL-001: provisional factor provenance on computed rows', () => {
  it('flags rows priced with a verified:false catalog factor', () => {
    // fuel_oil_4 is one of the 38 sources self-flagged verified:false in
    // emission-factors.json.
    const result = calculateEntry({ scope: '1', category: 'stationary_combustion', source: 'fuel_oil_4', amount: 100, unit: 'gallons' });
    expect(result.provenance).toEqual({ verified: false });
    expect(result.co2e_tonnes).toBeCloseTo(1.069, 6);
  });

  it('flags a Scope 3 vendor row priced by the spend-based fallback', () => {
    const result = calculateEntry({ scope: '3', category: 'purchased_goods', source: 'acme_supplies_inc', amount: 1000, unit: 'USD' });
    expect(result.provenance).toEqual({ verified: false });
    expect(result.co2e_tonnes).toBeCloseTo(0.25, 6);
  });

  it('leaves citation-tracked rows unflagged', () => {
    const result = calculateEntry({ scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' });
    expect(result.provenance).toBeUndefined();
    expect(result.co2e_tonnes).toBeCloseTo(5.306, 3);
  });

  it('leaves pre-calculated kg CO2e passthrough rows unflagged', () => {
    const result = calculateEntry({ scope: '2', category: 'purchased_electricity', source: 'Grid Electricity', amount: 417, unit: 'kg CO2e' });
    expect(result.provenance).toBeUndefined();
    expect(result.co2e_tonnes).toBeCloseTo(0.417, 6);
  });
});
