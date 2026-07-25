// Emission factors moved to emission-factors.json, shared with the server
// engine. This file previously carried a second, independent table that
// disagreed with the engine for the same activity, and a calculateEmissions()
// that took no unit — so the form's Unit selector was decorative.
export {
  calculateEmissions,
  categoriesForScope,
  sourcesForCategory,
  unitsForSource,
  factorFor,
  labelForCategory,
  labelForSource,
  getCategory,
  getSource,
  normalizeKey,
  CATALOG_VERSION,
  GWP_BASIS,
  type Scope,
  type FactorCategory,
  type FactorSource,
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
