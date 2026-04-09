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
    { source: 'Natural gas — Sacramento', value: 612, factor: 'EPA eGRID 2024', confidence: 94 },
    { source: 'Refrigerant leaks — R-404A', value: 478, factor: 'IPCC AR6 GWP', confidence: 71 },
    { source: 'Fleet diesel — 14 vehicles', value: 398, factor: 'EPA GHG Factor Hub', confidence: 88 },
    { source: 'Natural gas — Fresno', value: 289, factor: 'EPA eGRID 2024', confidence: 91 },
    { source: 'Propane — forklifts', value: 57, factor: 'EPA GHG Factor Hub', confidence: 95 },
  ]},
  scope2: { value: 1453, label: 'Scope 2 — Electricity', pct: 29.8, trend: +1.4, items: [
    { source: 'Electricity — Sacramento (PG&E)', value: 634, factor: 'eGRID WECC 2024', confidence: 96 },
    { source: 'Electricity — Fresno (SCE)', value: 489, factor: 'eGRID WECC 2024', confidence: 93 },
    { source: 'Electricity — Portland (PGE)', value: 330, factor: 'eGRID NWPP 2024', confidence: 97 },
  ]},
  scope3: { value: 1585, label: 'Scope 3 — Value Chain', pct: 32.5, trend: +8.1, items: [
    { source: 'Upstream freight (truck)', value: 412, factor: 'GLEC Framework v3', confidence: 72 },
    { source: 'Purchased packaging', value: 347, factor: 'EPA WARM / EEIO', confidence: 58 },
    { source: 'Ingredient sourcing (est.)', value: 298, factor: 'EXIOBASE 3.8', confidence: 44 },
    { source: 'Downstream freight (EU)', value: 231, factor: 'GLEC Framework v3', confidence: 65 },
    { source: 'Employee commuting (est.)', value: 189, factor: 'EPA GHG Factor Hub', confidence: 39 },
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

export const UPLOADED_FILES = [
  { id: 1, name: 'PG&E_bill_sacramento_Q1.pdf', type: 'utility', status: 'extracted' as const, date: '2026-03-28', fields: 12, confidence: 96 },
  { id: 2, name: 'SCE_bill_fresno_Q1.pdf', type: 'utility', status: 'extracted' as const, date: '2026-03-27', fields: 11, confidence: 93 },
  { id: 3, name: 'FedEx_freight_report_Q1.csv', type: 'freight', status: 'review' as const, date: '2026-03-25', fields: 8, confidence: 72 },
  { id: 4, name: 'UPS_shipment_log_Q1.csv', type: 'freight', status: 'review' as const, date: '2026-03-24', fields: 6, confidence: 68 },
  { id: 5, name: 'Supplier_emissions_PackCo.xlsx', type: 'supplier', status: 'extracted' as const, date: '2026-03-22', fields: 15, confidence: 85 },
  { id: 6, name: 'Natural_gas_invoice_Q1.pdf', type: 'utility', status: 'extracted' as const, date: '2026-03-20', fields: 9, confidence: 94 },
  { id: 7, name: 'Fleet_fuel_card_Q1.csv', type: 'fuel', status: 'extracted' as const, date: '2026-03-18', fields: 7, confidence: 88 },
  { id: 8, name: 'Ingredient_list_estimates.xlsx', type: 'supplier', status: 'estimate' as const, date: '2026-03-15', fields: 22, confidence: 44 },
];

export const OCR_PREVIEW = {
  fileName: 'PG&E_bill_sacramento_Q1.pdf',
  extractedFields: [
    { label: 'Account Number', value: 'XXXX-XXXX-4821', confidence: 99 },
    { label: 'Billing Period', value: 'Jan 1 – Mar 31, 2026', confidence: 98 },
    { label: 'Total kWh', value: '184,320', confidence: 97 },
    { label: 'Peak kWh', value: '72,480', confidence: 95 },
    { label: 'Off-Peak kWh', value: '111,840', confidence: 95 },
    { label: 'Demand (kW)', value: '412', confidence: 92 },
    { label: 'Total Amount', value: '$28,147.20', confidence: 98 },
    { label: 'Rate Schedule', value: 'E-19 Medium Commercial', confidence: 94 },
    { label: 'Service Address', value: '4210 Industrial Blvd, Sacramento', confidence: 99 },
    { label: 'Emission Factor Applied', value: '0.212 kgCO2e/kWh (WECC)', confidence: 100 },
    { label: 'Estimated Emissions', value: '39.1 tCO2e', confidence: 96 },
    { label: 'Emissions Method', value: 'Location-based (eGRID 2024)', confidence: 100 },
  ],
};

export const LEDGER_ENTRIES = [
  { id: 'LED-001', date: '2026-03-28', source: 'PG&E_bill_sacramento_Q1.pdf', scope: 'Scope 2', category: 'Electricity', amount: 39.1, unit: 'tCO2e', factor: 'eGRID WECC 2024', method: 'Location-based', extraction: 'OCR', reviewer: 'Sarah Chen', status: 'approved' as const, version: 1, confidence: 96 },
  { id: 'LED-002', date: '2026-03-27', source: 'SCE_bill_fresno_Q1.pdf', scope: 'Scope 2', category: 'Electricity', amount: 28.4, unit: 'tCO2e', factor: 'eGRID WECC 2024', method: 'Location-based', extraction: 'OCR', reviewer: 'Sarah Chen', status: 'approved' as const, version: 1, confidence: 93 },
  { id: 'LED-003', date: '2026-03-25', source: 'FedEx_freight_report_Q1.csv', scope: 'Scope 3', category: 'Upstream Freight', amount: 42.8, unit: 'tCO2e', factor: 'GLEC Framework v3', method: 'Distance-based (est.)', extraction: 'CSV Import', reviewer: 'Unassigned', status: 'pending-review' as const, version: 1, confidence: 72 },
  { id: 'LED-004', date: '2026-03-24', source: 'UPS_shipment_log_Q1.csv', scope: 'Scope 3', category: 'Upstream Freight', amount: 31.2, unit: 'tCO2e', factor: 'GLEC Framework v3', method: 'Shipment-based (est.)', extraction: 'CSV Import', reviewer: 'Unassigned', status: 'pending-review' as const, version: 1, confidence: 68 },
  { id: 'LED-005', date: '2026-03-20', source: 'Natural_gas_invoice_Q1.pdf', scope: 'Scope 1', category: 'Stationary Combustion', amount: 35.6, unit: 'tCO2e', factor: 'EPA GHG Factor Hub 2024', method: 'Fuel-based', extraction: 'OCR', reviewer: 'Sarah Chen', status: 'approved' as const, version: 1, confidence: 94 },
  { id: 'LED-006', date: '2026-03-18', source: 'Fleet_fuel_card_Q1.csv', scope: 'Scope 1', category: 'Mobile Combustion', amount: 24.2, unit: 'tCO2e', factor: 'EPA GHG Factor Hub 2024', method: 'Fuel-based', extraction: 'CSV Import', reviewer: 'Sarah Chen', status: 'approved' as const, version: 2, confidence: 88 },
  { id: 'LED-007', date: '2026-03-15', source: 'Expert estimate — ingredient sourcing', scope: 'Scope 3', category: 'Purchased Goods', amount: 18.3, unit: 'tCO2e', factor: 'EXIOBASE 3.8', method: 'Spend-based (est.)', extraction: 'Manual Entry', reviewer: 'Tom Bradley', status: 'conditional' as const, version: 1, confidence: 44 },
  { id: 'LED-008', date: '2026-03-10', source: 'Refrigerant service log — Fresno', scope: 'Scope 1', category: 'Refrigerant Leakage', amount: 12.7, unit: 'tCO2e', factor: 'IPCC AR6 GWP-100', method: 'Screening (3% leak rate)', extraction: 'Manual Entry', reviewer: 'Tom Bradley', status: 'conditional' as const, version: 1, confidence: 71 },
];

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
  emissionFactorLib: 'EPA GHG Factor Hub 2024',
  reportingYear: 2026,
  baseYear: 2024,
  materialityThreshold: '5%',
  regions: ['US-CA', 'US-OR', 'EU'],
  scope3Categories: [1, 2, 4, 6, 7, 9],
};

export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthly: 149,
    annual: 1490,
    badge: 'Best for first compliance workflow',
    trial: true,
    features: [
      '1 company',
      '1 facility',
      'Baseline Scope 1 & 2 tracking',
      'Limited document uploads (10/month)',
      '1 reporting template',
      'Email support',
    ],
    locked: ['Scope 3 workflows', 'AI Carbon Assistant', 'Supplier request hub', 'Integrations', 'Audit trail exports'],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthly: 399,
    annual: 3990,
    badge: 'Most popular',
    popular: true,
    trial: true,
    features: [
      'Up to 5 facilities',
      'Scope 1, 2, & key Scope 3 workflows',
      'QuickBooks & Xero integrations',
      'AI Carbon Assistant',
      'Supplier request hub',
      'Audit trail & report exports',
      'Priority support',
    ],
    locked: ['Multi-entity', 'Custom reporting', 'Team permissions', 'API access'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 999,
    annual: 9990,
    badge: 'Best for multi-facility teams',
    trial: false,
    features: [
      'Multi-entity & advanced workflows',
      'Advanced audit ledger',
      'Approval workflows',
      'Custom reporting templates',
      'Team permissions & roles',
      'Premium support & onboarding',
      'API & advanced integrations',
    ],
    locked: [],
  },
} as const;

