import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';

const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Sample Carbon Emissions Report — Eco-Auditor",
  "description": "See what an audit-ready GHG emissions report looks like. Scope 1-3 breakdown, data quality scoring, compliance framework alignment.",
};

const METRICS = {
  total: '12,847',
  unit: 'tCO₂e',
  scope1: { value: '3,421', pct: 27, color: 'bg-red-500' },
  scope2: { value: '2,156', pct: 17, color: 'bg-blue-500' },
  scope3: { value: '7,270', pct: 56, color: 'bg-emerald-500' },
};

const QUALITY_SCORES = [
  { label: 'Direct Measurement (L1)', score: 8, color: 'bg-brand-500' },
  { label: 'Primary Source Data (L2)', score: 34, color: 'bg-brand-400' },
  { label: 'Industry Average (L3)', score: 41, color: 'bg-amber-400' },
  { label: 'Proxy / Estimated (L4–L5)', score: 17, color: 'bg-orange-400' },
];

const YEAR_COMPARISON = [
  { year: '2025', total: '11,204', change: null },
  { year: '2026', total: '12,847', change: '+14.7%' },
];

export default function SampleReport() {
  useEffect(() => {
    document.title = 'Sample Carbon Report — Eco-Auditor | See What You Get';

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = 'Preview a sample audit-ready GHG emissions report from Eco-Auditor. See Scope 1-3 breakdown, data quality scoring, and compliance dashboard.';

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(SCHEMA);
    document.head.appendChild(script);

    return () => {
      document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs';
      if (desc) desc.content = 'Eco-Auditor gives small and mid-size businesses audit-ready GHG emissions data. Upload bills, connect integrations, and generate Scope 1-3 reports aligned with the GHG Protocol.';
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header variant="marketing" />
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
          <p className="mt-6 text-lg text-surface-500 dark:text-surface-400 max-w-3xl mx-auto leading-relaxed">
            Every carbon inventory generates a suite of reports — from executive summaries to auditor-ready
            ledgers. Here's what a <strong className="text-surface-700 dark:text-surface-300">mid-market manufacturing company</strong> sees after uploading their data.
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
              <h2 className="text-base font-bold text-surface-900 dark:text-white mt-0.5">Pacific Freight Co. · FY 2026</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge-green text-2xs">GHG Protocol aligned</span>
              <span className="badge-gray text-2xs">DRAFT — FOR REVIEW</span>
            </div>
          </div>

          {/* Total emissions hero */}
          <div className="px-6 py-8 text-center border-b border-surface-100 dark:border-surface-800">
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Total scope 1 + 2 + 3 emissions</p>
            <div className="text-5xl font-bold text-surface-900 dark:text-white">{METRICS.total}</div>
            <div className="text-lg text-surface-500 mt-1">{METRICS.unit}</div>
            <p className="text-xs text-surface-400 mt-2">Operational control boundary · Base year: 2025</p>
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
            <p className="text-xs text-surface-400 mt-3">
              83% of total emissions backed by primary source data or better. 17% flagged for improvement.
            </p>
          </div>
        </div>
      </section>

      {/* ─── What's Included ─── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold text-surface-900 dark:text-white text-center mb-10">Every report package includes</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: 'Executive Summary', items: ['Total emissions and scope breakdown', 'Year-over-year trend', 'Data quality score', 'Materiality analysis', 'Flagged items for review'] },
            { title: 'Detail Ledger', items: ['Every emissions entry with source', 'Emission factors and citations', 'Reviewer and timestamp per entry', 'Confidence score per data point', 'Version history with diffs'] },
            { title: 'Compliance Package', items: ['GHG Protocol assertion letter', 'California SB 253 disclosure pack', 'CBAM reporting templates', 'Customer procurement response', 'Base year recalculation memo'] },
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
          <p className="mt-3 text-surface-500 max-w-xl mx-auto">No proprietary formats. Download reports in standard tools your team already uses.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          {['PDF (executive summary)', 'CSV (detailed ledger)', 'XLSX (Excel)', 'JSON (API-ready)', 'XBRL (compliance)'].map((fmt) => (
            <div key={fmt} className="px-5 py-3 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-700 dark:text-surface-300 shadow-sm">
              {fmt}
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 dark:from-brand-700 dark:to-brand-900 px-8 py-12 text-center">
          <div className="relative">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-3">Ready to see your own report?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-6 text-sm">
              Upload your first utility bills and invoices. We'll extract the data and build your carbon inventory — no credit card required.
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
    </div>
  );
}
