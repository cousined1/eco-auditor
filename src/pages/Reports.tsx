import { useState } from 'react';
import { REPORTS, EMISSIONS_SUMMARY } from '../data/mockData';

export default function Reports() {
  const [selectedReport, setSelectedReport] = useState<number | null>(null);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Reporting Center</h1>
          <p className="text-sm text-surface-500 mt-0.5">Generate, review, and submit compliance and disclosure reports</p>
        </div>
        <button className="btn-primary">+ New Report</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
            <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300">Reports</h3>
          </div>
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {REPORTS.map((report) => (
              <button
                key={report.id}
                onClick={() => setSelectedReport(report.id)}
                className={`w-full text-left px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors ${selectedReport === report.id ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}`}
              >
                <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{report.title}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`badge ${
                    report.status === 'final' ? 'badge-green' :
                    report.status === 'in-progress' ? 'badge-blue' :
                    report.status === 'draft' ? 'badge-amber' : 'badge-gray'
                  }`}>
                    {report.status.replace('-', ' ')}
                  </span>
                  <span className="badge-gray">{report.type}</span>
                </div>
                <div className="text-2xs text-surface-400 mt-1">Updated {report.lastUpdated}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selectedReport ? (() => {
            const report = REPORTS.find((r) => r.id === selectedReport);
            if (!report) { setSelectedReport(null); return null; }
            return (
              <>
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{report.title}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="badge-gray">{report.type}</span>
                        <span className={`badge ${report.status === 'final' ? 'badge-green' : report.status === 'in-progress' ? 'badge-blue' : 'badge-amber'}`}>
                          {report.status.replace('-', ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-secondary text-xs">Edit</button>
                      <button className="btn-primary text-xs">Export PDF</button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-surface-500">Completeness</span>
                        <span className="font-medium">{report.completeness}%</span>
                      </div>
                      <div className="h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${report.completeness >= 80 ? 'bg-risk-low' : report.completeness >= 50 ? 'bg-risk-medium' : 'bg-risk-high'}`} style={{ width: `${report.completeness}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-surface-500">Sign-off Status</span>
                        <span className={`badge ${report.signoff === 'approved' ? 'badge-green' : report.signoff === 'pending' ? 'badge-amber' : 'badge-gray'}`}>
                          {report.signoff}
                        </span>
                      </div>
                    </div>
                  </div>

                  {report.type === 'CBAM' && (
                    <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700 space-y-3">
                      <h4 className="text-xs font-semibold text-surface-700 dark:text-surface-300">CBAM Package Contents</h4>
                      {[
                        { item: 'Embedded emissions per product line', status: 'complete' },
                        { item: 'Supplier primary data — PackCo International', status: 'complete' },
                        { item: 'Supplier primary data — Valley Dairy Co-op', status: 'missing' },
                        { item: 'Freight emissions — EU import lanes', status: 'partial' },
                        { item: 'Electricity allocation methodology', status: 'complete' },
                        { item: 'Verification statement draft', status: 'pending' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2.5 text-xs">
                          <span className={`w-1.5 h-1.5 rounded-full ${item.status === 'complete' ? 'bg-risk-low' : item.status === 'missing' ? 'bg-risk-high' : item.status === 'partial' ? 'bg-risk-medium' : 'bg-surface-400'}`} />
                          <span className="text-surface-700 dark:text-surface-300 flex-1">{item.item}</span>
                          <span className={`capitalize ${item.status === 'complete' ? 'text-risk-low' : item.status === 'missing' ? 'text-risk-high' : 'text-risk-medium'}`}>{item.status}</span>
                        </div>
                      ))}
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <div className="text-xs font-medium text-amber-800 dark:text-amber-300">⚠ Incomplete data may result in default values applied by importing country</div>
                        <div className="text-2xs text-amber-700 dark:text-amber-400 mt-1">2 suppliers have not provided primary emissions data. Consider using verified estimates with documented assumptions.</div>
                      </div>
                    </div>
                  )}

                  {report.type === 'Customer' && (
                    <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700 space-y-3">
                      <h4 className="text-xs font-semibold text-surface-700 dark:text-surface-300">Disclosure Package</h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                          <div className="text-surface-500">Total Emissions</div>
                          <div className="font-medium text-surface-800 dark:text-surface-200">{EMISSIONS_SUMMARY.total.toLocaleString()} tCO2e</div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                          <div className="text-surface-500">Data Period</div>
                          <div className="font-medium text-surface-800 dark:text-surface-200">FY 2026 YTD</div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                          <div className="text-surface-500">Primary Data</div>
                          <div className="font-medium text-risk-medium">61%</div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                          <div className="text-surface-500">Methodology</div>
                          <div className="font-medium text-surface-800 dark:text-surface-200">GHG Protocol</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Sign-off Workflow</h3>
                  <div className="flex items-center gap-4">
                    {['Prepared', 'Reviewed', 'Approved'].map((step, i) => (
                      <div key={step} className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          report.signoff === 'approved' || (report.signoff === 'pending' && i < 2) || (report.signoff === 'none' && i === 0)
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300'
                            : 'bg-surface-200 text-surface-500 dark:bg-surface-700'
                        }`}>
                          {(report.signoff === 'approved' || (report.signoff === 'pending' && i < 2)) ? '✓' : i + 1}
                        </div>
                        <span className="text-xs text-surface-600 dark:text-surface-400">{step}</span>
                        {i < 2 && <div className="w-8 h-px bg-surface-300 dark:bg-surface-600" />}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="card flex flex-col items-center justify-center py-16 text-center">
              <svg className="w-12 h-12 text-surface-300 dark:text-surface-600 mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M9 12h6m-3-3v6m9 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <p className="text-sm text-surface-500">Select a report to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}