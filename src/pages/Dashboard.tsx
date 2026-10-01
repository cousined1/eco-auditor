import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, getUpgradeRequired, type UpgradeRequired } from '../lib/api';
import { formatTonnesCO2eParts } from '../lib/format';
import { calendarYearLabel, currentReportingYear } from '../lib/reportingPeriod';
import { RequestTimeoutError, withDeadline } from '../lib/requestTimeout';
import type { TrendDataPoint } from '../lib/trend';
import EmissionsTrendChart from '../components/EmissionsTrendChart';
import DashboardChecklist from '../components/onboarding/FirstRunChecklist';
import { ReportingYearSelect } from '../components/reports/ReportPeriodPicker';
import ReportedSeparately, { type ExcludedRows } from '../components/ReportedSeparately';
import UpgradePrompt from '../components/UpgradePrompt';
import { trendChip } from '../lib/trendChip';

interface EmissionsSummaryData {
  total_co2e_tonnes: number;
  scope1_co2e_tonnes: number;
  scope2_co2e_tonnes: number;
  scope3_co2e_tonnes: number;
  scope1_pct: number;
  scope2_pct: number;
  scope3_pct: number;
  /** null for a scope that had nothing in the prior period: new, not comparable. */
  trend_vs_prior_period?: {
    scope1: number | null;
    scope2: number | null;
    scope3: number | null;
  } | null;
  scope2_market_co2e_tonnes?: number;
  biogenic_co2_tonnes?: number;
  non_kyoto_co2e_tonnes?: number;
  excluded_rows?: ExcludedRows;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type DashboardLoad =
  | { kind: 'upgrade'; upgrade: UpgradeRequired }
  | { kind: 'data'; emissions: EmissionsSummaryData; trend: TrendDataPoint[] };

// Everything the dashboard needs, fetched under one signal. It sets no state, so
// a run that outlives its deadline can never write into a screen that has
// already moved on to an error or a retry.
async function loadDashboard(signal: AbortSignal, year: number): Promise<DashboardLoad> {
  // Fetch emissions summary and trend in parallel. apiFetch refreshes an expired
  // session token (one refresh shared by both requests). Both name the year, the
  // same calendar year a report generated from here covers (F-B-05).
  const [summaryRes, trendRes] = await Promise.all([
    apiFetch(`/api/emissions/summary?period=${year}`, { signal }),
    apiFetch(`/api/emissions/trend?period=monthly&year=${year}`, { signal }),
  ]);

  // Plan gate: an expired trial / free account gets a 402 upgrade_required.
  // Show the upgrade paywall instead of a generic error or empty state.
  const upgradeInfo = (await getUpgradeRequired(summaryRes)) || (await getUpgradeRequired(trendRes));
  if (upgradeInfo) return { kind: 'upgrade', upgrade: upgradeInfo };

  if (!summaryRes.ok) {
    throw new HttpError(summaryRes.status, `Failed to fetch emissions summary: ${summaryRes.statusText}`);
  }
  if (!trendRes.ok) {
    throw new HttpError(trendRes.status, `Failed to fetch trend data: ${trendRes.statusText}`);
  }

  const summaryData = await summaryRes.json();
  const trendData = await trendRes.json();

  if (!summaryData.success) {
    throw new Error(summaryData.error || 'Failed to fetch emissions summary');
  }
  if (!trendData.success) {
    throw new Error(trendData.error || 'Failed to fetch trend data');
  }

  return { kind: 'data', emissions: summaryData.data, trend: trendData.data || [] };
}

// Every state of this page, not only the one with data, needs a page-level
// heading; the data view shows its own visible one.
function StateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="sr-only">Dashboard</h1>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [emissions, setEmissions] = useState<EmissionsSummaryData | null>(null);
  const [trend, setTrend] = useState<TrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<'timeout' | 'failed' | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [upgrade, setUpgrade] = useState<UpgradeRequired | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  // F-B-05: the dashboard showed only the current calendar year, so in 2026 a
  // customer reporting FY2025 could not see it. The default is still the
  // current year, the year every report defaults to.
  const [year, setYear] = useState(currentReportingYear);
  const yearSelect = <ReportingYearSelect id="dashboard-year" year={year} onChange={setYear} />;

