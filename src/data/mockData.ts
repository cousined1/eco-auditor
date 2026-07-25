import { PLAN_LIMITS } from '@/content/pricing';
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

export const READINESS_SCORE = {
  overall: 72,
  label: 'Partially Ready',
  dimensions: [
    { name: 'Data Completeness', score: 78, status: 'moderate' as const },
    { name: 'Audit Trail Strength', score: 85, status: 'good' as const },
    { name: 'Primary Data Coverage', score: 61, status: 'needs-work' as const },
    { name: 'Methodology Compliance', score: 82, status: 'good' as const },
    { name: 'Supplier Engagement', score: 54, status: 'needs-work' as const },
  ],
};

export const MISSING_DATA_ALERTS = [
  { id: 1, severity: 'high', message: '3 suppliers missing primary emissions data', scope: 'Scope 3', action: 'Request data' },
  { id: 2, severity: 'medium', message: '12 records need human review', scope: 'Data Intake', action: 'Review queue' },
  { id: 3, severity: 'high', message: 'Scope 3 estimate applied to freight lane EU-West', scope: 'Scope 3', action: 'View estimate' },
  { id: 4, severity: 'info', message: 'Electricity factors updated for CAISO region', scope: 'Scope 2', action: 'View details' },
  { id: 5, severity: 'medium', message: 'Variance detected vs prior quarter: +14%', scope: 'Dashboard', action: 'Investigate' },
  { id: 6, severity: 'low', message: 'Refrigerant leak rate assumes 3% (industry avg)', scope: 'Scope 1', action: 'Update estimate' },
];

export const COMPLIANCE_TASKS = [
  { id: 1, title: 'Prepare CBAM supplier data package', deadline: '2026-06-30', status: 'in-progress' as const, type: 'CBAM' },
  { id: 2, title: 'Annual GHG inventory review', deadline: '2026-09-15', status: 'not-started' as const, type: 'GHG Inventory' },
  { id: 3, title: 'California climate readiness assessment', deadline: '2026-12-31', status: 'not-started' as const, type: 'CA Readiness' },
  { id: 4, title: 'Customer procurement disclosure — RetailCo EU', deadline: '2026-05-15', status: 'in-progress' as const, type: 'Customer' },
  { id: 5, title: 'Q1 2026 emissions lock & sign-off', deadline: '2026-04-30', status: 'overdue' as const, type: 'Internal' },
];

export const TREND_DATA = [
  { month: 'Jul', scope1: 198, scope2: 148, scope3: 132 },
  { month: 'Aug', scope1: 191, scope2: 152, scope3: 135 },
  { month: 'Sep', scope1: 187, scope2: 146, scope3: 141 },
  { month: 'Oct', scope1: 195, scope2: 149, scope3: 148 },
  { month: 'Nov', scope1: 182, scope2: 151, scope3: 155 },
  { month: 'Dec', scope1: 176, scope2: 145, scope3: 160 },
  { month: 'Jan', scope1: 168, scope2: 142, scope3: 158 },
  { month: 'Feb', scope1: 155, scope2: 139, scope3: 165 },
  { month: 'Mar', scope1: 158, scope2: 137, scope3: 170 },
];

