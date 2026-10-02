/**
 * F-E-11: the summary API sends null for a scope that had nothing in the prior
 * period. The dashboard computed Math.round(null * 10) / 10 = 0 and showed a
 * green "0% vs prior" for an increase from nothing. trendChip keeps null as
 * null, and the card then shows no chip.
 *
 * F-E-02 / F-E-10 on the dashboard: the lines reported beside the scope totals
 * (market-based Scope 2, biogenic CO2, non-Kyoto gases) and the entries no total
 * could count are shown with their own labels, and only when they apply.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { trendChip } from '../src/lib/trendChip';
import ReportedSeparately from '../src/components/ReportedSeparately';

describe('trend chip transform (F-E-11)', () => {
  it('keeps null (new, not comparable) as null instead of 0', () => {
    expect(trendChip(null)).toBeNull();
    expect(trendChip(undefined)).toBeNull();
    // The old transform, for the record: this is what the dashboard showed.
    expect(Math.round((null as unknown as number) * 10) / 10).toBe(0);
  });

  it('rounds a real change to one decimal, including 0 and decreases', () => {
    expect(trendChip(12.345)).toBe(12.3);
    expect(trendChip(-3.234)).toBe(-3.2);
    expect(trendChip(0)).toBe(0);
    expect(trendChip(Number.NaN)).toBeNull();
  });

  it('is what the dashboard uses for every scope card', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/pages/Dashboard.tsx', 'utf8');
    expect(page.match(/trend: trendChip\(emissions\.trend_vs_prior_period\?\.scope[123]\)/g)).toHaveLength(3);
    expect(page).not.toMatch(/Math\.round\(emissions\.trend_vs_prior_period/);
  });
});

describe('reported separately (F-E-02, F-E-10)', () => {
  it('shows market-based Scope 2, biogenic CO2, non-Kyoto gases and excluded entries with their own labels', () => {
    const html = renderToStaticMarkup(
      <ReportedSeparately
        scope2Location={39.008}
        scope2Market={19.504}
        biogenicCo2={16.4}
        nonKyoto={17.6}
        excluded={{ count: 1, reasons: [{ reason: 'Unsupported Scope 1 source/unit: natural_gas therm', count: 1 }] }}
      />,
    );
    expect(html).toContain('Scope 2, market-based');
    expect(html).toContain('19.5 tCO2e');
    expect(html).toContain('Biogenic CO2');
    expect(html).toContain('16.4 tCO2<');
    expect(html).toContain('not in Scope 1');
    expect(html).toContain('17.6 tCO2e');
    expect(html).toContain('1 entry not counted in any total');
    expect(html).toContain('natural_gas therm');
  });

  it('shows nothing for legacy data: market-based equal to location-based, empty memo lines, nothing excluded', () => {
    const html = renderToStaticMarkup(
      <ReportedSeparately scope2Location={45.7} scope2Market={45.7} biogenicCo2={0} nonKyoto={0} excluded={{ count: 0, reasons: [] }} />,
    );
    expect(html).toBe('');
  });
});
