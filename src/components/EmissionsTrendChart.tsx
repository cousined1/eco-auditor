import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '../hooks/useTheme';
import { formatTonnesCO2e } from '../lib/format';
import { scopeColors } from '../lib/scopeColors';
import { visibleTrend, type TrendDataPoint } from '../lib/trend';

const SERIES = [
  { key: 'scope1', scope: 'Scope 1', gradient: 'trend-fill-scope1' },
  { key: 'scope2', scope: 'Scope 2', gradient: 'trend-fill-scope2' },
  { key: 'scope3', scope: 'Scope 3', gradient: 'trend-fill-scope3' },
] as const;

interface Props {
  data: TrendDataPoint[];
  /** Overrides "today" when deciding which months are still in the future. */
  now?: Date;
}

export default function EmissionsTrendChart({ data, now }: Props) {
  const { theme } = useTheme();
  const colors = scopeColors(theme);
  const points = visibleTrend(data, now);
  // Determine which date key the trend data uses (month/quarter/year)
  const dateKey = points[0]?.month ? 'month' : points[0]?.quarter ? 'quarter' : points[0]?.year ? 'year' : 'month';

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Emissions Trend</h2>
          <p className="text-2xs text-surface-500">Tonnes CO2e (tCO2e)</p>
        </div>
        <div className="flex gap-3 text-xs">
          {SERIES.map(({ scope }) => (
            <span key={scope} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[scope] }} />
              {scope}
            </span>
          ))}
        </div>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <defs>
              {SERIES.map(({ scope, gradient }) => (
                <linearGradient key={gradient} id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[scope]} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={colors[scope]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <XAxis dataKey={dateKey} tick={{ fontSize: 11 }} stroke="#9ca8a0" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca8a0" />
            <Tooltip
              formatter={(value) => formatTonnesCO2e(Number(value))}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e8ece9' }}
            />
            {/* linear, not monotone: a spline invents a hump in the months around a
                single import, which is the shape of most SMB accounts. */}
            {SERIES.map(({ key, scope, gradient }) => (
              <Area
                key={key}
                type="linear"
                dataKey={key}
                stroke={colors[scope]}
                fill={`url(#${gradient})`}
                strokeWidth={2}
                name={scope}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* The chart is a picture; this is the same data for screen readers. */}
      <table className="sr-only">
        <caption>Emissions by {dateKey} and scope</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {SERIES.map(({ scope }) => (
              <th key={scope} scope="col">{scope}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point[dateKey] ?? ''}>
              <th scope="row">{point[dateKey]}</th>
              {SERIES.map(({ key }) => (
                <td key={key}>{formatTonnesCO2e(point[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
