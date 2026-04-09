import { useState } from 'react';
import { LEDGER_ENTRIES } from '../data/mockData';

export default function Ledger() {
  const [filter, setFilter] = useState<string>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const filteredEntries = filter === 'all' ? LEDGER_ENTRIES : LEDGER_ENTRIES.filter((e) => e.scope.toLowerCase() === filter);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Emissions Ledger</h1>
          <p className="text-sm text-surface-500 mt-0.5">Immutable audit trail — every entry traced to source, method, and reviewer</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-green">87% defensible</span>
          <button className="btn-secondary text-xs">Export Ledger</button>
        </div>
      </div>

      <div className="flex gap-2 text-xs">
        {['all', 'scope 1', 'scope 2', 'scope 3'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg capitalize font-medium transition-colors ${
              filter === s ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-500 bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-700">
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Scope</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Factor Source</th>
                <th className="px-4 py-2.5 font-medium">Extraction</th>
                <th className="px-4 py-2.5 font-medium">Confidence</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Reviewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {filteredEntries.map((entry) => [
                  <tr
                    key={entry.id}
                    onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                    className="cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-surface-800 dark:text-surface-200">{entry.id}</td>
                    <td className="px-4 py-3 text-surface-600 dark:text-surface-400">{entry.date}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${entry.scope === 'Scope 1' ? 'badge-green' : entry.scope === 'Scope 2' ? 'badge-blue' : 'badge-amber'}`}>
                        {entry.scope}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-surface-700 dark:text-surface-300">{entry.category}</td>
                    <td className="px-4 py-3 font-medium text-surface-800 dark:text-surface-200">{entry.amount} {entry.unit}</td>
                    <td className="px-4 py-3 text-xs text-surface-500">{entry.factor}</td>
                    <td className="px-4 py-3 text-xs text-surface-500">{entry.extraction}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${entry.confidence >= 85 ? 'text-risk-low' : entry.confidence >= 60 ? 'text-risk-medium' : 'text-risk-high'}`}>
                        {entry.confidence}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${
                        entry.status === 'approved' ? 'badge-green' :
                        entry.status === 'pending-review' ? 'badge-amber' : 'badge-blue'
                      }`}>
                        {entry.status.replace('-', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-surface-500">{entry.reviewer}</td>
                  </tr>,
                  expandedEntry === entry.id ? (
                    <tr key={`${entry.id}-detail`} className="bg-surface-50 dark:bg-surface-800/30">
                      <td colSpan={10} className="px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <div className="text-surface-500 mb-1">Source File</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">{entry.source}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Calculation Method</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">{entry.method}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Emission Factor</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">{entry.factor}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Version</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">v{entry.version}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Reviewed By</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">{entry.reviewer}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Recorded</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">{entry.date}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Extraction Method</div>
                            <div className="font-medium text-surface-800 dark:text-surface-200">{entry.extraction}</div>
                          </div>
                          <div>
                            <div className="text-surface-500 mb-1">Confidence Level</div>
                            <div className={`font-medium ${entry.confidence >= 85 ? 'text-risk-low' : entry.confidence >= 60 ? 'text-risk-medium' : 'text-risk-high'}`}>
                              {entry.confidence}% — {entry.confidence >= 85 ? 'High' : entry.confidence >= 60 ? 'Medium' : 'Low'}
                            </div>
                          </div>
                        </div>
                        {entry.status !== 'approved' && (
                          <div className="flex gap-2 mt-3 pt-3 border-t border-surface-200 dark:border-surface-700">
                            <button className="btn-primary text-xs">Approve Entry</button>
                            <button className="btn-secondary text-xs">Request Changes</button>
                            <button className="btn-ghost text-xs">Flag for Review</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null,
              ])}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Change Log & Assumption Register</h3>
        <div className="space-y-2">
          {[
            { date: '2026-03-28', user: 'Sarah Chen', action: 'Approved LED-001 after OCR verification (96%)', type: 'approval' },
            { date: '2026-03-27', user: 'Sarah Chen', action: 'Approved LED-002 — SCE electricity data', type: 'approval' },
            { date: '2026-03-26', user: 'System', action: 'Auto-flagged LED-003 for review (confidence 72%)', type: 'flag' },
            { date: '2026-03-25', user: 'Tom Bradley', action: 'Added conditional approval to LED-007 — spend-based estimate, verify by Q3', type: 'conditional' },
            { date: '2026-03-20', action: 'Scope 2 emission factor updated: eGRID WECC 2024 → 0.212 kgCO2e/kWh', type: 'factor-update' },
            { date: '2026-03-15', action: 'Assumption registered: Refrigerant leak rate set to 3% (industry avg for R-404A systems per EPA)', type: 'assumption' },
          ].map((log, i) => (
            <div key={i} className="flex items-start gap-3 py-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                log.type === 'approval' ? 'bg-risk-low' :
                log.type === 'flag' ? 'bg-risk-medium' :
                log.type === 'factor-update' ? 'bg-risk-info' :
                'bg-surface-400'
              }`} />
              <div className="flex-1">
                <span className="text-surface-700 dark:text-surface-300">{log.action}</span>
                <span className="text-surface-400 ml-2">— {log.date}{log.user ? ` by ${log.user}` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}