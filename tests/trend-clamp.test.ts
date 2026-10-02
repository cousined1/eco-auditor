// F-C-17: the monthly trend endpoint returns Jan-Dec for the year, so months that
// have not happened yet arrived as zeros and were drawn as "no emissions".
import { describe, expect, it } from 'vitest';
import { visibleTrend, type TrendDataPoint } from '../src/lib/trend';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function year(scope1ByMonth: Record<string, number> = {}): TrendDataPoint[] {
  return MONTHS.map((month) => ({ month, scope1: scope1ByMonth[month] ?? 0, scope2: 0, scope3: 0 }));
}

const labels = (points: TrendDataPoint[]) => points.map((point) => point.month);

describe('visibleTrend', () => {
  it('drops the months after the current one when they are empty (the audited September import)', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const shown = visibleTrend(year({ Sep: 35.9602 }), now);

    expect(labels(shown)).toEqual(MONTHS.slice(0, 9));
    expect(shown[8]).toMatchObject({ month: 'Sep', scope1: 35.9602 });
  });

  it('keeps empty months up to and including the current one', () => {
    const shown = visibleTrend(year(), new Date('2026-03-15T00:00:00Z'));
    expect(labels(shown)).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('keeps a later month that carries real data (a future-dated row), and the months between', () => {
    const shown = visibleTrend(year({ Sep: 10, Dec: 4 }), new Date('2026-09-30T12:00:00Z'));
    expect(labels(shown)).toEqual(MONTHS);
  });

  it('never hides data because the client and the server disagree about the year', () => {
    // Client clock already says January while the server still answers for last year.
    const shown = visibleTrend(year({ Jul: 8, Sep: 12 }), new Date('2027-01-01T00:30:00Z'));
    expect(labels(shown)).toEqual(MONTHS.slice(0, 9));
  });

  it('buckets by UTC month, the way the server does', () => {
    // 23:30 on 30 Sep at UTC-8 is already 1 Oct in UTC.
    const shown = visibleTrend(year(), new Date('2026-09-30T23:30:00-08:00'));
    expect(labels(shown)).toEqual(MONTHS.slice(0, 10));
  });

  it('shows the whole year in December', () => {
    expect(visibleTrend(year(), new Date('2026-12-31T12:00:00Z'))).toHaveLength(12);
  });

  it('leaves quarterly and yearly series and empty input untouched', () => {
    const quarters: TrendDataPoint[] = [
      { quarter: 'Q1', scope1: 1, scope2: 0, scope3: 0 },
      { quarter: 'Q2', scope1: 0, scope2: 0, scope3: 0 },
    ];
    expect(visibleTrend(quarters, new Date('2026-01-01T00:00:00Z'))).toBe(quarters);
    expect(visibleTrend([], new Date())).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = year({ Sep: 1 });
    visibleTrend(input, new Date('2026-09-30T12:00:00Z'));
    expect(input).toHaveLength(12);
  });
});
