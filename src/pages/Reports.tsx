import { useEffect, useState } from 'react';
import ReportPeriodPicker from '../components/reports/ReportPeriodPicker';
import SignOffDialog from '../components/reports/SignOffDialog';
import UpgradePrompt from '../components/UpgradePrompt';
import type { UpgradeRequired } from '../lib/api';
import { formatTonnesCO2e } from '../lib/format';
import { currentReportingYear, toPeriodParam, type ReportPeriodChoice } from '../lib/reportingPeriod';
import { downloadReport, generateReport, listReports, signOffReport, type ReportList, type ReportSummary } from '../lib/reports';
import { RequestTimeoutError } from '../lib/requestTimeout';

// The Reports page (audit K3: F-C-05, F-B-09, F-B-05). It replaced a "Coming
// soon" stub while PDF generation sat at the bottom of the Calculator: generate
// a report for a chosen period, find every report again, download the stored
// PDF, and sign a draft off. Reports are frozen when generated (server.cjs), so
// a download is always the document that was generated.

// What "Try again" repeats after a failed request (every call in lib/reports.ts
// gives up at 15 s, F-B-15). Resolved when clicked, so it uses the period on screen.
type Retry = { kind: 'generate' } | { kind: 'download'; id: string; url: string } | { kind: 'signoff'; report: ReportSummary };
type Notice = { tone: 'status' | 'alert'; text: string; retry?: Retry };

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusText(report: ReportSummary): string {
  if (report.status === 'final') return `Signed off ${formatDateTime(report.signed_off_at)}`;
  if (report.status === 'draft') return 'Draft, not signed off';
  return 'Not frozen (created before reports were stored)';
}

