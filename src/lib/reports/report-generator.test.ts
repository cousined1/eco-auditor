// REL-001 — provisional (verified:false) factors do reach customer inventories,
// so the generated report must disclose them instead of implying every factor
// is citation-tracked. buildReportText is the shared text/PDF report builder;
// calculated entries carry provenance: { verified: false } from the engine.
import { describe, expect, it } from 'vitest';
// The report builder is a runtime CJS module (shared with server.cjs) without
// type declarations, hence the suppression.
// @ts-expect-error -- CJS module without type declarations
import { buildReportText, toCsv } from './report-generator.cjs';

describe('REL-001: provisional factor disclosure in report text', () => {
  const baseSummary = {
    total_emissions_tCO2e: 10,
    by_scope: { scope1: 5, scope2: 3, scope3: 2 },
    confidence_score: 80,
    methodology: 'EPA GHG Protocol + IPCC AR5',
  };

  it('states how many of the applied factors are provisional', () => {
    const summary = {
      ...baseSummary,
      entries: [{ provenance: { verified: false } }, { provenance: { verified: false } }, {}],
    };
    const text = buildReportText(summary, '2026');
    expect(text).toContain(
      '2 of 3 factors applied are provisional (industry-typical values pending citation verification)',
    );
  });

  it('adds no provisional note when every applied factor is citation-tracked', () => {
    const text = buildReportText({ ...baseSummary, entries: [{}, {}] }, '2026');
    expect(text).not.toContain('provisional');
  });

  it('tolerates a summary without entries (sample-report path)', () => {
    const text = buildReportText(baseSummary, '2026');
    expect(text).not.toContain('provisional');
    expect(text).toContain('Methodology: EPA GHG Protocol + IPCC AR5');
  });
});

describe('toCsv formula-injection guard (API-011)', () => {
  it('prefixes cells that would execute as spreadsheet formulas', () => {
    const csv = toCsv(
      [{ a: '=SUM(A1:A2)', b: '@SUM(1)', c: '+2+2', d: '-1+1', e: 'normal' }],
      ['a', 'b', 'c', 'd', 'e'],
    );
    const rows = csv.trim().split('\n');
    expect(rows[1]).toBe("'=SUM(A1:A2),'@SUM(1),'+2+2,'-1+1,normal");
  });
  it('leaves benign cells untouched', () => {
    const csv = toCsv([{ a: 'Widget Corp', b: 1250.5, c: 'A-B' }], ['a', 'b', 'c']);
    const rows = csv.trim().split('\n');
    expect(rows[1]).toBe('Widget Corp,1250.5,A-B');
  });
});
