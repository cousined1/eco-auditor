/**
 * The "% vs prior" chip value for one scope, to one decimal place.
 *
 * The summary API sends null for a scope that had nothing in the prior period
 * ("new, not comparable"). The dashboard used to compute
 * Math.round(null * 10) / 10, which is 0, and showed a green "0% vs prior" for
 * an increase from nothing (F-E-11). Null stays null, and the card shows no chip.
 */
export function trendChip(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}
