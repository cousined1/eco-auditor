// P0-03 — SampleReport data-quality summary math. Null-safe so a missing or
// short scores array never produces NaN; absent entries default to 0.
export type QualityScore = { label: string; score: number; color?: string };

export type QualitySummary = {
  primaryOrBetter: number;
  industryAverageOrBetter: number;
  estimated: number;
  total: number;
};

export function summarizeQuality(scores: QualityScore[]): QualitySummary {
  const primaryOrBetter = (scores[0]?.score ?? 0) + (scores[1]?.score ?? 0);
  const industryAverageOrBetter = primaryOrBetter + (scores[2]?.score ?? 0);
  const total = scores.reduce((s, q) => s + (q.score ?? 0), 0);
  const estimated = Math.max(0, total - industryAverageOrBetter);
  return { primaryOrBetter, industryAverageOrBetter, estimated, total };
}