export default function Reports() {
  const [list, setList] = useState<ReportList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeRequired | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [choice, setChoice] = useState<ReportPeriodChoice>({ kind: 'year', year: currentReportingYear() });
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReportSummary | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await listReports(controller.signal);
        if (controller.signal.aborted) return;
        if (result.kind === 'ok') setList(result.data);
        else if (result.kind === 'upgrade') setUpgrade(result.upgrade);
        else setLoadError(result.message);
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(
          err instanceof RequestTimeoutError
            ? 'Loading your reports took too long. Check your connection and try again.'
            : 'Something went wrong while loading your reports. Please try again.',
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [retryToken]);

  const period = toPeriodParam(choice);
  const replaceReport = (report: ReportSummary) =>
    setList((current) => current && { ...current, reports: current.reports.map((r) => (r.id === report.id ? report : r)) });

  async function handleGenerate() {
    if (!list || !period.ok) return;
    setGenerating(true);
    setNotice(null);
    const result = await generateReport(list.company.id, period.period);
    if (result.kind === 'ok') {
      const { reportId, downloadUrl, report } = result.data;
      if (report) {
        setList((current) => current && { ...current, reports: [report, ...current.reports.filter((r) => r.id !== report.id)] });
      }
      try {
        await downloadReport(downloadUrl, reportId);
        setNotice({ tone: 'status', text: `Report ${reportId} (${period.label}) generated and downloaded. It is listed below.` });
      } catch (err) {
        setNotice({
          tone: 'alert',
          text: `Report ${reportId} was generated and is listed below, but the download failed: ${errorText(err)}`,
          retry: { kind: 'download', id: reportId, url: downloadUrl },
        });
      }
    } else if (result.kind === 'upgrade') {
      setNotice({ tone: 'status', text: 'Reports require an active plan — visit Pricing to upgrade.' });
    } else if (result.kind === 'notice') {
      setNotice({ tone: 'status', text: result.message });
    } else {
      setNotice({ tone: 'alert', text: `Error: ${result.message}`, retry: { kind: 'generate' } });
    }
    setGenerating(false);
  }

  async function handleDownload(id: string, url: string | null) {
    if (!url) return;
    setDownloadingId(id);
    setNotice(null);
    try {
      await downloadReport(url, id);
      setNotice({ tone: 'status', text: `Report ${id} downloaded.` });
    } catch (err) {
      setNotice({ tone: 'alert', text: `Error: ${errorText(err)}`, retry: { kind: 'download', id, url } });
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSignOff() {
    if (!confirming) return;
    const target = confirming;
    setSigning(true);
    setNotice(null);
    const result = await signOffReport(target.id, target.pdf_sha256);
    setSigning(false);
    setConfirming(null);
    if (result.kind === 'ok') {
      replaceReport(result.data);
      setNotice({ tone: 'status', text: `Report ${target.id} is signed off. It is final and can no longer change.` });
    } else if (result.kind === 'upgrade') {
      setNotice({ tone: 'status', text: 'Signing off reports requires an active plan — visit Pricing to upgrade.' });
    } else {
      setNotice({ tone: 'alert', text: `Error: ${result.message}`, retry: { kind: 'signoff', report: target } });
    }
  }

  function retryFailed(retry: Retry) {
    if (retry.kind === 'generate') void handleGenerate();
    else if (retry.kind === 'download') void handleDownload(retry.id, retry.url);
    else setConfirming(retry.report); // signing off is final, so it is confirmed again
  }

  const failed = notice?.retry;
  let body;
  if (loading) {
    body = (
      <div className="flex items-center justify-center h-64" role="status">
        <p className="text-surface-600 dark:text-surface-400">Loading your reports…</p>
      </div>
    );
  } else if (upgrade) {
    body = (
      <div className="py-12">
        <UpgradePrompt
          fullPage
          feature="Reports are a paid feature"
          requiredPlan={upgrade.requiredPlan}
          reason={upgrade.message || 'Your trial has ended. Reactivate a plan to generate and download reports.'}
        />
      </div>
    );
  } else if (loadError || !list) {
    body = (
      <div role="alert" className="card text-center py-10">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">Unable to load reports</h2>
        <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">{loadError}</p>
        <button type="button" onClick={() => setRetryToken((t) => t + 1)} className="btn-primary inline-flex">
          Try again
        </button>
      </div>
    );
  } else {
    const hasLegacy = list.reports.some((r) => r.status === 'legacy');
    body = (
      <>
        <section aria-labelledby="generate-heading" className="card space-y-4">
          <h2 id="generate-heading" className="text-sm font-semibold text-surface-800 dark:text-surface-200">
            Generate a report{list.company.name ? ` for ${list.company.name}` : ''}
          </h2>
          <ReportPeriodPicker idPrefix="report-period" value={choice} onChange={setChoice} disabled={generating} />
          <button type="button" onClick={handleGenerate} disabled={generating || !period.ok} className="btn-primary">
            {generating ? 'Generating…' : 'Generate PDF'}
          </button>
        </section>

        {notice && (
          <div className="flex flex-wrap items-center gap-3">
            <p
              role={notice.tone}
              aria-live={notice.tone === 'alert' ? 'assertive' : 'polite'}
              className={`text-sm ${notice.tone === 'alert' ? 'text-risk-high' : 'text-risk-low'}`}
            >
              {notice.text}
            </p>
            {failed && (
              <button type="button" onClick={() => retryFailed(failed)} className="btn-secondary text-xs">
                Try again
              </button>
            )}
          </div>
        )}

        <section aria-labelledby="history-heading" className="card">
          <h2 id="history-heading" className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">
            Your reports
          </h2>
          {list.reports.length === 0 ? (
            <p className="text-sm text-surface-500">No reports yet. Generate one above and it will be listed here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Generated reports, newest first</caption>
                <thead>
                  <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                    <th scope="col" className="py-2 pr-4 font-medium">Report</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Period</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Generated</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Total</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                    <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.reports.map((report) => (
                    <tr key={report.id} className="border-b border-surface-100 dark:border-surface-800 last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">#{report.id}</td>
                      <td className="py-2 pr-4">{report.period_label}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(report.generated_at)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{report.total_tco2e == null ? '—' : formatTonnesCO2e(report.total_tco2e)}</td>
                      <td className="py-2 pr-4">{statusText(report)}</td>
                      <td className="py-2 text-right whitespace-nowrap space-x-2">
                        {report.download_url && (
                          <button
                            type="button"
                            onClick={() => void handleDownload(report.id, report.download_url)}
                            disabled={downloadingId === report.id}
                            aria-label={`Download report ${report.id}`}
                            className="btn-secondary text-xs"
                          >
                            {downloadingId === report.id ? 'Downloading…' : 'Download'}
                          </button>
                        )}
                        {report.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => setConfirming(report)}
                            aria-label={`Sign off report ${report.id}`}
                            className="btn-primary text-xs"
                          >
                            Sign off
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* MAX_DRAFT_REPORTS in src/lib/reports/report-limits.cjs (the SQL trigger reports_prune_drafts). */}
          <p className="text-2xs text-surface-500 mt-3">
            The 25 most recent unsigned drafts are kept: generating a report deletes older drafts. Signed-off reports are
            not deleted this way.
          </p>
          {hasLegacy && (
            <p className="text-2xs text-surface-500 mt-3">
              Reports marked “not frozen” were created before reports were stored when generated. Their figures were never
              kept, so they cannot be downloaded or signed off; generate a new report for the same period instead.
            </p>
          )}
        </section>

        <p className="text-xs text-surface-500">
          A report is source material for your own disclosures. It is not reviewed or assured by a third party and is not a
          regulatory filing. Framework-specific report templates are on the roadmap and not available yet.
        </p>
      </>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Reports</h1>
        <p className="text-sm text-surface-500 mt-0.5 max-w-2xl">
          Generate a PDF emissions report for a calendar year or a date range. Each report is calculated once, when you
          generate it, and stored as it was: later changes to your data do not change it. Generate a new report to include them.
        </p>
      </div>
      {body}
      {confirming && (
        <SignOffDialog report={confirming} busy={signing} onConfirm={() => void handleSignOff()} onCancel={() => setConfirming(null)} />
      )}
    </div>
  );
}
