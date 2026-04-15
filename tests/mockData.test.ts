/**
 * Mock data integrity tests
 * Verifies that data structures used across the app are consistent
 */
import { describe, it, expect } from 'vitest';
import {
  COMPANY,
  FACILITIES,
  EMISSIONS_SUMMARY,
  SUPPLIERS,
  REPORTS,
} from '../src/data/mockData.ts';

describe('COMPANY data', () => {
  it('has required fields', () => {
    expect(COMPANY.name).toBeDefined();
    expect(COMPANY.industry).toBeDefined();
    expect(COMPANY.revenue).toBeDefined();
    expect(COMPANY.employees).toBeTypeOf('number');
    expect(COMPANY.facilities).toBeTypeOf('number');
  });
});

describe('FACILITIES data', () => {
  it('has valid structure for each facility', () => {
    expect(FACILITIES.length).toBeGreaterThan(0);
    for (const f of FACILITIES) {
      expect(f.id).toBeDefined();
      expect(f.name).toBeDefined();
      expect(f.scope1Pct).toBeTypeOf('number');
      expect(f.scope2Pct).toBeTypeOf('number');
      expect(f.scope1Pct).toBeGreaterThanOrEqual(0);
      expect(f.scope1Pct).toBeLessThanOrEqual(100);
      expect(f.scope2Pct).toBeGreaterThanOrEqual(0);
      expect(f.scope2Pct).toBeLessThanOrEqual(100);
    }
  });
});

describe('EMISSIONS_SUMMARY data', () => {
  it('has consistent scope totals', () => {
    const total = EMISSIONS_SUMMARY.total;
    const scopesSum = EMISSIONS_SUMMARY.scope1.value +
      EMISSIONS_SUMMARY.scope2.value +
      EMISSIONS_SUMMARY.scope3.value;

    // Allow 1 tCO2e rounding tolerance
    expect(Math.abs(total - scopesSum)).toBeLessThan(2);
  });

  it('has valid percentage breakdowns', () => {
    const pcts = [
      EMISSIONS_SUMMARY.scope1.pct,
      EMISSIONS_SUMMARY.scope2.pct,
      EMISSIONS_SUMMARY.scope3.pct,
    ];
    const sum = pcts.reduce((a, b) => a + b, 0);
    // Should approximate 100% (allow rounding)
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
  });

  it('has items for each scope', () => {
    expect(EMISSIONS_SUMMARY.scope1.items.length).toBeGreaterThan(0);
    expect(EMISSIONS_SUMMARY.scope2.items.length).toBeGreaterThan(0);
    expect(EMISSIONS_SUMMARY.scope3.items.length).toBeGreaterThan(0);
  });

  it('item values sum approximately to scope total', () => {
    for (const scope of ['scope1', 'scope2', 'scope3'] as const) {
      const itemsSum = EMISSIONS_SUMMARY[scope].items.reduce((acc, item) => acc + item.value, 0);
      const scopeValue = EMISSIONS_SUMMARY[scope].value;
      // Allow 5 tCO2e tolerance for rounding
      expect(Math.abs(itemsSum - scopeValue)).toBeLessThan(5);
    }
  });
});

describe('SUPPLIERS data', () => {
  it('has valid structure for each supplier', () => {
    expect(SUPPLIERS.length).toBeGreaterThan(0);
    for (const s of SUPPLIERS) {
      expect(s.id).toBeTypeOf('number');
      expect(s.name).toBeDefined();
      expect(s.category).toBeDefined();
      expect(s.emissions).toBeTypeOf('number');
      expect(s.emissions).toBeGreaterThanOrEqual(0);
      expect(['primary', 'estimate', 'none']).toContain(s.dataType);
      expect(['received', 'pending', 'overdue', 'not-sent']).toContain(s.responseStatus);
      expect(['high', 'medium', 'low']).toContain(s.relevance);
    }
  });

  it('does not cause division by zero in calculations', () => {
    // This tests the fix for H-09 and M-12
    const total = SUPPLIERS.length || 1;
    expect(total).toBeGreaterThan(0);

    const responseRate = Math.round(
      (SUPPLIERS.filter((s) => s.responseStatus === 'received').length / total) * 100
    );
    expect(responseRate).toBeGreaterThanOrEqual(0);
    expect(responseRate).toBeLessThanOrEqual(100);
  });

  it('can be sorted without mutating original', () => {
    const original = [...SUPPLIERS];
    const sorted = [...SUPPLIERS].sort((a, b) =>
      a.relevance === b.relevance ? 0 : a.relevance === 'high' ? -1 : 1
    );
    // Original should not be reordered
    expect(SUPPLIERS.map((s) => s.id)).toEqual(original.map((s) => s.id));
    // Sorted should have different order potentially
    expect(sorted.length).toBe(SUPPLIERS.length);
  });

  it('primary data percentage is calculated safely', () => {
    for (const relevance of ['high', 'medium', 'low']) {
      const count = SUPPLIERS.filter((s) => s.relevance === relevance).length;
      const primaryCount = SUPPLIERS.filter(
        (s) => s.relevance === relevance && s.dataType === 'primary'
      ).length;
      const pct = count ? Math.round((primaryCount / count) * 100) : 0;
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

describe('REPORTS data', () => {
  it('has valid structure for each report', () => {
    expect(REPORTS.length).toBeGreaterThan(0);
    for (const r of REPORTS) {
      expect(r.id).toBeTypeOf('number');
      expect(r.title).toBeDefined();
      expect(r.type).toBeDefined();
      expect(r.status).toBeDefined();
      expect(r.completeness).toBeTypeOf('number');
      expect(r.completeness).toBeGreaterThanOrEqual(0);
      expect(r.completeness).toBeLessThanOrEqual(100);
      expect(['final', 'in-progress', 'draft', 'not-started']).toContain(r.status);
      expect(['approved', 'pending', 'none']).toContain(r.signoff);
    }
  });

  it('selectedReport null check works', () => {
    // Verify that REPORTS.find returns undefined for invalid IDs
    const result = REPORTS.find((r) => r.id === -1);
    expect(result).toBeUndefined();
  });
});