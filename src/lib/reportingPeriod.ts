// One definition of the reporting period for the Dashboard, the Reports page
// and the calculator's report button (audit K3, F-B-05: the dashboard showed
// the current year while reports could only cover "All time", so the two
// screens disagreed and FY2025 could be neither seen nor exported in 2026).
//
// It mirrors the server's src/lib/reports/report-snapshot.cjs, which is what
// actually decides; tests/reporting-period.test.ts checks that the two accept
// and reject the same periods and default to the same year.

export const MIN_REPORT_YEAR = 1990;
export const MAX_REPORT_YEAR = 2100;
/** 53 weeks: the longest fiscal year a 52/53-week calendar produces. */
export const MAX_PERIOD_DAYS = 371;
const YEARS_OFFERED = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar year the Dashboard opens on, and the year every report defaults to. */
export function currentReportingYear(now: Date = new Date()): number {
  return now.getFullYear();
}

/** The years the selectors offer, newest first: this year and the five before it. */
export function reportingYearOptions(now: Date = new Date()): number[] {
  const year = currentReportingYear(now);
  return Array.from({ length: YEARS_OFFERED }, (_, i) => year - i);
}

export function calendarYearLabel(year: number | string): string {
  return `Calendar year ${year}`;
}

export type ReportPeriodChoice =
  | { kind: 'year'; year: number }
  | { kind: 'range'; start: string; end: string };

export type PeriodParam = { ok: true; period: string; label: string } | { ok: false; error: string };

function utcDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? time : null;
}

const inYearRange = (year: number) => year >= MIN_REPORT_YEAR && year <= MAX_REPORT_YEAR;

/**
 * The `period` the report API takes ('2025' or '2025-04-01/2026-03-31') and
 * its label, or the reason the choice is not a period the server accepts.
 */
export function toPeriodParam(choice: ReportPeriodChoice): PeriodParam {
  if (choice.kind === 'year') {
    if (!Number.isInteger(choice.year) || !inYearRange(choice.year)) {
      return { ok: false, error: `Choose a year between ${MIN_REPORT_YEAR} and ${MAX_REPORT_YEAR}.` };
    }
    return { ok: true, period: String(choice.year), label: calendarYearLabel(choice.year) };
  }
  const start = utcDay(choice.start);
  const end = utcDay(choice.end);
  if (start === null || end === null) return { ok: false, error: 'Enter both a start date and an end date.' };
  if (!inYearRange(Number(choice.start.slice(0, 4))) || !inYearRange(Number(choice.end.slice(0, 4)))) {
    return { ok: false, error: `Dates must fall between ${MIN_REPORT_YEAR} and ${MAX_REPORT_YEAR}.` };
  }
  if (end < start) return { ok: false, error: 'The end date is before the start date.' };
  if ((end - start) / DAY_MS + 1 > MAX_PERIOD_DAYS) {
    return { ok: false, error: `A date range can cover at most ${MAX_PERIOD_DAYS} days (53 weeks). Report longer spans one year at a time.` };
  }
  return { ok: true, period: `${choice.start}/${choice.end}`, label: `${choice.start} to ${choice.end}` };
}
