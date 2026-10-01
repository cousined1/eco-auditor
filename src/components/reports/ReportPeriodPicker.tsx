import {
  calendarYearLabel,
  currentReportingYear,
  reportingYearOptions,
  toPeriodParam,
  type ReportPeriodChoice,
} from '@/lib/reportingPeriod';

const FIELD = 'block w-full rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2 py-1.5 text-sm text-surface-900 dark:text-surface-100 disabled:opacity-50';
const LABEL = 'block text-2xs font-medium text-surface-600 dark:text-surface-400 mb-1';

interface YearSelectProps {
  id: string;
  year: number;
  onChange: (year: number) => void;
  label?: string;
  disabled?: boolean;
}

/** The calendar-year selector the Dashboard and the report picker share (F-B-05). */
export function ReportingYearSelect({ id, year, onChange, label = 'Calendar year', disabled }: YearSelectProps) {
  const years = reportingYearOptions();
  const options = years.includes(year) ? years : [...years, year].sort((a, b) => b - a);
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <select id={id} value={year} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className={FIELD}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}

interface PickerProps {
  idPrefix: string;
  value: ReportPeriodChoice;
  onChange: (next: ReportPeriodChoice) => void;
  disabled?: boolean;
}

/**
 * Chooses what a report covers: a calendar year (the default, the year the
 * Dashboard shows) or a custom range for a fiscal year that does not follow the
 * calendar. There is no "All time" (F-E-03).
 */
export default function ReportPeriodPicker({ idPrefix, value, onChange, disabled }: PickerProps) {
  const checked = toPeriodParam(value);
  const fallbackYear = value.kind === 'year' ? value.year : Number(value.start.slice(0, 4)) || currentReportingYear();

  function changeKind(kind: string) {
    if (kind === 'range' && value.kind === 'year') {
      onChange({ kind: 'range', start: `${value.year}-01-01`, end: `${value.year}-12-31` });
    } else if (kind === 'year' && value.kind === 'range') {
      onChange({ kind: 'year', year: fallbackYear });
    }
  }

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-xs font-semibold text-surface-800 dark:text-surface-200 mb-2">Reporting period</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${idPrefix}-kind`} className={LABEL}>Covers</label>
          <select id={`${idPrefix}-kind`} value={value.kind} onChange={(e) => changeKind(e.target.value)} className={FIELD}>
            <option value="year">A calendar year</option>
            <option value="range">A custom date range</option>
          </select>
        </div>
        {value.kind === 'year' ? (
          <ReportingYearSelect id={`${idPrefix}-year`} year={value.year} onChange={(year) => onChange({ kind: 'year', year })} />
        ) : (
          <>
            <div>
              <label htmlFor={`${idPrefix}-start`} className={LABEL}>From</label>
              <input id={`${idPrefix}-start`} type="date" value={value.start} className={FIELD}
                onChange={(e) => onChange({ kind: 'range', start: e.target.value, end: value.end })} />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-end`} className={LABEL}>To</label>
              <input id={`${idPrefix}-end`} type="date" value={value.end} className={FIELD}
                onChange={(e) => onChange({ kind: 'range', start: value.start, end: e.target.value })} />
            </div>
          </>
        )}
      </div>
      {!checked.ok && (
        <p role="alert" className="text-xs text-risk-high mt-2">{checked.error}</p>
      )}
      <p className="text-2xs text-surface-500 mt-2">
        {value.kind === 'year' ? `${calendarYearLabel(value.year)}, 1 January to 31 December. ` : ''}
        An entry counts in the period of its activity date, or of the day it was recorded if it has none.
      </p>
    </fieldset>
  );
}