  // Fetch real API data on mount and whenever the year changes
  useEffect(() => {
    // Aborted on unmount and on retry, so a superseded request never touches state.
    const controller = new AbortController();

    const fetchData = async () => {
      try {
        setLoading(true);
        setFailure(null);
        setNeedsOnboarding(false);

        // Bounded: a stalled connection used to leave "Loading..." on screen forever.
        const result = await withDeadline((signal) => loadDashboard(signal, year), { signal: controller.signal });
        if (controller.signal.aborted) return;

        if (result.kind === 'upgrade') {
          setUpgrade(result.upgrade);
          return;
        }
        setEmissions(result.emissions);
        setTrend(result.trend);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Dashboard fetch error:', err);
        // If backend rejected because no company exists yet, treat as onboarding
        // state instead of a hard error. Backend auto-provisions on next call.
        // Any other failure (timeout, network error, 5xx, unexpected response) is
        // a real error and gets surfaced with a retry affordance.
        if (err instanceof HttpError && (err.status === 400 || err.status === 403)) {
          setNeedsOnboarding(true);
        } else {
          setFailure(err instanceof RequestTimeoutError ? 'timeout' : 'failed');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchData();
    return () => controller.abort();
  }, [retryToken, year]);

  // Show loading state
  if (loading) {
    return (
      <StateFrame>
        <div className="flex items-center justify-center h-96" role="status">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4" aria-hidden="true"></div>
            <p className="text-surface-600 dark:text-surface-400">Loading your emissions data...</p>
          </div>
        </div>
      </StateFrame>
    );
  }

  // Plan gate: expired trial / no active subscription
  if (upgrade) {
    return (
      <StateFrame>
        <div className="py-12">
          <UpgradePrompt
            fullPage
            feature="Your dashboard is a paid feature"
            requiredPlan={upgrade.requiredPlan}
            reason={upgrade.message || 'An active plan is required to view your emissions dashboard and reports.'}
            trialEnded={upgrade.trialEnded}
            trialEndedAt={upgrade.trialEndedAt}
          />
          {/* Export is not plan-gated (server.cjs /api/account/export), so this stays true. */}
          <p className="mt-4 text-center text-sm text-surface-600 dark:text-surface-400">
            You can still{' '}
            <Link to="/app/settings" className="underline underline-offset-2 text-brand-700 dark:text-brand-300">
              export your data from Settings
            </Link>
            .
          </p>
        </div>
      </StateFrame>
    );
  }

  // Show a real error state (timeout, network failure, 5xx, unexpected response) with a retry affordance
  if (failure) {
    return (
      <StateFrame>
        <div
          role="alert"
          className="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-800"
        >
          <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Unable to Load Dashboard</h2>
          <p className="text-surface-600 dark:text-surface-400 mb-6 max-w-md mx-auto">
            {failure === 'timeout'
              ? 'Loading your emissions data took too long. Check your connection and try again.'
              : 'Something went wrong while loading your emissions data. Please try again.'}
          </p>
          <button
            type="button"
            onClick={() => setRetryToken((t) => t + 1)}
            className="btn-primary inline-flex"
          >
            Try Again
          </button>
        </div>
      </StateFrame>
    );
  }

  // Show onboarding state if we truly have no emissions data
  if (needsOnboarding) {
    return (
      <StateFrame>
        <DashboardChecklist />
        <div className="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-800">
          <div className="text-4xl mb-2" aria-hidden="true">🏢</div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Welcome to Eco-Auditor</h2>
          <p className="text-surface-600 dark:text-surface-400 mb-6 max-w-md mx-auto">
            Your account is ready. Import a CSV of activity data, or add a single entry by hand, to start building your inventory.
          </p>
          {/* CSV import is the primary path the marketing promises, so it leads.
              Both states used to offer manual entry only. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/app/intake" className="btn-primary inline-flex">
              Import a CSV
            </Link>
            <Link to="/app/calculator" className="btn-secondary inline-flex">
              Add an entry manually
            </Link>
          </div>
        </div>
      </StateFrame>
    );
  }

  // Show empty state if no emissions data (including zero totals from a fresh account)
  if (!emissions || emissions.total_co2e_tonnes === 0) {
    const isCurrentYear = year === currentReportingYear();
    return (
      <StateFrame>
        {/* First-run checklist: name the company, add a facility, add data, generate a report. */}
        <DashboardChecklist />
        <div className="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-800">
          <div className="text-4xl mb-2" aria-hidden="true">📊</div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">
            {isCurrentYear ? 'No Emissions Data Yet' : `No Emissions Data for ${year}`}
          </h2>
          <p className="text-surface-600 dark:text-surface-400 mb-4 max-w-md mx-auto">
            Nothing is recorded for {calendarYearLabel(year).toLowerCase()}. Choose another year, or import a CSV of activity data — utility bills, fuel invoices, freight records — or add a single entry by hand.
          </p>
          {/* The year stays choosable here: data from an earlier year is otherwise unreachable. */}
          <div className="inline-block text-left mb-6">{yearSelect}</div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/app/intake" className="btn-primary inline-flex">
              Import a CSV
            </Link>
            <Link to="/app/calculator" className="btn-secondary inline-flex">
              Add an entry manually
            </Link>
          </div>
        </div>
      </StateFrame>
    );
  }

  // Transform real data to component format. Values stay in unrounded tonnes and
  // are formatted only at the point of display, and each percentage is derived
  // from those same numbers, so a card, its share and the total can never
  // disagree the way whole-tonne rounding made them ("0 tCO2e · 2.2% of total").
  const total = emissions.total_co2e_tonnes;
  const share = (tonnes: number) => Math.round((tonnes / total) * 1000) / 10;
  const scope1 = {
    value: emissions.scope1_co2e_tonnes,
    label: 'Scope 1 — Direct',
    pct: share(emissions.scope1_co2e_tonnes),
    trend: trendChip(emissions.trend_vs_prior_period?.scope1),
  };
  const scope2 = {
    value: emissions.scope2_co2e_tonnes,
    label: 'Scope 2 — Electricity (location-based)',
    pct: share(emissions.scope2_co2e_tonnes),
    trend: trendChip(emissions.trend_vs_prior_period?.scope2),
  };
  const scope3 = {
    value: emissions.scope3_co2e_tonnes,
    label: 'Scope 3 — Value Chain',
    pct: share(emissions.scope3_co2e_tonnes),
    trend: trendChip(emissions.trend_vs_prior_period?.scope3),
  };
  const totalParts = formatTonnesCO2eParts(total);

  // A past year's trend shows all twelve months, not only those before today's.
  const trendClock = year < currentReportingYear() ? new Date(Date.UTC(year, 11, 31)) : undefined;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-surface-500 mt-0.5">Carbon Accounting Overview</p>
        </div>
        {yearSelect}
      </div>

      <DashboardChecklist />

      {/* Emissions Summary + Trend. Breakpoints are xl, not lg: the 240px sidebar
          takes its share of the viewport, so at lg the content area is only
          ~780px and the summary cards would be squeezed against the chart. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card">
          <EmissionsTrendChart data={trend} {...(trendClock ? { now: trendClock } : {})} />
        </div>

        <div className="space-y-3">
          <EmissionsCard scope={scope1} color="brand" />
          <EmissionsCard scope={scope2} color="accent" />
          <EmissionsCard scope={scope3} color="amber" />
          <div className="card flex items-center justify-between">
            <div>
              <div className="text-xs text-surface-500">Total Emissions</div>
              <div className="text-lg font-bold text-surface-900 dark:text-white">{totalParts.value} <span className="text-xs font-normal text-surface-500">{totalParts.unit}</span></div>
            </div>
            <div className="text-right">
              <div className="text-xs text-surface-500">Reporting period</div>
              <div className="text-sm font-medium">{calendarYearLabel(year)}</div>
            </div>
          </div>
          <ReportedSeparately
            scope2Location={emissions.scope2_co2e_tonnes}
            scope2Market={emissions.scope2_market_co2e_tonnes}
            biogenicCo2={emissions.biogenic_co2_tonnes}
            nonKyoto={emissions.non_kyoto_co2e_tonnes}
            excluded={emissions.excluded_rows}
          />
        </div>
      </div>
    </div>
  );
}

function EmissionsCard({ scope, color }: { scope: { value: number; label: string; pct: number; trend: number | null }; color: string }) {
  // Same hues as the chart (src/lib/scopeColors.ts); amber-700 is that palette's
  // Scope 3 and, unlike amber-600, passes AA for this text.
  const colorMap: Record<string, string> = { brand: 'text-brand-600 dark:text-brand-400', accent: 'text-accent-text', amber: 'text-amber-700 dark:text-amber-400' };
  const bgMap: Record<string, string> = { brand: 'bg-brand-50 dark:bg-brand-900/20', accent: 'bg-teal-50 dark:bg-teal-900/20', amber: 'bg-amber-50 dark:bg-amber-900/20' };
  const amount = formatTonnesCO2eParts(scope.value);
  return (
    <div className={`card !p-3.5 ${bgMap[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-surface-500">{scope.label}</div>
          <div className={`text-base font-bold ${colorMap[color]}`}>{amount.value} <span className="text-xs font-normal">{amount.unit}</span></div>
        </div>
        <div className="text-right">
          <div className="text-xs text-surface-500">{scope.pct}% of total</div>
          {/* risk-medium (#d97706) is only 3.19:1 on white — fails AA for this
              small text. amber-700/amber-400 keeps the same signal and passes. */}
          {scope.trend !== null && (
            <div className={`text-xs font-medium ${scope.trend > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-risk-low'}`}>
              {scope.trend > 0 ? '+' : ''}{scope.trend}% vs prior
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
