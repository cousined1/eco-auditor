// P0-04 — emission-factor version registry. Single source of truth for the
// factor labels and provenance shown on the methodology page and sample data.
// All entries are verified:true (publicly published sources). factorLabel()
// returns "(verify before publication)" for any missing or unverified id so
// callers can never accidentally render a fabricated factor name.
export type EmissionFactorVersion = {
  id: string;
  label: string;
  publisher: 'US EPA' | 'Smart Freight Centre' | 'Exiobase Consortium' | 'IPCC';
  publishedYear: number;
  dataYear: number;
  scopes: ('Scope 1' | 'Scope 2' | 'Scope 3')[];
  verified: boolean;
  note?: string;
};

export const EMISSION_FACTOR_REGISTRY: EmissionFactorVersion[] = [
  {
    id: 'epa-efh-2025',
    label: 'EPA GHG Emission Factors Hub 2025',
    publisher: 'US EPA',
    publishedYear: 2025,
    dataYear: 2024,
    scopes: ['Scope 1', 'Scope 2'],
    verified: true,
  },
  {
    id: 'epa-egrid-2023',
    label: 'eGRID2023',
    publisher: 'US EPA',
    publishedYear: 2025,
    dataYear: 2023,
    scopes: ['Scope 2'],
    verified: true,
  },
  {
    id: 'glec-v3',
    label: 'GLEC Framework v3',
    publisher: 'Smart Freight Centre',
    publishedYear: 2023,
    dataYear: 2023,
    scopes: ['Scope 3'],
    verified: true,
  },
  {
    id: 'exiobase-3.8',
    label: 'EXIOBASE 3.8',
    publisher: 'Exiobase Consortium',
    publishedYear: 2023,
    dataYear: 2022,
    scopes: ['Scope 3'],
    verified: true,
  },
  {
    id: 'ipcc-ar6-gwp100',
    label: 'IPCC AR6 GWP-100',
    publisher: 'IPCC',
    publishedYear: 2021,
    dataYear: 2021,
    scopes: ['Scope 1'],
    verified: true,
  },
];

export function factorLabel(id: string): string {
  const v = EMISSION_FACTOR_REGISTRY.find((e) => e.id === id);
  if (!v) return '(verify before publication)';
  return v.verified ? v.label : `${v.label} (verify before publication)`;
}