import { describe, it, expect } from 'vitest';
import { summarizeQuality, type QualityScore } from './quality-summary';

// Mirrors SampleReport.tsx QUALITY_SCORES (L1=8, L2=34, L3=41, L4–L5=17).
const QUALITY_SCORES: QualityScore[] = [
  { label: 'Direct Measurement (L1)', score: 8 },
  { label: 'Primary Source Data (L2)', score: 34 },
  { label: 'Industry Average (L3)', score: 41 },
  { label: 'Proxy / Estimated (L4–L5)', score: 17 },
];

describe('summarizeQuality (P0-03)', () => {
  it('produces primaryOrBetter=42, industryAverageOrBetter=83, estimated=17, total=100', () => {
    const q = summarizeQuality(QUALITY_SCORES);
    expect(q.primaryOrBetter).toBe(42); // 8 + 34
    expect(q.industryAverageOrBetter).toBe(83); // 42 + 41
    expect(q.estimated).toBe(17); // 100 - 83
    expect(q.total).toBe(100); // 8 + 34 + 41 + 17
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