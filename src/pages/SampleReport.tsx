import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';
import { summarizeQuality } from '../lib/reports/quality-summary';
import fixture from '../lib/reports/sample-report-fixture.json';

const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Sample Carbon Emissions Report — Eco-Auditor",
  "description": "See what a reviewable GHG emissions report looks like. Scope 1-3 breakdown, data quality scoring, compliance framework alignment.",
};

const fmt = (n: number) => n.toLocaleString('en-US');

const METRICS = {
  total: fmt(fixture.metrics.total),
  unit: fixture.metrics.unit,
  scope1: { value: fmt(fixture.metrics.scope1.value), pct: fixture.metrics.scope1.pct, color: 'bg-red-500' },
  scope2: { value: fmt(fixture.metrics.scope2.value), pct: fixture.metrics.scope2.pct, color: 'bg-blue-500' },
  scope3: { value: fmt(fixture.metrics.scope3.value), pct: fixture.metrics.scope3.pct, color: 'bg-emerald-500' },
};

const QUALITY_SCORES = fixture.quality;

const YEAR_COMPARISON = fixture.year.map(y => ({
  year: String(y.year),
  total: fmt(y.total),
  change: y.change,
}));

export default function SampleReport() {
  useEffect(() => {
    document.title = 'Sample Carbon Report — Eco-Auditor | See What You Get';

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = 'Preview a sample reviewable GHG emissions report from Eco-Auditor. See Scope 1-3 breakdown, data quality scoring, and compliance dashboard.';

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(SCHEMA);
    document.head.appendChild(script);

    return () => {
      document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs';
      if (desc) desc.content = 'Eco-Auditor gives small and mid-size businesses defensible GHG emissions data. Upload bills, connect integrations, and generate Scope 1-3 reports aligned with the GHG Protocol.';
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header variant="marketing" />
      <main id="main-content" tabIndex={-1}>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            Sample output — illustrative data
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            See the reports<br className="hidden sm:block" />
            <span className="text-brand-600 dark:text-brand-400">your team will actually use</span>
          </h1>
          <p className="mt-6 text-lg text-surface-600 dark:text-surface-400 max-w-3xl mx-auto leading-relaxed">
            Here's what a <strong className="text-surface-700 dark:text-surface-300">mid-market manufacturing company</strong> sees after uploading their data,
            and the report package we're building toward. Every figure on this page is fictional.
          </p>
        </div>
      </section>

      {/* ─── Executive Summary Preview ─── */}
      <section className="max-w-5xl mx-auto px-6 pb-8">
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg overflow-hidden">
          {/* Report header */}
          <div className="border-b border-surface-200 dark:border-surface-800 px-6 py-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Annual GHG Inventory Report</div>
              <h2 className="text-base font-bold text-surface-900 dark:text-white mt-0.5">{fixture.company.name} · FY {fixture.company.fiscalYear}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge-green text-2xs">GHG Protocol aligned</span>
              <span className="badge-gray text-2xs">{fixture.revisionLabel}</span>
            </div>
          </div>

          {/* Total emissions hero */}
          <div className="px-6 py-8 text-center border-b border-surface-100 dark:border-surface-800">
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Total scope 1 + 2 + 3 emissions</p>
            <div className="text-5xl font-bold text-surface-900 dark:text-white">{METRICS.total}</div>
            <div className="text-lg text-surface-500 mt-1">{METRICS.unit}</div>
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-2">{fixture.boundary} boundary · Base year: {fixture.baseYear}</p>
          </div>

          {/* Scope breakdown */}
          <div className="px-6 py-6 border-b border-surface-100 dark:border-surface-800">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Emissions by Scope</h3>
            {/* Stacked bar */}
            <div className="h-6 rounded-full overflow-hidden flex mb-4">
              <div className="bg-red-500" style={{ width: `${METRICS.scope1.pct}%` }} title={`Scope 1: ${METRICS.scope1.pct}%`} />
              <div className="bg-blue-500" style={{ width: `${METRICS.scope2.pct}%` }} title={`Scope 2: ${METRICS.scope2.pct}%`} />
              <div className="bg-emerald-500" style={{ width: `${METRICS.scope3.pct}%` }} title={`Scope 3: ${METRICS.scope3.pct}%`} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: 'Scope 1', value: METRICS.scope1.value, pct: METRICS.scope1.pct, color: 'text-red-600 dark:text-red-400' },
                { label: 'Scope 2', value: METRICS.scope2.value, pct: METRICS.scope2.pct, color: 'text-blue-600 dark:text-blue-400' },
                { label: 'Scope 3', value: METRICS.scope3.value, pct: METRICS.scope3.pct, color: 'text-emerald-600 dark:text-emerald-400' },
              ].map((s) => (
                <div key={s.label}>
                  <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-surface-500">{s.label} · {s.pct}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Year-over-year */}
          <div className="px-6 py-6 border-b border-surface-100 dark:border-surface-800">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Year-over-year comparison</h3>
            <div className="grid grid-cols-2 gap-4">
              {YEAR_COMPARISON.map((y) => (
                <div key={y.year} className="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-4 text-center">
                  <div className="text-xs text-surface-500">{y.year} Total</div>
                  <div className="text-xl font-bold text-surface-900 dark:text-white">{y.total} <span className="text-sm font-medium text-surface-500">tCO₂e</span></div>
                  {y.change && <div className="text-xs font-medium text-risk-high mt-1">{y.change} vs prior year</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Data quality */}
          <div className="px-6 py-6">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Data quality breakdown</h3>
            <div className="space-y-3">
              {QUALITY_SCORES.map((q) => (
                <div key={q.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-surface-700 dark:text-surface-300">{q.label}</span>
                    <span className="font-medium text-surface-800 dark:text-surface-200">{q.score}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                    <div className={`h-full rounded-full ${q.color}`} style={{ width: `${q.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-3">
              {(() => {
                const quality = summarizeQuality(QUALITY_SCORES);
                return `${quality.primaryOrBetter}% of total emissions backed by primary source data or better. ${quality.estimated}% flagged for improvement.`;
              })()}
            </p>
          </div>
        </div>
      </section>

      {/* ─── What's Included ─── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-surface-900 dark:text-white text-center mb-3">What the report package includes</h2>
        <p className="text-sm text-surface-500 text-center max-w-2xl mx-auto mb-10">
          The generated PDF is available today. The detail ledger and evidence exports illustrated on this page are on the roadmap — the columns below say which is which.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: 'Generated PDF — available today', items: ['Total emissions across Scope 1, 2, and 3', 'Scope breakdown', 'Overall data-confidence score', 'Methodology and factor basis'] },
            { title: 'In the app — available today', items: ['Every imported entry with its activity type', 'The emission factor applied and its published dataset', 'Confidence score per entry', 'Timestamp per entry', '12-month emissions trend'] },
            { title: 'Roadmap', items: ['Ledger export (CSV)', 'Evidence index linking entries to source documents', 'Reviewer sign-off per entry', 'Version history with diffs', 'Framework-specific filing templates'] },
          ].map((cat) => (
            <div key={cat.title} className="card">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">{cat.title}</h3>
              <ul className="space-y-2">
                {cat.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-400">
                    <svg className="w-3.5 h-3.5 text-brand-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Output formats ─── */}
      <section className="max-w-5xl mx-auto px-6 py-12 border-t border-surface-200 dark:border-surface-800">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white">Export in the formats your stakeholders need</h2>
          <p className="mt-3 text-surface-500 max-w-xl mx-auto">No proprietary formats. These sample files illustrate the target package — the PDF summary is what Eco-Auditor generates today; the ledger, factor register, and evidence index are on the roadmap.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
          <a
            href="/sample-report/pacific-freight-fy2026.pdf"
            download
            className="card flex items-center gap-3 hover:shadow-md transition-shadow group"
          >
            <svg className="w-8 h-8 text-brand-600 dark:text-brand-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9-9 0 0 0-9-9" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">Sample report (PDF)</h3>
              <p className="text-2xs text-surface-500">Executive summary · Fictional data · ~3 KB</p>
            </div>
            <span className="text-2xs text-brand-600 dark:text-brand-400 font-medium">Download</span>
          </a>
          <a
            href="/sample-report/pacific-freight-activity-data.csv"
            download
            className="card flex items-center gap-3 hover:shadow-md transition-shadow group"
          >
            <svg className="w-8 h-8 text-brand-600 dark:text-brand-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9-9 0 0 0-9-9" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">Activity data (CSV)</h3>
              <p className="text-2xs text-surface-500">Detailed ledger · Fictional data · 11 rows</p>
            </div>
            <span className="text-2xs text-brand-600 dark:text-brand-400 font-medium">Download</span>
          </a>
          <a
            href="/sample-report/pacific-freight-factor-register.csv"
            download
            className="card flex items-center gap-3 hover:shadow-md transition-shadow group"
          >
            <svg className="w-8 h-8 text-brand-600 dark:text-brand-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12m-6 0v6m-6 0h12M4.5 4.5h15v3h-15v-3z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">Factor register (CSV)</h3>
              <p className="text-2xs text-surface-500">Source, version, geography, effective period · 5 factors</p>
            </div>
            <span className="text-2xs text-brand-600 dark:text-brand-400 font-medium">Download</span>
          </a>
          <a
            href="/sample-report/pacific-freight-evidence-index.csv"
            download
            className="card flex items-center gap-3 hover:shadow-md transition-shadow group"
          >
            <svg className="w-8 h-8 text-brand-600 dark:text-brand-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">Evidence index (CSV)</h3>
              <p className="text-2xs text-surface-500">Source references + data-quality level per entry · 11 entries</p>
            </div>
            <span className="text-2xs text-brand-600 dark:text-brand-400 font-medium">Download</span>
          </a>
        </div>
        <p className="text-center mt-6 text-2xs text-surface-600 dark:text-surface-400">
          All sample data is fictional and clearly labeled as illustrative. No real customer data is represented.
        </p>
      </section>

      {/* ─── CTA ─── */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 dark:from-brand-700 dark:to-brand-900 px-8 py-12 text-center">
          <div className="relative">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-3">Ready to see your own report?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-6 text-sm">
              Import your activity data by CSV and we'll build your carbon inventory. Start your 14-day free trial.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/signup" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-sm rounded-lg transition-colors shadow-lg">
                Start Free Trial
              </Link>
              <Link to="/methodology" className="inline-flex items-center justify-center px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-medium text-sm rounded-lg transition-colors border border-white/20">
                View Methodology
              </Link>
            </div>
          </div>
        </div>
      </section>
      </main>
    </div>
  );
}