// P0-04 — emission-factor version registry. Single source of truth for the
// factor labels and provenance shown on the methodology page and sample data.
// verified:true entries are publicly published sources wired into the
// calculator (utils.ts consumes EPA/eGRID/IPCC). verified:false entries are
// roadmap items not yet wired into the calculator, or Eco-Auditor's own
// estimates. factorLabel() returns "(verify before publication)" for any
// missing or unverified id so callers can never accidentally render a
// fabricated factor name.
//
// Every factorSource in emission-factors.json and emission-factors.v1.json must
// resolve here (F-E-06: 31 of 82 factors cited 'internal-estimate', which was
// not an id at all). datasetRevision names the exact edition the current
// catalog uses and must equal that catalog's `datasets[id].revision`
// (tests/catalog-version.test.ts).
export type EmissionFactorVersion = {
  id: string;
  label: string;
  publisher: 'US EPA' | 'Smart Freight Centre' | 'Exiobase Consortium' | 'IPCC' | 'UK DESNZ' | 'Eco-Auditor';
  publishedYear: number;
  dataYear: number;
  /** The edition and revision the catalog's factors come from, e.g. 'eGRID2023 Revision 2 (released 2025-06-12)'. */
  datasetRevision?: string;
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
    datasetRevision: 'EPA GHG Emission Factors Hub 2025 (Last Modified 2025-01-15)',
    scopes: ['Scope 1', 'Scope 2', 'Scope 3'],
    verified: true,
  },
  {
    id: 'epa-egrid-2023',
    label: 'eGRID2023',
    publisher: 'US EPA',
    publishedYear: 2025,
    dataYear: 2023,
    datasetRevision: 'eGRID2023 Revision 2 (released 2025-06-12)',
    scopes: ['Scope 2'],
    verified: true,
  },
  // For epa-warm-2023, desnz-2026 and internal-estimate, dataYear is the year of
  // the edition cited: none of them states one data year for the factors used.
  {
    // The waste rows of the EPA Hub (Table 9) come from EPA's WARM model and,
    // unlike the rest of the Hub, use AR4 GWPs: a separate id keeps that visible.
    id: 'epa-warm-2023',
    label: 'EPA WARM waste factors (GHG Emission Factors Hub 2025, Table 9)',
    publisher: 'US EPA',
    publishedYear: 2025,
    dataYear: 2023,
    datasetRevision: 'EPA WARM factors (documentation December 2023) as published in the EPA GHG Emission Factors Hub 2025, Table 9 (AR4 GWPs)',
    scopes: ['Scope 3'],
    verified: true,
  },
  {
    id: 'desnz-2026',
    label: 'UK DESNZ GHG conversion factors 2026',
    publisher: 'UK DESNZ',
    publishedYear: 2026,
    dataYear: 2026,
    datasetRevision: 'UK DESNZ GHG conversion factors 2026, flat file (published 2026-06-11, revised 2026-07-31)',
    scopes: ['Scope 3'],
    verified: true,
    note: 'Hotel stays only (United States, per room-night).',
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
    datasetRevision: 'IPCC AR5 GWP-100 (2013), as tabulated in EPA GHG Emission Factors Hub 2025 Tables 11-12 and GHG Protocol GWP values v2.0 (2024-08-07)',
    scopes: ['Scope 1'],
    verified: true,
  },
  {
    // Not a dataset: the factors Eco-Auditor carries without a published source
    // (spend-based Scope 3, process emissions, purchased-goods mass factors).
    // verified:false, so every surface shows them as provisional.
    id: 'internal-estimate',
    label: 'Eco-Auditor internal estimate',
    publisher: 'Eco-Auditor',
    publishedYear: 2026,
    dataYear: 2026,
    datasetRevision: 'Eco-Auditor internal estimates, carried unchanged from catalog 2026-07-24 (no published source recorded)',
    scopes: ['Scope 1', 'Scope 3'],
    verified: false,
    note: 'Industry-typical values with no published source recorded. Replace each with a published factor before relying on it.',
  },
];

export function factorLabel(id: string): string {
  const v = EMISSION_FACTOR_REGISTRY.find((e) => e.id === id);
  if (!v) return '(verify before publication)';
  return v.verified ? v.label : `${v.label} (verify before publication)`;
}