export const CFO_METRICS = {
  consultantSpendAvoided: '$84,000',
  contractsAtRisk: 2,
  contractsAtRiskDetail: ['RetailCo EU — missing supplier data', 'Pacific Foods — no CBAM package'],
  recordsDefensible: '87%',
  reportingReadiness: '72%',
  primaryDataCoverage: '61%',
  estimatedExposureIncomplete: '$340K',
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

export const CHAT_MESSAGES = [
  { role: 'assistant' as const, content: 'Welcome to the Eco-Auditor AI Assistant. I can help you with carbon accounting questions based on GHG Protocol methodology. What would you like to know?', timestamp: '2026-03-30T10:00:00' },
  { role: 'user' as const, content: 'How should we classify cloud hosting emissions?', timestamp: '2026-03-30T10:02:00' },
  { role: 'assistant' as const, content: `**Cloud hosting emissions fall under Scope 3, Category 1 — Purchased Goods & Services** (or Category 8 — Upstream Transportation and Distribution if applicable).

Under GHG Protocol guidance:
- If you use cloud infrastructure (AWS, Azure, GCP), the emissions from the provider's data centers are **Scope 3** for your organization
- This applies to IaaS, PaaS, and SaaS services alike
- You should report using either **spend-based** estimates or **vendor-provided data** when available

**For your company (Northstar Foods):**
- Your current estimate of 108 tCO2e uses a spend-based method
- AWS and Google Cloud both publish emission factors — switching to **vendor-specific data** would improve confidence from 82% to ~95%

**Recommended action:** Request emission reports from your cloud providers and update the ledger entries. This is a quick win for data quality.`,
  timestamp: '2026-03-30T10:02:30' },
  { role: 'user' as const, content: 'Why is this fuel purchase categorized as Scope 1?', timestamp: '2026-03-30T10:05:00' },
  { role: 'assistant' as const, content: `**Scope 1 covers direct emissions from owned or controlled sources.**

Under GHG Protocol:
- Fuel burned in company-owned vehicles is **Scope 1 — Mobile Combustion**
- Fuel burned in company boilers/furnaces is **Scope 1 — Stationary Combustion**

Your fleet diesel entry (LED-006, 24.2 tCO2e) is Scope 1 because Northstar Foods owns the 14 vehicles and directly controls the fuel consumption.

**Key distinction:** If a third-party logistics provider burns fuel on your behalf, that's **Scope 3, Category 4** (Upstream Transportation), not Scope 1.

**Check:** Make sure the 14 vehicles in your fleet log are still company-owned. If any were sold or leased in Q1, reclassify accordingly.`,
  timestamp: '2026-03-30T10:05:30' },
];

export const SUGGESTED_PROMPTS = [
  'Can we estimate missing vendor emissions?',
  'What is the CBAM reporting threshold for our EU imports?',
  'How do we handle refrigerant leakage estimates?',
  'What emission factors should we use for California electricity?',
  'Can you explain market-based vs location-based Scope 2?',
];

export const ONBOARDING_CHECKLIST = [
  { id: 1, title: 'Connect finance system', status: 'complete' as const },
  { id: 2, title: 'Upload first utility bill', status: 'complete' as const },
  { id: 3, title: 'Add facilities', status: 'complete' as const },
  { id: 4, title: 'Invite reviewer', status: 'in-progress' as const },
  { id: 5, title: 'Generate baseline inventory', status: 'not-started' as const },
];

export const METHODOLOGY_SETTINGS = {
  boundaryType: 'operational',
  electricityMethod: 'location-based',
  emissionFactorLib: factorLabel('epa-efh-2025'),
  reportingYear: 2026,
  baseYear: 2024,
  materialityThreshold: '5%',
  regions: ['US-CA', 'US-OR', 'EU'],
  scope3Categories: [1, 2, 4, 6, 7, 9],
};

// AF-1: pricing.ts is the single source of truth for plan pricing. Re-export
// here so existing mockData consumers (Settings, UpgradePrompt) read canonical
// values without a value drift.
export { PLANS } from '@/content/pricing';

export const ADD_ONS = [
  { id: 'extra-facility', name: 'Extra facility', price: 49, unit: '/month' },
  { id: 'extra-suppliers', name: 'Additional supplier requests (25)', price: 29, unit: '/month' },
  { id: 'premium-reports', name: 'Premium report templates (5)', price: 79, unit: '/month' },
  { id: 'implementation', name: 'Guided setup & data mapping', price: 1500, unit: ' one-time' },
];

// The four rows the server actually enforces are derived from plan-limits.json
// via pricing.ts, so this table cannot advertise a cap the API does not apply.
const cell = (value: number | null) => (value === null ? 'Unlimited' : String(value));

export const FEATURE_COMPARISON = [
  // Multi-company does not exist yet — every account has exactly one, on every
  // plan. Do not restore "Unlimited" for Pro until it is built and enforced.
  { feature: 'Companies', starter: '1', growth: '1', pro: '1' },
  {
    feature: 'Facilities',
    starter: cell(PLAN_LIMITS.starter.facilities),
    growth: cell(PLAN_LIMITS.growth.facilities),
    pro: cell(PLAN_LIMITS.pro.facilities),
  },
  { feature: 'Scope 1 tracking', starter: '✓', growth: '✓', pro: '✓' },
  { feature: 'Scope 2 tracking', starter: '✓', growth: '✓', pro: '✓' },
  {
    feature: 'Scope 3 workflows',
    starter: PLAN_LIMITS.starter.scope3 ? '✓' : '—',
    growth: PLAN_LIMITS.growth.scope3 ? '✓' : '—',
    pro: PLAN_LIMITS.pro.scope3 ? '✓' : '—',
  },
  {
    feature: 'CSV imports',
    starter: PLAN_LIMITS.starter.csvImportsPerMonth === null ? 'Unlimited' : `${PLAN_LIMITS.starter.csvImportsPerMonth}/mo`,
    growth: PLAN_LIMITS.growth.csvImportsPerMonth === null ? 'Unlimited' : `${PLAN_LIMITS.growth.csvImportsPerMonth}/mo`,
    pro: PLAN_LIMITS.pro.csvImportsPerMonth === null ? 'Unlimited' : `${PLAN_LIMITS.pro.csvImportsPerMonth}/mo`,
  },
  // Exactly one report template exists, for everyone. Tiered templates are
  // roadmap; see the audit's P0-5 note.
  { feature: 'Reporting templates', starter: '1', growth: '1', pro: '1' },
  { feature: 'AI Carbon Assistant', starter: '—', growth: 'Roadmap', pro: 'Roadmap' },
  { feature: 'Supplier request hub', starter: '—', growth: 'Roadmap', pro: 'Roadmap' },
  { feature: 'QuickBooks / Xero', starter: '—', growth: 'Roadmap', pro: 'Roadmap' },
  { feature: 'UPS / FedEx connectors', starter: '—', growth: 'Roadmap', pro: 'Roadmap' },
  { feature: 'Audit trail & exports', starter: '—', growth: 'Roadmap', pro: 'Roadmap' },
  { feature: 'Approval workflows', starter: '—', growth: '—', pro: 'Roadmap' },
  { feature: 'Team permissions', starter: '—', growth: '—', pro: 'Roadmap' },
  { feature: 'Multi-entity support', starter: '—', growth: '—', pro: 'Roadmap' },
  { feature: 'API access', starter: '—', growth: '—', pro: 'Roadmap' },
  { feature: 'Custom report templates', starter: '—', growth: '—', pro: 'Roadmap' },
  { feature: 'Support', starter: 'Email', growth: 'Priority', pro: 'Premium + onboarding' },
  { feature: 'Free trial', starter: '14 days', growth: '14 days', pro: '—' },
];