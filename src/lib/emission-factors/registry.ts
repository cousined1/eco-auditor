// P0-04 — emission-factor version registry. Single source of truth for the
// factor labels and provenance shown on the methodology page and sample data.
// verified:true entries are publicly published sources wired into the
// calculator (utils.ts consumes EPA/eGRID/IPCC). verified:false entries are
// roadmap items not yet wired into the calculator. factorLabel() returns
// "(verify before publication)" for any missing or unverified id so callers
// can never accidentally render a fabricated factor name.
export type EmissionFactorVersion = {
  id: string;
  label: string;
  publisher: 'US EPA' | 'Smart Freight Centre' | 'Exiobase Consortium' | 'IPCC' | 'EcoAuditor internal';
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
    // ponytail: roadmap only — NOT wired into the calculator (utils.ts uses EPA
    // factors). v3.0 published Sep 2023; latest is v3.2 (Oct 2025). verified:false
    // so factorLabel() renders the '(verify before publication)' sentinel.
    verified: false,
    note: 'Roadmap — not wired into the calculator. v3.0 published Sep 2023; latest is v3.2 (Oct 2025).',
  },
  {
    id: 'exiobase-3.8',
    label: 'EXIOBASE 3.8',
    publisher: 'Exiobase Consortium',
    publishedYear: 2020,
    dataYear: 2020,
    scopes: ['Scope 3'],
    // ponytail: roadmap only — NOT wired into the calculator. v3.8 published
    // Nov 2020 (prior publishedYear 2023 / dataYear 2022 was fabricated); latest
    // is v3.9.6 (Jun 2025). verified:false renders the sentinel.
    verified: false,
    note: 'Roadmap — not wired into the calculator. Published Nov 2020; latest is v3.9.6 (Jun 2025). Data year unverified.',
  },
  {
    // ponytail: was 'ipcc-ar6-gwp100' / verified:true while the coded GWPs were
    // verbatim AR4 values. Standardised on AR5 rather than AR6 because the two
    // datasets this product actually depends on — EPA GHG Emission Factors Hub
    // 2025 and eGRID2023 — both use AR5 GWPs, so an AR5 basis keeps the whole
    // inventory internally consistent. Changing basis means changing the coded
    // GWPs in utils.ts AND every public label together.
    id: 'ipcc-ar5-gwp100',
    label: 'IPCC AR5 GWP-100',
    publisher: 'IPCC',
    publishedYear: 2014,
    dataYear: 2014,
    scopes: ['Scope 1'],
    verified: true,
  },
  {
    // Catalog Scope 3 (and a few process) rows cite this id. It is a
    // placeholder, not a published dataset, so it stays verified:false.
    id: 'internal-estimate',
    label: 'Provisional internal estimate',
    publisher: 'EcoAuditor internal',
    publishedYear: 2026,
    dataYear: 2026,
    scopes: ['Scope 1', 'Scope 3'],
    verified: false,
    note: 'Placeholder used where a published dataset is not wired in. Not a published source.',
  },
  {
    // Internal proxy, not a published dataset. The sample report cited this id
    // without it ever appearing here, which broke the catalog's own rule that
    // every factorSource resolves to a registry id — consumers got
    // '(verify before publication)' for a legitimate row. Registered
    // deliberately as verified:false so factorLabel() keeps rendering the
    // sentinel and nobody can present it as a sourced figure.
    id: 'survey-proxy-2026',
    label: 'Employee commute proxy (internal estimate)',
    publisher: 'EcoAuditor internal',
    publishedYear: 2026,
    dataYear: 2026,
    scopes: ['Scope 3'],
    verified: false,
    note: 'Internal proxy from the employee commute survey. Not a published dataset — treat as a placeholder until a sourced method replaces it.',
  },
];

export function factorLabel(id: string): string {
  const v = EMISSION_FACTOR_REGISTRY.find((e) => e.id === id);
  if (!v) return '(verify before publication)';
  return v.verified ? v.label : `${v.label} (verify before publication)`;
}