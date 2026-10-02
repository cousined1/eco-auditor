// F-A-02 — the single list of product features the marketing site names, each
// with a status. The landing page renders "Live today" and "Coming next" from
// it, and the app's placeholder pages take their name from it, so a feature
// cannot be advertised as live on one surface and gated on another.
//
// tests/claims-honesty.test.ts also checks this list against the `soon` flags
// in the App.tsx sidebar (NAV_ITEMS): a roadmap feature must be marked `soon`
// there, and a live feature must not be.

export type FeatureStatus = 'live' | 'roadmap';

export type Feature = {
  readonly id: 'dashboard' | 'intake' | 'assistant' | 'ledger' | 'reports' | 'suppliers';
  readonly name: string;
  readonly description: string;
  readonly status: FeatureStatus;
  /** Route of the feature in the authenticated app (see NAV_ITEMS in App.tsx). */
  readonly appRoute: string;
};

export const FEATURES: readonly Feature[] = [
  {
    id: 'dashboard',
    name: 'Executive Dashboard',
    description: 'Total emissions, Scope 1/2/3 breakdown and a 12-month trend at a glance.',
    status: 'live',
    appRoute: '/app',
  },
  {
    id: 'intake',
    name: 'Data Intake',
    description: 'Upload CSV activity data. Each row is scored for confidence, and row-level errors are shown after import.',
    status: 'live',
    appRoute: '/app/intake',
  },
  {
    id: 'assistant',
    name: 'AI Carbon Assistant',
    description: 'Ask questions in plain English. Get methodology-backed answers with citations, assumptions, and next actions.',
    status: 'roadmap',
    appRoute: '/app/assistant',
  },
  {
    id: 'ledger',
    name: 'Emissions Ledger',
    description: 'An emissions ledger that shows every entry with its source, emission factor, and confidence score.',
    status: 'roadmap',
    appRoute: '/app/ledger',
  },
  {
    // Live since audit K3 (F-C-05): the page generates, lists, re-downloads and
    // signs off PDF reports. Framework packages (SB 253, CBAM, procurement
    // packets) are not built; the page says templates are on the roadmap.
    id: 'reports',
    name: 'Reports',
    description: 'Generate a PDF emissions report for a calendar year or a date range. Each report is stored as generated, can be downloaded again, and can be signed off.',
    status: 'live',
    appRoute: '/app/reports',
  },
  {
    id: 'suppliers',
    name: 'Supplier Engagement Hub',
    description: 'Track vendor questionnaires, response rates, primary vs estimated data, and follow-up reminders by spend.',
    status: 'roadmap',
    appRoute: '/app/suppliers',
  },
];

export function featureName(id: Feature['id']): string {
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) throw new Error(`Unknown feature: ${id}`);
  return feature.name;
}
