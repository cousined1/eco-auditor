import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTheme } from '@/hooks/useTheme';
import { scopeColor, scopeColors } from '@/lib/scopeColors';
import { countsInScopeTotals, formatCO2e, formatCO2eParts, entryKgCO2e, type EmissionEntry, type Facility } from './utils';

interface Props {
  entries: EmissionEntry[];
  facilities: Facility[];
}

export default function EmissionsDashboard({ entries, facilities }: Props) {
  // The palette is shared with the main dashboard (src/lib/scopeColors.ts), so a
  // scope keeps its colour from screen to screen.
  const { theme } = useTheme();
  const colors = scopeColors(theme);

  // Rows reported beside the scopes (non-Kyoto refrigerants) are not in any scope total.
  const counted = entries.filter(countsInScopeTotals);

  // Aggregate by scope
  const scopeTotals: Record<string, number> = {};
  counted.forEach((e) => {
    // entryKgCO2e, not parseFloat(amount): CSV-imported rows store raw
    // activity amounts, not kilograms. See utils.ts.
    const kg = entryKgCO2e(e);
    scopeTotals[e.scope] = (scopeTotals[e.scope] || 0) + kg;
  });

  const pieData = Object.entries(scopeTotals).map(([name, value]) => ({
    name,
    value,
  }));

  const total = pieData.reduce((s, d) => s + d.value, 0);

  // Aggregate by facility
  const facilityMap: Record<number, Record<string, number>> = {};
  counted.forEach((e) => {
    if (e.facility_id == null) return;
    const existing = facilityMap[e.facility_id];
    const kg = entryKgCO2e(e);
    if (!existing) {
      facilityMap[e.facility_id] = { [e.scope]: kg };
    } else {
      existing[e.scope] = (existing[e.scope] ?? 0) + kg;
    }
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
        {/* F-B-05: an unlabelled all-time total read as the dashboard's year. */}
        <p className="-mt-3 mb-3 text-2xs text-surface-500">All entries, all years. The Dashboard and Reports show one period at a time.</p>
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
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={scopeColor(entry.name, theme)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatCO2e(Number(value))}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e8ece9' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Facility Bar */}
      <div className="card">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
            Emissions by Facility
          </h2>
          {/* The bars are plotted in kilograms; the axis carries no unit of its own. */}
          {barData.length > 0 && <p className="text-2xs text-surface-500">Kilograms CO2e (kg CO2e)</p>}
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
                  formatter={(value) => formatCO2e(Number(value))}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e8ece9' }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Scope 1" fill={colors['Scope 1']} radius={[2, 2, 0, 0]} />
                <Bar dataKey="Scope 2" fill={colors['Scope 2']} radius={[2, 2, 0, 0]} />
                <Bar dataKey="Scope 3" fill={colors['Scope 3']} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="lg:col-span-2">
        {/* Stacked below sm: with the unit spelled out ("255.0 kg CO2e") three
            cards no longer fit side by side on a phone. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(['Scope 1', 'Scope 2', 'Scope 3'] as const).map((s) => {
            const amount = formatCO2eParts(scopeTotals[s] ?? 0);
            return (
              <div key={s} className="card !p-3.5">
                <div className="flex items-center gap-1.5 text-xs text-surface-500">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[s] }} aria-hidden="true" />
                  {s}
                </div>
                <div className="text-base font-bold text-surface-900 dark:text-white">
                  {amount.value} <span className="text-xs font-normal text-surface-500">{amount.unit}</span>
                </div>
                {total > 0 && (
                  <div className="text-2xs text-surface-600 dark:text-surface-400">
                    {(((scopeTotals[s] ?? 0) / total) * 100).toFixed(1)}% of total
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
