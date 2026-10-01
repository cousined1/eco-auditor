import { formatTonnesCO2eParts, pluralize } from '../lib/format';

export interface ExcludedRows {
  count: number;
  reasons: { reason: string; count: number }[];
}

interface Props {
  /** Location-based Scope 2, the figure in the Scope 2 card. */
  scope2Location: number;
  scope2Market?: number | undefined;
  biogenicCo2?: number | undefined;
  nonKyoto?: number | undefined;
  excluded?: ExcludedRows | undefined;
}

// Figures the GHG Protocol reports beside the scope totals, never inside them
// (F-E-02), and the entries no total could count (F-E-10). Each line appears
// only when it says something: a market-based Scope 2 equal to the
// location-based one, or an empty memo line, is left out.
export default function ReportedSeparately({ scope2Location, scope2Market, biogenicCo2, nonKyoto, excluded }: Props) {
  const lines: { label: string; value: string }[] = [];
  const tonnes = (t: number, unit?: string) => {
    const parts = formatTonnesCO2eParts(t);
    return `${parts.value} ${unit ?? parts.unit}`;
  };
  if (scope2Market !== undefined && Math.abs(scope2Market - scope2Location) > 1e-9) {
    lines.push({ label: 'Scope 2, market-based (renewable contracts at zero)', value: tonnes(scope2Market) });
  }
  if (biogenicCo2) {
    const parts = formatTonnesCO2eParts(biogenicCo2);
    lines.push({ label: 'Biogenic CO2 from burning biomass, outside the scopes', value: `${parts.value} ${parts.unit.replace('CO2e', 'CO2')}` });
  }
  if (nonKyoto) lines.push({ label: 'R-22 and other non-Kyoto refrigerants, not in Scope 1', value: tonnes(nonKyoto) });
  if (excluded && excluded.count > 0) {
    lines.push({ label: `${pluralize(excluded.count, 'entry', 'entries')} not counted in any total`, value: excluded.reasons[0]?.reason ?? '' });
  }
  if (lines.length === 0) return null;

  return (
    <div className="card !p-3.5">
      <h2 className="text-xs font-medium text-surface-500">Reported separately</h2>
      <dl className="mt-1.5 space-y-1.5">
        {lines.map((line) => (
          <div key={line.label}>
            <dt className="text-2xs text-surface-500">{line.label}</dt>
            <dd className="text-sm font-medium text-surface-800 dark:text-surface-200 break-words">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
