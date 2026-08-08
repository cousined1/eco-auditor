import { describe, it, expect } from 'vitest';
import { summarizeQuality, type QualityScore } from './quality-summary';

// Mirrors SampleReport.tsx QUALITY_SCORES and sample-report-fixture.json quality[].
const QUALITY_SCORES: QualityScore[] = [
  { label: 'Metered electricity (97%)', score: 34 },
  { label: 'Metered fuel (88–90%)', score: 25 },
  { label: 'Activity-based Scope 3 (72–75%)', score: 24 },
  { label: 'Spend-based Scope 3 (65%)', score: 17 },
];

describe('summarizeQuality (P0-03)', () => {
  it('produces primaryOrBetter=59, industryAverageOrBetter=83, estimated=17, total=100', () => {
    const q = summarizeQuality(QUALITY_SCORES);
    expect(q.primaryOrBetter).toBe(59); // 34 + 25
    expect(q.industryAverageOrBetter).toBe(83); // 59 + 24
    expect(q.estimated).toBe(17); // 100 - 83
    expect(q.total).toBe(100); // 34 + 25 + 24 + 17
  });

  it('is null-safe when the scores array is shorter than expected', () => {
    const q = summarizeQuality([{ label: 'L1', score: 8 }]);
    expect(q.primaryOrBetter).toBe(8);
    expect(q.industryAverageOrBetter).toBe(8);
    expect(q.estimated).toBe(0);
    expect(q.total).toBe(8);
  });

  it('is null-safe on an empty array', () => {
    const q = summarizeQuality([]);
    expect(q).toEqual({ primaryOrBetter: 0, industryAverageOrBetter: 0, estimated: 0, total: 0 });
  });
});