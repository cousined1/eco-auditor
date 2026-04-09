import { METHODOLOGY_SETTINGS, FACILITIES } from '../data/mockData';

export default function Methodology() {
  const m = METHODOLOGY_SETTINGS;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Methodology & Boundaries</h1>
        <p className="text-sm text-surface-500 mt-0.5">Define how emissions are calculated, classified, and reported</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Organizational Boundary</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-surface-600 dark:text-surface-400">Boundary Type</span>
              <span className="badge-green capitalize">{m.boundaryType}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-surface-600 dark:text-surface-400">Reporting Year</span>
              <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{m.reportingYear}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-surface-600 dark:text-surface-400">Base Year</span>
              <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{m.baseYear}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-surface-600 dark:text-surface-400">Materiality Threshold</span>
              <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{m.materialityThreshold}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-surface-600 dark:text-surface-400">Regions</span>
              <div className="flex gap-1">{m.regions.map((r) => <span key={r} className="badge-blue">{r}</span>)}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Scope 2 Electricity Method</h3>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border-2 border-brand-500 bg-brand-50 dark:bg-brand-900/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-brand-700 dark:text-brand-300">Location-based</div>
                  <div className="text-2xs text-surface-500 mt-0.5">Uses grid average emission factors (eGRID)</div>
                </div>
                <span className="badge-green">Active</span>
              </div>
            </div>
            <div className="p-3 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-surface-600 dark:text-surface-400">Market-based</div>
                  <div className="text-2xs text-surface-500 mt-0.5">Uses supplier-specific or residual factors</div>
                </div>
                <button className="btn-ghost text-xs">Enable</button>
              </div>
            </div>
            <p className="text-2xs text-surface-400">Recommendation: Enable dual reporting for maximum disclosure readiness. Market-based is required for GHG Protocol Scope 2 compliance.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Facility List</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FACILITIES.map((f) => (
            <div key={f.id} className="p-4 rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{f.name}</div>
              <div className="text-xs text-surface-500 mt-0.5">{f.city}</div>
              <div className="text-2xs text-surface-400 mt-1">{f.type}</div>
              <div className="flex gap-2 mt-2">
                <span className="text-2xs text-surface-500">Scope 1: {f.scope1Pct}%</span>
                <span className="text-2xs text-surface-500">Scope 2: {f.scope2Pct}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Emission Factor Library</h3>
        <div className="space-y-2">
          {[
            { source: 'EPA GHG Factor Hub 2024', scopes: ['Scope 1', 'Scope 2'], status: 'active' },
            { source: 'eGRID WECC / NWPP 2024', scopes: ['Scope 2'], status: 'active' },
            { source: 'GLEC Framework v3', scopes: ['Scope 3'], status: 'active' },
            { source: 'EXIOBASE 3.8', scopes: ['Scope 3'], status: 'active' },
            { source: 'IPCC AR6 GWP-100', scopes: ['Scope 1'], status: 'active' },
            { source: 'EPA WARM / EEIO', scopes: ['Scope 3'], status: 'active' },
          ].map((factor, i) => (
            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{factor.source}</span>
                <div className="flex gap-1">{factor.scopes.map((s) => <span key={s} className="badge-blue text-2xs">{s}</span>)}</div>
              </div>
              <span className="badge-green">{factor.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Active Scope 3 Categories</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {[
            { cat: 1, name: 'Purchased Goods & Services', active: true },
            { cat: 2, name: 'Capital Goods', active: false },
            { cat: 3, name: 'Fuel & Energy Related', active: false },
            { cat: 4, name: 'Upstream Transportation', active: true },
            { cat: 5, name: 'Waste Generated', active: false },
            { cat: 6, name: 'Business Travel', active: true },
            { cat: 7, name: 'Employee Commuting', active: true },
            { cat: 8, name: 'Upstream Leased Assets', active: false },
            { cat: 9, name: 'Downstream Transportation', active: true },
          ].map((c) => (
            <div key={c.cat} className={`p-2.5 rounded-lg text-xs ${c.active ? 'bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800' : 'bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700'}`}>
              <span className={`font-medium ${c.active ? 'text-brand-700 dark:text-brand-300' : 'text-surface-400 line-through'}`}>{c.cat}. {c.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}