export const ADD_ONS = [
  { id: 'extra-facility', name: 'Extra facility', price: 49, unit: '/month' },
  { id: 'extra-suppliers', name: 'Additional supplier requests (25)', price: 29, unit: '/month' },
  { id: 'premium-reports', name: 'Premium report templates (5)', price: 79, unit: '/month' },
  { id: 'implementation', name: 'Guided setup & data mapping', price: 1500, unit: ' one-time' },
];

export const BILLING_SUBSCRIPTION = {
  plan: 'growth' as const,
  billing: 'annual' as const,
  status: 'active' as const,
  currentPeriodEnd: '2027-01-15',
  trialEnd: null as string | null,
  monthlyRate: 332.50,
  annualRate: 3990,
  nextInvoice: '2027-01-15',
  amount: 3990,
};

export const INVOICES = [
  { id: 'INV-2026-001', date: '2026-01-15', amount: '$3,990.00', status: 'paid' as const, plan: 'Growth (Annual)' },
  { id: 'INV-2025-004', date: '2025-12-15', amount: '$399.00', status: 'paid' as const, plan: 'Growth (Monthly)' },
  { id: 'INV-2025-003', date: '2025-11-15', amount: '$399.00', status: 'paid' as const, plan: 'Growth (Monthly)' },
  { id: 'INV-2025-002', date: '2025-10-15', amount: '$399.00', status: 'paid' as const, plan: 'Growth (Monthly)' },
  { id: 'INV-2025-001', date: '2025-09-15', amount: '$149.00', status: 'paid' as const, plan: 'Starter (Monthly)' },
];

