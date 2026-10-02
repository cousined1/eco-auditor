// Which signed-off reports cover a date. Editing an entry never changes a report
// that already exists (a report is a frozen snapshot), but the customer should know
// that a signed-off report covers the period before they change its data: the edit
// dialog asks for a confirmation when one does.
import type { ReportSummary } from './reports';

/**
 * The final (signed-off) reports whose period contains any of `dates` ('YYYY-MM-DD').
 * Drafts and legacy reports (never frozen) do not count. Dates compare as text,
 * which is their calendar order.
 */
export function signedOffReportsCovering(reports: readonly ReportSummary[], dates: readonly string[]): ReportSummary[] {
  const wanted = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  return reports.filter(
    (report) =>
      report.status === 'final' &&
      report.period_start !== null &&
      report.period_end !== null &&
      wanted.some((date) => report.period_start! <= date && date <= report.period_end!),
  );
}

/**
 * The date an entry counts under in a report: its activity date, else the day it
 * was recorded (the server's COALESCE(activity_date, created_at::date) rule).
 */
export function entryReportDate(entry: { activity_date?: string | null; created_at: string }): string {
  return entry.activity_date ?? entry.created_at.slice(0, 10);
}
