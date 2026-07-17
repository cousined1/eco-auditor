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
} = require('../emissions-engine.cjs');

describe('EPA emissions engine', () => {
  it('calculates 50,000 therms of natural gas as 265.1 tCO2e', () => {
    const result = calculateEntry({
      scope: '1',
      category: 'stationary_combustion',
      source: 'natural_gas',
      amount: 50000,
      unit: 'therms',
    });

    expect(result.co2e_tonnes).toBeCloseTo(265.1, 3);
    expect(result.scope).toBe('scope1');
    expect(result.confidence).toBeGreaterThanOrEqual(85);
  });

  it('applies eGRID Scope 2 transmission loss', () => {
    const result = calculateEntry({
      scope: '2',
      category: 'purchased_electricity',
      source: 'CAMX',
      amount: 250,
      unit: 'MWh',
    });

    expect(result.co2e_tonnes).toBeCloseTo(54.208125, 6);
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
    expect(summary.by_scope.scope1).toBeCloseTo(265.1, 3);
    expect(summary.by_scope.scope2).toBeCloseTo(54.208125, 6);
    expect(summary.by_scope.scope3).toBeCloseTo(125, 3);
    expect(summary.total_emissions_tCO2e).toBeCloseTo(444.308125, 6);
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
    expect(result[0]).toMatchObject({ id: 'hq', scope1_tCO2e: 5.302 });
    expect(result[1].scope2_tCO2e).toBeCloseTo(21.68325, 5);
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
    expect(monthly2025[9].scope1).toBeGreaterThan(0);
    expect(monthly[9].scope1).toBeLessThan(monthly2025[9].scope1 + monthly[9].scope1);
    expect(total2026).toBeGreaterThan(0);
  });

  it("returns 4 quarterly buckets including Q4", () => {
    const quarterly = buildTrend(entries, { period: 'quarterly', year: 2026 });
    expect(quarterly).toHaveLength(4);
    expect(quarterly.map((q) => q.quarter)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(quarterly[3].scope1).toBeGreaterThan(0); // Q4 contains Oct
  });
});
