export interface TrendDataPoint {
  month?: string;
  quarter?: string;
  year?: string;
  scope1: number;
  scope2: number;
  scope3: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthIndex(point: TrendDataPoint): number {
  return point.month === undefined ? -1 : MONTH_LABELS.indexOf(point.month);
}

function hasData(point: TrendDataPoint): boolean {
  return point.scope1 > 0 || point.scope2 > 0 || point.scope3 > 0;
}

/**
 * The monthly trend endpoint always answers with all twelve months of the year,
 * so the months that have not happened yet arrive as zeros and were drawn as
 * "no emissions". This drops the trailing months that are both in the future
 * and empty: everything up to the current month (UTC, the way the server
 * buckets) stays, and so does any later month that really carries data.
 *
 * Deliberately keyed on "future AND empty" rather than the clock alone, so a
 * client and server that disagree about the year (around New Year) can never
 * hide real data. Quarterly and yearly series are returned as they are.
 */
export function visibleTrend(points: TrendDataPoint[], now: Date = new Date()): TrendDataPoint[] {
  if (points.length === 0 || points.some((point) => monthIndex(point) < 0)) return points;
  let lastVisible = now.getUTCMonth();
  for (const point of points) {
    const index = monthIndex(point);
    if (index > lastVisible && hasData(point)) lastVisible = index;
  }
  return points.filter((point) => monthIndex(point) <= lastVisible);
}
