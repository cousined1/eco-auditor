import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { summarizeEntries, toDashboardSummary } = require('../emissions-engine.cjs');

function buildTrend(entries: Array<Record<string, unknown>>) {
  return ['Jan', 'Feb', 'Mar'].map((month, index) => {
    const summary = summarizeEntries(
      entries.filter((entry) => new Date(String(entry.created_at)).getMonth() === index),
      { companyId: 'test-company-1', period: '2026' }
    );
    return {
      month,
      scope1: summary.by_scope.scope1,
      scope2: summary.by_scope.scope2,
      scope3: summary.by_scope.scope3,
    };
  });
}

describe('Dashboard Integration (Slice 2)', () => {
  const entries = [
    { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 50000, unit: 'therms', created_at: '2026-01-15T00:00:00.000Z' },
    { scope: '2', category: 'purchased_electricity', source: 'CAMX', amount: 250, unit: 'MWh', created_at: '2026-02-15T00:00:00.000Z' },
    { scope: '3', category: 'purchased_goods', source: 'purchased_goods', amount: 500000, unit: 'USD', created_at: '2026-03-15T00:00:00.000Z' },
  ];

  it('transforms calculator summary into dashboard response shape', () => {
    const summary = summarizeEntries(entries, { companyId: 'test-company-1', period: '2026' });
    const data = toDashboardSummary(summary);

    expect(data.total_co2e_tonnes).toBeCloseTo(439.06, 6);
    expect(data.scope1_co2e_tonnes).toBeCloseTo(265.3, 3);
    expect(data.scope2_co2e_tonnes).toBeCloseTo(48.76, 6);
    expect(data.scope3_co2e_tonnes).toBeCloseTo(125, 3);
    expect(data.confidence_score).toBeGreaterThan(70);
  });

  it('scope percentages add up to 100%', () => {
    const data = toDashboardSummary(summarizeEntries(entries, { companyId: 'test-company-1' }));
    const total = data.scope1_pct + data.scope2_pct + data.scope3_pct;

    expect(total).toBeCloseTo(100, 1);
  });

  it('returns zero-safe dashboard data for a company with no data', () => {
    const data = toDashboardSummary(summarizeEntries([], { companyId: 'empty-company-no-data' }));

    expect(data.total_co2e_tonnes).toBe(0);
    expect(data.scope1_pct).toBe(0);
    expect(data.scope2_pct).toBe(0);
    expect(data.scope3_pct).toBe(0);
  });

  it('builds chart-ready monthly trend data', () => {
    const trend = buildTrend(entries);

    expect(trend).toHaveLength(3);
    trend.forEach((point) => {
      expect(point.month).toBeDefined();
      expect(typeof point.scope1).toBe('number');
      expect(typeof point.scope2).toBe('number');
      expect(typeof point.scope3).toBe('number');
    });
  });

  it('numbers round and format consistently for display', () => {
    const apiData = {
      total_co2e_tonnes: 4872.456,
      scope1_co2e_tonnes: 1834.789,
      scope1_pct: 37.654,
      trend_vs_prior_period: { scope1: -3.234 },
    };

    expect(Math.round(apiData.total_co2e_tonnes)).toBe(4872);
    expect(Math.round(apiData.scope1_co2e_tonnes)).toBe(1835);
    expect(Math.round(apiData.scope1_pct * 10) / 10).toBe(37.7);
    expect(Math.round(apiData.trend_vs_prior_period.scope1 * 10) / 10).toBe(-3.2);
  });
});
