// Emission factors moved to emission-factors.json, shared with the server
// engine. This file previously carried a second, independent table that
// disagreed with the engine for the same activity, and a calculateEmissions()
// that took no unit — so the form's Unit selector was decorative.
// Re-exports trimmed to what the calculator components actually import.
// Anything else should be imported from @/lib/emission-factors/factors direct.
// `export { x } from '...'` re-exports without binding x locally, so
// entryKgCO2e below needs its own import.
import { calculateEmissions } from '@/lib/emission-factors/factors';

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
  amount: string;
  unit: string;
  factor: string;
  method: string | null;
  confidence: number;
  facility_id: number | null;
  co2e_kg?: number | string | null;
  activity_date?: string | null;
  notes?: string | null;
  created_at: string;
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

export function formatCO2e(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${kg.toFixed(1)} kg`;
}

/**
 * kg CO2e for a stored entry, whichever write path produced it.
 *
 * `emission_entries.amount` is polymorphic. The in-app calculator stores an
 * already-computed value (`amount = calculatedKg, unit = 'kg CO2e'`), while the
 * CSV ingest stores the RAW activity amount with its activity unit
 * (`amount = 50000, unit = 'therms'`). The server engine handles both via a
 * unit-aware passthrough; the client used to read `parseFloat(amount)` blindly,
 * so every imported row was rendered as if its activity amount were kilograms —
 * showing "50.0 t" for a row that is really 265.3 t, and disagreeing with the
 * main dashboard for the same data.
 *
 * Mirrors the passthrough rules in emissions-engine.cjs factorForEntry().
 * Returns 0 when the factor lookup misses, matching the previous
 * `parseFloat(...) || 0` behavior for unresolvable rows.
 */
export function entryKgCO2e(e: Pick<EmissionEntry, 'amount' | 'unit' | 'category' | 'source'> & { co2e_kg?: number | string | null }): number {
  if (e.co2e_kg !== undefined && e.co2e_kg !== null) {
    const directKg = parseFloat(String(e.co2e_kg));
    if (!isNaN(directKg) && directKg >= 0) return directKg;
  }
  const amount = parseFloat(e.amount) || 0;
  const unit = String(e.unit || '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
  if (unit === 'kg_co2e' || unit === 'kgco2e') return amount;
  if (unit === 't_co2e' || unit === 'tco2e' || unit === 'tonnes_co2e' || unit === 'tonne_co2e') {
    return amount * 1000;
  }
  return calculateEmissions(e.category, e.source, amount, e.unit) ?? 0;
}
