// Emission factors moved to emission-factors.json, shared with the server
// engine. This file previously carried a second, independent table that
// disagreed with the engine for the same activity, and a calculateEmissions()
// that took no unit — so the form's Unit selector was decorative.
// Re-exports trimmed to what the calculator components actually import.
// Anything else should be imported from @/lib/emission-factors/factors direct.
// `export { x } from '...'` re-exports without binding x locally, so
// entryKgCO2e below needs its own import.
import { calculateEmissions } from '@/lib/emission-factors/factors';
import { factorLabel } from '@/lib/emission-factors/registry';

export {
  calculateEmissions,
  categoriesForScope,
  sourcesForCategory,
  unitsForSource,
  labelForCategory,
  labelForSource,
  type Scope,
} from '@/lib/emission-factors/factors';

export const SCOPES = ['Scope 1', 'Scope 2', 'Scope 3'] as const;

export interface EmissionEntry {
  id: number;
  scope: string;
  category: string;
  source: string;
  amount: string | number;
  unit: string;
  factor: string | null;
  method: string | null;
  confidence: number | null;
  facility_id: number | null;
  /** GET /api/entries: the kg CO2e the dashboard counts for this row (null when it cannot be calculated). */
  co2e_kg?: number | string | null;
  activity_date?: string | null;
  notes?: string | null;
  // Provenance written by the server entry API (K2). Null on rows saved before it.
  activity_amount?: number | null;
  activity_unit?: string | null;
  /** kg CO2e per `unit`, as applied (the same as activity_unit unless a CSV import converted the unit). */
  factor_value?: number | null;
  factor_source?: string | null;
  catalog_version?: string | null;
  /** Set when no factor resolves for the row; it is then not counted in any total. */
  calculation_error?: string;
  /** Where the totals count the row: 'scope1'..'scope3', or a line beside them ('memo:non-kyoto'). */
  reporting_bucket?: string;
  /** The factor catalog version that priced the row. */
  pricing_catalog?: string;
  biogenic_co2_kg?: number;
  scope2_market_co2e_kg?: number;
  created_at: string;
  /** When the entry was last edited (PATCH /api/entries/:id); null or absent = never. */
  updated_at?: string | null;
}

/**
 * Whether the scope totals count this entry. A row the server reports beside
 * the scopes (R-22 and other non-Kyoto gases) is left out of them, as the
 * dashboard leaves it out, so the calculator page and the dashboard agree.
 */
export function countsInScopeTotals(e: Pick<EmissionEntry, 'reporting_bucket'>): boolean {
  return !e.reporting_bucket || e.reporting_bucket.startsWith('scope');
}

export interface Company {
  id: number;
  name: string;
  industry: string;
  [key: string]: unknown;
}

export interface Facility {
  id: number;
  name: string;
  company_id: number;
  [key: string]: unknown;
}

// Shared with the dashboard so a CO2e figure reads the same on every screen.
export { formatCO2e, formatCO2eParts } from '@/lib/format';

/**
 * kg CO2e for a stored entry, whichever write path produced it.
 *
 * GET /api/entries returns `co2e_kg` as the value the server's engine counts
 * for the row, so the list and the dashboard agree; a row it cannot calculate
 * carries `calculation_error` and counts as 0, as it does in every total.
 *
 * Otherwise `emission_entries.amount` is polymorphic. Calculator rows saved
 * before the server entry API store an already-computed value
 * (`amount = calculatedKg, unit = 'kg CO2e'`), while CSV rows and server-entry
 * rows store the RAW activity amount with its activity unit
 * (`amount = 50000, unit = 'therms'`). The client used to read
 * `parseFloat(amount)` blindly, so every imported row was rendered as if its
 * activity amount were kilograms.
 *
 * Mirrors the passthrough rules in emissions-engine.cjs factorForEntry().
 * Returns 0 when the factor lookup misses, matching the previous
 * `parseFloat(...) || 0` behavior for unresolvable rows.
 */
export function entryKgCO2e(
  e: Pick<EmissionEntry, 'amount' | 'unit' | 'category' | 'source'> & { co2e_kg?: number | string | null; calculation_error?: string },
): number {
  if (e.calculation_error) return 0;
  if (e.co2e_kg !== undefined && e.co2e_kg !== null) {
    const directKg = parseFloat(String(e.co2e_kg));
    if (!isNaN(directKg) && directKg >= 0) return directKg;
  }
  const amount = parseFloat(String(e.amount)) || 0;
  const unit = String(e.unit || '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (unit === 'kg_co2e' || unit === 'kgco2e') return amount;
  if (unit === 't_co2e' || unit === 'tco2e' || unit === 'tonnes_co2e' || unit === 'tonne_co2e') {
    return amount * 1000;
  }
  return calculateEmissions(e.category, e.source, amount, e.unit) ?? 0;
}

/**
 * The dataset an entry's factor came from. `internal-estimate` is how the
 * catalog marks Eco-Auditor's own estimates (not a published dataset);
 * registry ids get their registry label; rows saved before provenance was
 * recorded say so rather than guessing from today's catalog.
 */
export function datasetLabel(factorSource: string | null | undefined): string {
  if (!factorSource) return 'Not recorded';
  if (factorSource === 'internal-estimate') return 'Eco-Auditor internal estimate';
  return factorLabel(factorSource);
}
