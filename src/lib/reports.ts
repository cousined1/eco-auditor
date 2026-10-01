// The browser side of the report API in server.cjs (audit K3). Every call goes
// through apiFetch, which owns the session token, and runs under withDeadline
// (15 s, F-B-15): a request that never answers ends in an error the page can
// offer to retry, not in a spinner that never stops. A report is generated once
// and stored with its PDF; these calls list, download and sign off the stored
// reports, and never ask the server to re-render one.
import { apiFetch, getUpgradeRequired, type UpgradeRequired } from './api';
import { withDeadline } from './requestTimeout';

export type ReportStatus = 'draft' | 'final' | 'legacy';

export interface ReportSummary {
  id: string;
  title: string;
  /** draft: generated, not signed off. final: signed off, frozen. legacy: created before snapshots, never frozen. */
  status: ReportStatus;
  period: string | null;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  generated_at: string;
  total_tco2e: number | null;
  by_scope: { scope1: number; scope2: number; scope3: number } | null;
  entry_count: number | null;
  pdf_sha256: string | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  download_url: string | null;
}

export interface ReportList {
  company: { id: string; name: string | null };
  reports: ReportSummary[];
}

export interface GeneratedReport {
  reportId: string;
  downloadUrl: string;
  report?: ReportSummary;
}

/**
 * ok: the call worked. upgrade: the plan gate answered 402. notice: the server
 * declined for a reason that is not a fault (a period with no entries).
 * error: anything else, with a message to show.
 */
export type ReportCall<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'upgrade'; upgrade: UpgradeRequired }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string; code?: string };

// The seconds a 429 asks the client to wait: the Retry-After header, else the `retryAfter`
// the JSON body repeats (server.cjs perRouteRateLimit sends both, in seconds).
function retryAfterSeconds(res: Response, body: { retryAfter?: unknown }): number | null {
  const fromHeader = Number(res.headers.get('Retry-After'));
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  const fromBody = Number(body.retryAfter);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : null;
}

// Generating is capped at 20 per company per hour (report-limits.cjs), so a 429 there is that
// cap; every other report call only meets the general per-address limit.
const GENERATE_LIMIT_NOTICE = 'You have generated a lot of reports this hour.';
const GENERAL_LIMIT_NOTICE = 'You have made a lot of requests in a short time.';

/** What a 429 says instead of the server's bare "Too many requests": why, and when to come back. */
export function reportRateLimitMessage(notice: string, seconds: number | null): string {
  if (seconds === null) return `${notice} Try again in a few minutes.`;
  if (seconds < 60) return `${notice} Try again in less than a minute.`;
  const minutes = Math.ceil(seconds / 60);
  return `${notice} Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

async function failureOf<T>(res: Response, fallback: string, limitNotice = GENERAL_LIMIT_NOTICE): Promise<ReportCall<T>> {
  const upgrade = await getUpgradeRequired(res);
  if (upgrade) return { kind: 'upgrade', upgrade };
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown; retryAfter?: unknown };
  if (res.status === 429) return { kind: 'error', message: reportRateLimitMessage(limitNotice, retryAfterSeconds(res, body)) };
  const message = typeof body.error === 'string' && body.error ? body.error : `${fallback} (${res.status})`;
  if (body.code === 'empty_period') return { kind: 'notice', message };
  return typeof body.code === 'string' ? { kind: 'error', message, code: body.code } : { kind: 'error', message };
}

const networkError = (err: unknown): { kind: 'error'; message: string } => ({
  kind: 'error',
  message: err instanceof Error ? err.message : 'Network error',
});

/** Throws on a network failure, RequestTimeoutError at the deadline. `signal` cancels it (unmount, retry). */
export function listReports(signal?: AbortSignal): Promise<ReportCall<ReportList>> {
  return withDeadline<ReportCall<ReportList>>(async (bounded) => {
    const res = await apiFetch('/api/reports', { signal: bounded });
    if (!res.ok) return failureOf(res, 'Could not load your reports');
    const body = (await res.json()) as { success?: boolean; company?: ReportList['company']; reports?: ReportSummary[]; error?: string };
    if (!body.success || !body.company || !Array.isArray(body.reports)) {
      return { kind: 'error', message: body.error || 'Could not load your reports' };
    }
    return { kind: 'ok', data: { company: body.company, reports: body.reports } };
  }, signal ? { signal } : {});
}

/** Generates and stores a report for `period` ('2025' or '2025-04-01/2026-03-31'). */
export async function generateReport(companyId: string | number, period: string): Promise<ReportCall<GeneratedReport>> {
  try {
    return await withDeadline<ReportCall<GeneratedReport>>(async (signal) => {
      const res = await apiFetch(`/api/companies/${companyId}/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
        signal,
      });
      if (!res.ok) return failureOf(res, 'Report generation failed', GENERATE_LIMIT_NOTICE);
      const body = (await res.json()) as { success?: boolean; report_id?: string | number; download_url?: string; report?: ReportSummary; error?: string };
      if (!body.success || body.report_id == null || !body.download_url) {
        return { kind: 'error', message: body.error || 'Report generation failed' };
      }
      const generated: GeneratedReport = { reportId: String(body.report_id), downloadUrl: body.download_url };
      if (body.report) generated.report = body.report;
      return { kind: 'ok', data: generated };
    });
  } catch (err) {
    return networkError(err);
  }
}

/**
 * Saves the stored PDF. A plain link cannot carry the session token, so the
 * bytes are fetched and handed to the browser as a file. Throws on failure,
 * RequestTimeoutError at the deadline.
 */
export function downloadReport(downloadUrl: string, reportId: string): Promise<void> {
  return withDeadline(async (signal) => {
    const res = await apiFetch(downloadUrl, { signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown; retryAfter?: unknown };
      if (res.status === 429) throw new Error(reportRateLimitMessage(GENERAL_LIMIT_NOTICE, retryAfterSeconds(res, body)));
      throw new Error(typeof body.error === 'string' && body.error ? body.error : `Report download failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ecoauditor-report-${reportId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

/** Signs off a draft. The digest binds the sign-off to the PDF that was reviewed. */
export async function signOffReport(reportId: string, pdfSha256: string | null): Promise<ReportCall<ReportSummary>> {
  try {
    return await withDeadline<ReportCall<ReportSummary>>(async (signal) => {
      const res = await apiFetch(`/api/reports/${reportId}/signoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pdfSha256 ? { pdf_sha256: pdfSha256 } : {}),
        signal,
      });
      if (!res.ok) return failureOf(res, 'Sign-off failed');
      const body = (await res.json()) as { success?: boolean; report?: ReportSummary; error?: string };
      if (!body.success || !body.report) return { kind: 'error', message: body.error || 'Sign-off failed' };
      return { kind: 'ok', data: body.report };
    });
  } catch (err) {
    return networkError(err);
  }
}
