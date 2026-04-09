import { EMISSIONS_SUMMARY, READINESS_SCORE, MISSING_DATA_ALERTS, COMPLIANCE_TASKS, TREND_DATA, CFO_METRICS, ONBOARDING_CHECKLIST, COMPANY } from '../data/mockData';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const { total, scope1, scope2, scope3 } = EMISSIONS_SUMMARY;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">{COMPANY.name}</h1>
          <p className="text-sm text-surface-500 mt-0.5">FY 2026 Carbon Accounting Overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-green">Food & Beverage</span>
          <span className="badge-blue">{COMPANY.facilities} Facilities</span>
        </div>
      </div>

      {/* CFO Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <CFOMetricCard label="Consultant spend avoided" value={CFO_METRICS.consultantSpendAvoided} />
        <CFOMetricCard label="Contracts at risk" value={String(CFO_METRICS.contractsAtRisk)} variant="warning" />
        <CFOMetricCard label="Records defensible in audit" value={CFO_METRICS.recordsDefensible} />
        <CFOMetricCard label="Reporting package readiness" value={CFO_METRICS.reportingReadiness} />
        <CFOMetricCard label="Primary data coverage" value={CFO_METRICS.primaryDataCoverage} variant="warning" />
        <CFOMetricCard label="Exposure from incomplete disclosures" value={CFO_METRICS.estimatedExposureIncomplete} variant="warning" />
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
              <AreaChart data={TREND_DATA} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity={0.15}/><stop offset="100%" stopColor="#16a34a" stopOpacity={0}/></linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity={0.15}/><stop offset="100%" stopColor="#0d9488" stopOpacity={0}/></linearGradient>
                  <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d97706" stopOpacity={0.15}/><stop offset="100%" stopColor="#d97706" stopOpacity={0}/></linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca8a0" />
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
              <div className="text-sm font-medium">FY 2026</div>
            </div>
          </div>
        </div>
      </div>

      {/* Readiness + Alerts + Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Reporting Readiness</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-surface-200 dark:text-surface-700" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#16a34a" strokeWidth="3" strokeDasharray={`${READINESS_SCORE.overall} ${100 - READINESS_SCORE.overall}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-surface-900 dark:text-white">{READINESS_SCORE.overall}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{READINESS_SCORE.label}</div>
              <div className="text-xs text-surface-500 mt-0.5">Across 5 dimensions</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {READINESS_SCORE.dimensions.map((d) => (
              <div key={d.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-surface-600 dark:text-surface-400">{d.name}</span>
                  <span className={`font-medium ${d.score >= 75 ? 'text-risk-low' : d.score >= 55 ? 'text-risk-medium' : 'text-risk-high'}`}>{d.score}%</span>
                </div>
                <div className="h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${d.score >= 75 ? 'bg-risk-low' : d.score >= 55 ? 'bg-risk-medium' : 'bg-risk-high'}`} style={{ width: `${d.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Missing Data & Alerts</h2>
          <div className="space-y-2">
            {MISSING_DATA_ALERTS.map((alert) => (
              <div key={alert.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${alert.severity === 'high' ? 'bg-risk-high' : alert.severity === 'medium' ? 'bg-risk-medium' : 'bg-risk-info'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-700 dark:text-surface-300">{alert.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xs text-surface-400">{alert.scope}</span>
                    <button className="text-2xs text-accent hover:underline">{alert.action}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Filing & Compliance Tasks</h2>
          <div className="space-y-2">
            {COMPLIANCE_TASKS.map((task) => (
              <div key={task.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${task.status === 'overdue' ? 'bg-risk-high' : task.status === 'in-progress' ? 'bg-risk-medium' : 'bg-surface-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-surface-700 dark:text-surface-300">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`badge ${task.status === 'overdue' ? 'badge-red' : task.status === 'in-progress' ? 'badge-amber' : 'badge-gray'}`}>
                      {task.status.replace('-', ' ')}
                    </span>
                    <span className="text-2xs text-surface-400">{task.deadline}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Onboarding Checklist */}
      <div className="card">
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Setup Progress</h2>
        <div className="flex items-center gap-3">
          {ONBOARDING_CHECKLIST.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${item.status === 'complete' ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300' : item.status === 'in-progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-surface-200 text-surface-500 dark:bg-surface-700'}`}>
                {item.status === 'complete' ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${item.status === 'complete' ? 'text-surface-500 dark:text-surface-400 line-through' : 'text-surface-700 dark:text-surface-300'}`}>{item.title}</span>
              {i < ONBOARDING_CHECKLIST.length - 1 && <div className="w-6 h-px bg-surface-300 dark:bg-surface-600" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CFOMetricCard({ label, value, variant = 'default' }: { label: string; value: string; variant?: 'default' | 'warning' }) {
  return (
    <div className="card !p-3.5">
      <div className="text-2xs text-surface-500 mb-1">{label}</div>
      <div className={`text-lg font-bold ${variant === 'warning' ? 'text-risk-medium' : 'text-surface-900 dark:text-white'}`}>{value}</div>
    </div>
  );
}

function EmissionsCard({ scope, color }: { scope: { value: number; label: string; pct: number; trend: number }; color: string }) {
  const colorMap: Record<string, string> = { brand: 'text-brand-600 dark:text-brand-400', accent: 'text-accent', amber: 'text-amber-600 dark:text-amber-400' };
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
          <div className={`text-xs font-medium ${scope.trend > 0 ? 'text-risk-medium' : 'text-risk-low'}`}>
            {scope.trend > 0 ? '+' : ''}{scope.trend}% vs prior
          </div>
        </div>
      </div>
    </div>
  );
}