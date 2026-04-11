import { SUPPLIERS } from '../data/mockData';

export default function Suppliers() {
  const total = SUPPLIERS.length || 1;
  const responseRate = Math.round((SUPPLIERS.filter((s) => s.responseStatus === 'received').length / total) * 100);
  const primaryDataPct = Math.round((SUPPLIERS.filter((s) => s.dataType === 'primary').length / total) * 100);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Supplier Engagement Hub</h1>
          <p className="text-sm text-surface-500 mt-0.5">Track supplier data requests, responses, and primary vs estimated emissions</p>
        </div>
        <button className="btn-primary">+ Send Questionnaire</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card !p-3.5">
          <div className="text-2xs text-surface-500 mb-1">Response Rate</div>
          <div className="text-lg font-bold text-surface-900 dark:text-white">{responseRate}%</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-2xs text-surface-500 mb-1">Primary Data Coverage</div>
          <div className="text-lg font-bold text-risk-medium">{primaryDataPct}%</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-2xs text-surface-500 mb-1">Overdue Requests</div>
          <div className="text-lg font-bold text-risk-high">2</div>
        </div>
        <div className="card !p-3.5">
          <div className="text-2xs text-surface-500 mb-1">Pending Requests</div>
          <div className="text-lg font-bold text-risk-medium">2</div>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-500 bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-700">
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Annual Spend</th>
                <th className="px-4 py-2.5 font-medium">Emissions (est.)</th>
                <th className="px-4 py-2.5 font-medium">Data Type</th>
                <th className="px-4 py-2.5 font-medium">Response</th>
                <th className="px-4 py-2.5 font-medium">Relevance</th>
                <th className="px-4 py-2.5 font-medium">Last Contact</th>
                <th className="px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {[...SUPPLIERS].sort((a, b) => (a.relevance === b.relevance ? 0 : a.relevance === 'high' ? -1 : 1)).map((s) => (
                <tr key={s.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-surface-800 dark:text-surface-200">{s.name}</td>
                  <td className="px-4 py-3 text-surface-600 dark:text-surface-400">{s.category}</td>
                  <td className="px-4 py-3 text-surface-600 dark:text-surface-400">{s.spend}</td>
                  <td className="px-4 py-3 font-medium text-surface-800 dark:text-surface-200">{s.emissions} tCO2e</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${s.dataType === 'primary' ? 'badge-green' : s.dataType === 'estimate' ? 'badge-amber' : 'badge-red'}`}>
                      {s.dataType === 'primary' ? 'Primary' : s.dataType === 'estimate' ? 'Estimated' : 'No data'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${s.responseStatus === 'received' ? 'badge-green' : s.responseStatus === 'overdue' ? 'badge-red' : s.responseStatus === 'pending' ? 'badge-amber' : 'badge-gray'}`}>
                      {s.responseStatus.replace('-', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${s.relevance === 'high' ? 'badge-red' : s.relevance === 'medium' ? 'badge-amber' : 'badge-gray'}`}>
                      {s.relevance}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-surface-500">{s.lastContact}</td>
                  <td className="px-4 py-3">
                    <button className="btn-ghost text-xs">
                      {s.responseStatus === 'overdue' ? 'Follow Up' : s.responseStatus === 'pending' ? 'Nudge' : s.responseStatus === 'not-sent' ? 'Send' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Follow-up Reminders</h3>
          <div className="space-y-2">
            {SUPPLIERS.filter((s) => s.responseStatus === 'overdue' || s.responseStatus === 'pending').map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <div>
                  <div className="text-xs font-medium text-surface-800 dark:text-surface-200">{s.name}</div>
                  <div className="text-2xs text-surface-500">Last contact: {s.lastContact}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${s.responseStatus === 'overdue' ? 'badge-red' : 'badge-amber'}`}>{s.responseStatus}</span>
                  <button className="btn-ghost text-xs">Send Reminder</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Supplier Segmentation</h3>
          <div className="space-y-2">
            {['high', 'medium', 'low'].map((relevance) => {
              const count = SUPPLIERS.filter((s) => s.relevance === relevance).length;
              const totalEmissions = SUPPLIERS.filter((s) => s.relevance === relevance).reduce((a, s) => a + s.emissions, 0);
              const primaryPct = count ? Math.round((SUPPLIERS.filter((s) => s.relevance === relevance && s.dataType === 'primary').length / count) * 100) : 0;
              return (
                <div key={relevance} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <span className={`badge ${relevance === 'high' ? 'badge-red' : relevance === 'medium' ? 'badge-amber' : 'badge-gray'}`}>{relevance}</span>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-surface-800 dark:text-surface-200">{count} suppliers · {totalEmissions} tCO2e</div>
                    <div className="text-2xs text-surface-500">{primaryPct}% primary data coverage</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}