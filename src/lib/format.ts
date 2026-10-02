// One place decides how a CO2e quantity and a count read in the app. The
// dashboard used to round every card to whole tonnes ("0 tCO2e - 2.2% of total"
// for 255 kg, and cards that did not add up to the total) while the calculator
// showed one decimal, and chart tooltips printed the raw number with no unit.

const ONE_DECIMAL = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface CO2eParts {
  value: string;
  unit: 'tCO2e' | 'kg CO2e' | '';
}

/**
 * A CO2e mass given in kilograms, as a number and a unit: one decimal, tonnes
 * from one tonne up, kilograms below. The unit is chosen from the rounded value
 * so 999.96 kg reads "1.0 tCO2e", never "1,000.0 kg CO2e". Non-finite input
 * renders as a dash rather than "NaN kg".
 */
export function formatCO2eParts(kg: number): CO2eParts {
  if (!Number.isFinite(kg)) return { value: '—', unit: '' };
  if (Math.round(Math.abs(kg) * 10) / 10 >= 1000) {
    return { value: ONE_DECIMAL.format(kg / 1000), unit: 'tCO2e' };
  }
  return { value: ONE_DECIMAL.format(kg), unit: 'kg CO2e' };
}

export function formatCO2e(kg: number): string {
  const { value, unit } = formatCO2eParts(kg);
  return unit ? `${value} ${unit}` : value;
}

/** Same as formatCO2eParts for the server's tonne-denominated figures. */
export function formatTonnesCO2eParts(tonnes: number): CO2eParts {
  return formatCO2eParts(tonnes * 1000);
}

export function formatTonnesCO2e(tonnes: number): string {
  return formatCO2e(tonnes * 1000);
}

/** "1 entry", "3 entries", "0 facilities": the count and the matching noun form. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