export const PAYMENT_METHOD = {
  brand: 'Visa',
  last4: '4242',
  expiry: '12/2028',
};

export const FEATURE_COMPARISON = [
  { feature: 'Companies', starter: '1', growth: '1', pro: 'Unlimited' },
  { feature: 'Facilities', starter: '1', growth: 'Up to 5', pro: 'Unlimited' },
  { feature: 'Scope 1 tracking', starter: '✓', growth: '✓', pro: '✓' },
  { feature: 'Scope 2 tracking', starter: '✓', growth: '✓', pro: '✓' },
  { feature: 'Scope 3 workflows', starter: '—', growth: '✓', pro: '✓' },
  { feature: 'Document uploads', starter: '10/mo', growth: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Reporting templates', starter: '1', growth: 'All standard', pro: 'Custom + standard' },
  { feature: 'AI Carbon Assistant', starter: '—', growth: '✓', pro: '✓' },
  { feature: 'Supplier request hub', starter: '—', growth: '✓', pro: '✓' },
  { feature: 'QuickBooks / Xero', starter: '—', growth: '✓', pro: '✓' },
  { feature: 'UPS / FedEx connectors', starter: '—', growth: '✓', pro: '✓' },
  { feature: 'Audit trail & exports', starter: '—', growth: '✓', pro: '✓ (advanced)' },
  { feature: 'Approval workflows', starter: '—', growth: '—', pro: '✓' },
  { feature: 'Team permissions', starter: '—', growth: '—', pro: '✓' },
  { feature: 'Multi-entity support', starter: '—', growth: '—', pro: '✓' },
  { feature: 'API access', starter: '—', growth: '—', pro: '✓' },
  { feature: 'Custom report templates', starter: '—', growth: '—', pro: '✓' },
  { feature: 'Support', starter: 'Email', growth: 'Priority', pro: 'Premium + onboarding' },
  { feature: 'Free trial', starter: '14 days', growth: '14 days', pro: '—' },
];