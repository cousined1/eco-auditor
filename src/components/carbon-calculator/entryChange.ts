import { entryKgCO2e, labelForSource, type EmissionEntry, type Facility } from './utils';

const AMOUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
// Kilograms whatever the size, to the gram: the stored figure (the server keeps three
// decimals: 6,904.885 kg), not the tonne rounding the list uses.
const KG = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 3 });
const NOT_RECORDED = 'not recorded';

function activityOf(entry: EmissionEntry): { amount: number | null; unit: string | null } {
  return entry.activity_amount != null && entry.activity_unit
    ? { amount: entry.activity_amount, unit: entry.activity_unit }
    : { amount: null, unit: null };
}

function facilityLabel(id: number | null, facilities: readonly Facility[]): string {
  if (id == null) return 'no facility';
  return facilities.find((facility) => facility.id === id)?.name ?? `facility ${id}`;
}

/**
 * What an edit changed, in one sentence, for the confirmation after a save: the
 * activity, the date and the facility when they changed, and always the CO2e the
 * server recomputed ("Updated “Natural Gas”: amount 1,200 → 1,300 therms; CO2e
 * 6,373.74 kg → 6,904.885 kg.").
 */
export function describeEntryChange(before: EmissionEntry, after: EmissionEntry, facilities: readonly Facility[]): string {
  const parts: string[] = [];
  const was = activityOf(before);
  const now = activityOf(after);
  if (was.amount !== now.amount || was.unit !== now.unit) {
    const from = was.amount === null ? NOT_RECORDED : `${AMOUNT.format(was.amount)}${was.unit === now.unit ? '' : ` ${was.unit}`}`;
    const to = now.amount === null ? NOT_RECORDED : `${AMOUNT.format(now.amount)} ${now.unit}`;
    parts.push(`amount ${from} → ${to}`);
  }
  if ((before.activity_date ?? null) !== (after.activity_date ?? null)) {
    parts.push(`activity date ${before.activity_date ?? NOT_RECORDED} → ${after.activity_date ?? NOT_RECORDED}`);
  }
  if ((before.facility_id ?? null) !== (after.facility_id ?? null)) {
    parts.push(`facility ${facilityLabel(before.facility_id, facilities)} → ${facilityLabel(after.facility_id, facilities)}`);
  }
  const kgBefore = entryKgCO2e(before);
  const kgAfter = entryKgCO2e(after);
  parts.push(kgBefore === kgAfter ? `CO2e unchanged at ${KG.format(kgAfter)} kg` : `CO2e ${KG.format(kgBefore)} kg → ${KG.format(kgAfter)} kg`);
  return `Updated “${labelForSource(after.category, after.source)}”: ${parts.join('; ')}.`;
}
