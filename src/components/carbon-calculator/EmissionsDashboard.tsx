import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCO2e, type EmissionEntry, type Facility } from './utils';

interface Props {
  entries: EmissionEntry[];
  facilities: Facility[];
}

const SCOPE_COLORS: Record<string, string> = {
  'Scope 1': '#ef4444',
  'Scope 2': '#f59e0b',
  'Scope 3': '#3b82f6',
};

export default function EmissionsDashboard({ entries, facilities }: Props) {
  // Aggregate by scope
  const scopeTotals: Record<string, number> = {};
  entries.forEach((e) => {
    const kg = parseFloat(e.amount) || 0;
    scopeTotals[e.scope] = (scopeTotals[e.scope] || 0) + kg;
  });

  const pieData = Object.entries(scopeTotals).map(([name, value]) => ({
    name,
    value,
  }));

  const total = pieData.reduce((s, d) => s + d.value, 0);

  // Aggregate by facility
  const facilityMap: Record<number, Record<string, number>> = {};
  entries.forEach((e) => {
    if (e.facility_id == null) return;
    if (!facilityMap[e.facility_id]) facilityMap[e.facility_id] = {};
    facilityMap[e.facility_id][e.scope] =
      (facilityMap[e.facility_id][e.scope] || 0) + (parseFloat(e.amount) || 0);
  });

  const barData = facilities
    .filter((f) => facilityMap[f.id])
    .map((f) => ({
      name: f.name,
      'Scope 1': facilityMap[f.id]?.['Scope 1'] ?? 0,
      'Scope 2': facilityMap[f.id]?.['Scope 2'] ?? 0,
      'Scope 3': facilityMap[f.id]?.['Scope 3'] ?? 0,
    }));

  if (entries.length === 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">
          Emissions Overview
        </h2>
        <p className="text-sm text-surface-500">Charts will appear once you add emission entries.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Scope Pie */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
            Emissions by Scope
          </h2>
          <span className="text-xs text-surface-500">
            Total: {formatCO2e(total)}
          </span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                innerRadius={40}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={SCOPE_COLORS[entry.name] ?? '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => formatCO2e(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e8ece9' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Facility Bar */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
            Emissions by Facility
          </h2>
        </div>
        {barData.length === 0 ? (
          <p className="text-sm text-surface-500">Assign facilities to entries to see this chart.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca8a0" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca8a0" />
                <Tooltip
                  formatter={(value: number) => formatCO2e(value)}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e8ece9' }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Scope 1" fill="#ef4444" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Scope 2" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Scope 3" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-3 gap-3">
          {(['Scope 1', 'Scope 2', 'Scope 3'] as const).map((s) => (
            <div key={s} className="card !p-3.5">
              <div className="text-xs text-surface-500">{s}</div>
              <div className="text-base font-bold text-surface-900 dark:text-white">
                {formatCO2e(scopeTotals[s] ?? 0)}
              </div>
              {total > 0 && (
                <div className="text-2xs text-surface-400">
                  {(((scopeTotals[s] ?? 0) / total) * 100).toFixed(1)}% of total
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
