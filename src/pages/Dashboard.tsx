import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { buildApiRequestInit, getUpgradeRequired, type UpgradeRequired } from '../lib/api';
import { insforge } from '../lib/insforge';
import UpgradePrompt from '../components/UpgradePrompt';

interface EmissionsSummaryData {
  total_co2e_tonnes: number;
  scope1_co2e_tonnes: number;
  scope2_co2e_tonnes: number;
  scope3_co2e_tonnes: number;
  scope1_pct: number;
  scope2_pct: number;
  scope3_pct: number;
  trend_vs_prior_period?: {
    scope1: number | null;
    scope2: number | null;
    scope3: number | null;
  } | null;
}

interface TrendDataPoint {
  month?: string;
  quarter?: string;
  year?: string;
  scope1: number;
  scope2: number;
  scope3: number;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export default function Dashboard() {
  const [emissions, setEmissions] = useState<EmissionsSummaryData | null>(null);
  const [trend, setTrend] = useState<TrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [upgrade, setUpgrade] = useState<UpgradeRequired | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Fetch real API data on component mount
  useEffect(() => {
    const fetchData = async () => {
      // Which of the two parallel requests failed. The catch cannot otherwise
      // tell a "no company yet" summary from a failing trend call.
      let failedRequest: 'summary' | 'trend' | null = null;
      try {
        setLoading(true);
        setError(null);
        setNeedsOnboarding(false);
        setUpgrade(null);

        const requestInit = { ...buildApiRequestInit(insforge), signal: AbortSignal.timeout(15000) };

        // Fetch emissions summary and trend in parallel
        const [summaryRes, trendRes] = await Promise.all([
          fetch('/api/emissions/summary', requestInit),
          fetch('/api/emissions/trend?period=monthly', requestInit),
        ]);

        // Plan gate: an expired trial / free account gets a 402 upgrade_required.
        // Show the upgrade paywall instead of a generic error or empty state.
        const upgradeInfo = (await getUpgradeRequired(summaryRes)) || (await getUpgradeRequired(trendRes));
        if (upgradeInfo) {
          setUpgrade(upgradeInfo);
          return;
        }

        if (!summaryRes.ok) {
          failedRequest = 'summary';
          throw new HttpError(summaryRes.status, `Failed to fetch emissions summary: ${summaryRes.statusText}`);
        }
        if (!trendRes.ok) {
          failedRequest = 'trend';
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

        setEmissions(summaryData.data);
        setTrend(trendData.data || []);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        // If backend rejected because no company exists yet, treat as onboarding
        // state instead of a hard error. Backend auto-provisions on next call.
        // Any other failure (network error, 5xx, unexpected response) is a real
        // error and gets surfaced with a retry affordance.
        const message = err instanceof Error ? err.message : 'Failed to load emissions data';
        // Only "no company yet" is an onboarding state, and only the summary
        // request can say so. The old check fired on 400 OR 403 regardless of
        // which request failed, so a 403 from the trend call — or any
        // permission/expired-token 403 — dropped an existing account with real
        // data onto "Welcome to EcoAuditor, your account is ready", a screen
        // with no retry and no way back. Treat the rest as a real error, which
        // has a retry affordance.
        if (
          err instanceof HttpError &&
          err.status === 400 &&
          failedRequest === 'summary'
        ) {
          setNeedsOnboarding(true);
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [retryToken]);

  // Show loading state
  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4"></div>
            {/* role=status so the whole dashboard swapping in after the fetch
                is announced rather than arriving silently. */}
            <p role="status" className="text-surface-600 dark:text-surface-400">
              Loading your emissions data...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Plan gate: expired trial / no active subscription
  if (upgrade) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="py-12">
          <UpgradePrompt
            fullPage
            feature="Your dashboard is a paid feature"
            requiredPlan={upgrade.requiredPlan}
            reason={upgrade.message || 'Your trial has ended. Reactivate a plan to view your emissions dashboard and reports.'}
          />
        </div>
      </div>
    );
  }

  // Show a real error state (network failure, 5xx, unexpected response) with a retry affordance
  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-800">
          <div className="text-4xl mb-2">⚠️</div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Unable to Load Dashboard</h2>
          <p className="text-surface-600 dark:text-surface-400 mb-6 max-w-md mx-auto">
            Something went wrong while loading your emissions data. Please try again.
          </p>
          <button
            type="button"
            onClick={() => setRetryToken((t) => t + 1)}
            className="btn-primary inline-flex"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Show onboarding state if we truly have no emissions data
  if (needsOnboarding) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-800">
          <div className="text-4xl mb-2">🏢</div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Welcome to EcoAuditor</h2>
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
      </div>
    );
  }

  // Show empty state if no emissions data (including zero totals from a fresh account)
  if (!emissions || emissions.total_co2e_tonnes === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="text-center py-12 bg-surface-50 dark:bg-surface-900 rounded-lg border border-surface-200 dark:border-surface-800">
          <div className="text-4xl mb-2">📊</div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">No Emissions Data Yet</h2>
          <p className="text-surface-600 dark:text-surface-400 mb-6 max-w-md mx-auto">
            Import a CSV of activity data — utility bills, fuel invoices, freight records — or add a single entry by hand.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/app/intake" className="btn-primary inline-flex">
              Import a CSV
            </Link>
            <Link to="/app/calculator" className="btn-secondary inline-flex">
              Add an entry manually
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Transform real data to component format
  const total = Math.round(emissions.total_co2e_tonnes * 100) / 100;
  const scope1 = {
    value: Math.round(emissions.scope1_co2e_tonnes * 100) / 100,
    label: 'Scope 1 — Direct',
    pct: Math.round(emissions.scope1_pct * 10) / 10,
    trend: emissions.trend_vs_prior_period?.scope1 != null
      ? Math.round(emissions.trend_vs_prior_period.scope1 * 10) / 10
      : null,
  };
  const scope2 = {
    value: Math.round(emissions.scope2_co2e_tonnes * 100) / 100,
    label: 'Scope 2 — Electricity',
    pct: Math.round(emissions.scope2_pct * 10) / 10,
    trend: emissions.trend_vs_prior_period?.scope2 != null
      ? Math.round(emissions.trend_vs_prior_period.scope2 * 10) / 10
      : null,
  };
  const scope3 = {
    value: Math.round(emissions.scope3_co2e_tonnes * 100) / 100,
    label: 'Scope 3 — Value Chain',
    pct: Math.round(emissions.scope3_pct * 10) / 10,
    trend: emissions.trend_vs_prior_period?.scope3 != null
      ? Math.round(emissions.trend_vs_prior_period.scope3 * 10) / 10
      : null,
  };

  // Determine which date key the trend data uses (month/quarter/year)
  const trendDateKey = trend.length > 0 
    ? (trend[0]?.month ? 'month' : trend[0]?.quarter ? 'quarter' : 'year')
    : 'month';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-surface-500 mt-0.5">Carbon Accounting Overview</p>
      </div>

      {/* Emissions Summary + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Emissions Trend</h2>
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-brand-500" />Scope 1</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-accent" />Scope 2</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Scope 3</span>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity={0.15}/><stop offset="100%" stopColor="#16a34a" stopOpacity={0}/></linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity={0.15}/><stop offset="100%" stopColor="#0d9488" stopOpacity={0}/></linearGradient>
                  <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d97706" stopOpacity={0.15}/><stop offset="100%" stopColor="#d97706" stopOpacity={0}/></linearGradient>
                </defs>
                <XAxis dataKey={trendDateKey} tick={{ fontSize: 11 }} stroke="#9ca8a0" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca8a0" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e8ece9' }} />
                <Area type="monotone" dataKey="scope1" stroke="#16a34a" fill="url(#g1)" strokeWidth={2} name="Scope 1" />
                <Area type="monotone" dataKey="scope2" stroke="#0d9488" fill="url(#g2)" strokeWidth={2} name="Scope 2" />
                <Area type="monotone" dataKey="scope3" stroke="#d97706" fill="url(#g3)" strokeWidth={2} name="Scope 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <EmissionsCard scope={scope1} color="brand" />
          <EmissionsCard scope={scope2} color="accent" />
          <EmissionsCard scope={scope3} color="amber" />
          <div className="card flex items-center justify-between">
            <div>
              <div className="text-xs text-surface-500">Total Emissions</div>
              <div className="text-lg font-bold text-surface-900 dark:text-white">{total.toLocaleString()} <span className="text-xs font-normal text-surface-500">tCO2e</span></div>
            </div>
            <div className="text-right">
              <div className="text-xs text-surface-500">Reporting Year</div>
              <div className="text-sm font-medium">FY {new Date().getFullYear()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmissionsCard({ scope, color }: { scope: { value: number; label: string; pct: number; trend: number | null }; color: string }) {
  const colorMap: Record<string, string> = { brand: 'text-brand-600 dark:text-brand-400', accent: 'text-accent-text', amber: 'text-amber-600 dark:text-amber-400' };
  const bgMap: Record<string, string> = { brand: 'bg-brand-50 dark:bg-brand-900/20', accent: 'bg-teal-50 dark:bg-teal-900/20', amber: 'bg-amber-50 dark:bg-amber-900/20' };
  return (
    <div className={`card !p-3.5 ${bgMap[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-surface-500">{scope.label}</div>
          <div className={`text-base font-bold ${colorMap[color]}`}>{scope.value.toLocaleString()} <span className="text-xs font-normal">tCO2e</span></div>
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
