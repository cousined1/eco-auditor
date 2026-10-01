import { factorLabel } from '@/lib/emission-factors/registry';

export const COMPANY = {
  name: 'Northstar Foods',
  industry: 'Food & Beverage',
  revenue: '$47M',
  employees: 312,
  facilities: 3,
  hq: 'Sacramento, CA',
  euCustomers: true,
  templateType: 'food-beverage' as const,
};

export const FACILITIES = [
  { id: 'f1', name: 'Sacramento HQ', type: 'Manufacturing + Office', city: 'Sacramento, CA', scope1Pct: 42, scope2Pct: 38 },
  { id: 'f2', name: 'Fresno Packaging', type: 'Packaging + Cold Storage', city: 'Fresno, CA', scope1Pct: 31, scope2Pct: 44 },
  { id: 'f3', name: 'Portland Distribution', type: 'Warehouse + Shipping', city: 'Portland, OR', scope1Pct: 27, scope2Pct: 18 },
];

export const EMISSIONS_SUMMARY = {
  total: 4872,
  unit: 'tCO2e',
  scope1: { value: 1834, label: 'Scope 1 — Direct', pct: 37.6, trend: -3.2, items: [
    { source: 'Natural gas — Sacramento', value: 612, factor: factorLabel('epa-egrid-2023'), confidence: 94 },
    { source: 'Refrigerant leaks — R-404A', value: 478, factor: factorLabel('ipcc-ar5-gwp100'), confidence: 71 },
    { source: 'Fleet diesel — 14 vehicles', value: 398, factor: factorLabel('epa-efh-2025'), confidence: 88 },
    { source: 'Natural gas — Fresno', value: 289, factor: factorLabel('epa-egrid-2023'), confidence: 91 },
    { source: 'Propane — forklifts', value: 57, factor: factorLabel('epa-efh-2025'), confidence: 95 },
  ]},
  scope2: { value: 1453, label: 'Scope 2 — Electricity', pct: 29.8, trend: +1.4, items: [
    { source: 'Electricity — Sacramento (PG&E)', value: 634, factor: `WECC ${factorLabel('epa-egrid-2023')}`, confidence: 96 },
    { source: 'Electricity — Fresno (SCE)', value: 489, factor: `WECC ${factorLabel('epa-egrid-2023')}`, confidence: 93 },
    { source: 'Electricity — Portland (PGE)', value: 330, factor: `NWPP ${factorLabel('epa-egrid-2023')}`, confidence: 97 },
  ]},
  scope3: { value: 1585, label: 'Scope 3 — Value Chain', pct: 32.5, trend: +8.1, items: [
    { source: 'Upstream freight (truck)', value: 412, factor: 'GLEC Framework v3', confidence: 72 },
    { source: 'Purchased packaging', value: 347, factor: 'EPA WARM / EEIO', confidence: 58 },
    { source: 'Ingredient sourcing (est.)', value: 298, factor: 'EXIOBASE 3.8', confidence: 44 },
    { source: 'Downstream freight (EU)', value: 231, factor: 'GLEC Framework v3', confidence: 65 },
    { source: 'Employee commuting (est.)', value: 189, factor: factorLabel('epa-efh-2025'), confidence: 39 },
    { source: 'Cloud hosting & SaaS', value: 108, factor: 'GHG Protocol ICT', confidence: 82 },
  ]},
};






export const REPORTS = [
  { id: 1, title: 'CBAM Supplier Data Package', type: 'CBAM', status: 'draft' as const, lastUpdated: '2026-03-28', completeness: 68, signoff: 'none' as const },
  { id: 2, title: 'California Climate Readiness Package', type: 'CA Readiness', status: 'not-started' as const, lastUpdated: '—', completeness: 0, signoff: 'none' as const },
  { id: 3, title: 'Annual GHG Inventory Summary 2025', type: 'GHG Inventory', status: 'final' as const, lastUpdated: '2026-02-15', completeness: 100, signoff: 'approved' as const },
  { id: 4, title: 'Customer Procurement Disclosure — RetailCo EU', type: 'Customer', status: 'in-progress' as const, lastUpdated: '2026-03-25', completeness: 82, signoff: 'pending' as const },
  { id: 5, title: 'Customer Procurement Disclosure — Pacific Foods', type: 'Customer', status: 'in-progress' as const, lastUpdated: '2026-03-22', completeness: 55, signoff: 'none' as const },
  { id: 6, title: 'Q1 2026 Emissions Snapshot', type: 'Internal', status: 'draft' as const, lastUpdated: '2026-03-30', completeness: 74, signoff: 'none' as const },
];

export const SUPPLIERS = [
  { id: 1, name: 'PackCo International', category: 'Packaging', spend: '$1.2M', emissions: 347, dataType: 'primary' as const, responseStatus: 'received' as const, lastContact: '2026-03-22', relevance: 'high' },
  { id: 2, name: 'Valley Dairy Co-op', category: 'Ingredients', spend: '$3.8M', emissions: 298, dataType: 'estimate' as const, responseStatus: 'pending' as const, lastContact: '2026-03-10', relevance: 'high' },
  { id: 3, name: 'Pacific Freight Lines', category: 'Freight', spend: '$890K', emissions: 231, dataType: 'primary' as const, responseStatus: 'received' as const, lastContact: '2026-03-25', relevance: 'high' },
  { id: 4, name: 'GreenBox Packaging', category: 'Packaging', spend: '$620K', emissions: 142, dataType: 'estimate' as const, responseStatus: 'overdue' as const, lastContact: '2026-02-14', relevance: 'medium' },
  { id: 5, name: 'Central Valley Flour', category: 'Ingredients', spend: '$2.1M', emissions: 189, dataType: 'estimate' as const, responseStatus: 'pending' as const, lastContact: '2026-03-05', relevance: 'high' },
  { id: 6, name: 'West Coast Logistics', category: 'Freight', spend: '$540K', emissions: 118, dataType: 'primary' as const, responseStatus: 'received' as const, lastContact: '2026-03-20', relevance: 'medium' },
  { id: 7, name: 'Sierra Spice Co.', category: 'Ingredients', spend: '$320K', emissions: 64, dataType: 'none' as const, responseStatus: 'not-sent' as const, lastContact: '—', relevance: 'low' },
  { id: 8, name: 'Nordic cold Storage', category: 'Cold Chain', spend: '$410K', emissions: 96, dataType: 'estimate' as const, responseStatus: 'overdue' as const, lastContact: '2026-02-28', relevance: 'medium' },
];





// AF-1: pricing.ts is the single source of truth for plan pricing. Re-export
// here so existing mockData consumers (Settings, UpgradePrompt) read canonical
// values without a value drift.
export { PLANS } from '@/content/pricing';

// ADD_ONS and FEATURE_COMPARISON moved to src/content/pricing.ts (F-A-10 / F-C-11):
// the comparison table and the plan cards now read one roadmap list. Do not
// re-add pricing tables here.