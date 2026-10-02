import { useState } from 'react';
import ReportPeriodPicker from '@/components/reports/ReportPeriodPicker';
import { currentReportingYear, toPeriodParam, type ReportPeriodChoice } from '@/lib/reportingPeriod';
import { downloadReport, generateReport, type GeneratedReport } from '@/lib/reports';
import { trialEndedSentence } from '@/lib/trial';
import type { Company, EmissionEntry } from './utils';

interface Props {
  company: Company;
  entries: EmissionEntry[];
}

// F-B-05: the calculator's report button used to send no period, so every PDF
// covered "All time" and disagreed with the dashboard's year. It now takes the
// same period picker as the Reports page, defaulting to the Dashboard's year.
// Both requests give up at 15 s (lib/reports.ts, F-B-15) and offer Try again.
export default function ReportGenerator({ company, entries }: Props) {
  const [choice, setChoice] = useState<ReportPeriodChoice>({ kind: 'year', year: currentReportingYear() });
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Generated but not downloaded: Try again fetches it again rather than generating a second report.
  const [undelivered, setUndelivered] = useState<GeneratedReport | null>(null);
  // The plan gate refused the request: the message is followed by a way out.
  const [needsPlan, setNeedsPlan] = useState(false);
  const isError = status?.startsWith('Error') ?? false;
  const period = toPeriodParam(choice);

  async function handleGenerate(retryDownload: GeneratedReport | null = null) {
    setGenerating(true);
    setStatus(null);
    setUndelivered(null);
    setNeedsPlan(false);
    let generated = retryDownload;

    try {
      if (!generated) {
        if (!period.ok) return;
        // Generated server-side from persisted data and stored as it is now.
        const result = await generateReport(company.id, period.period);
        if (result.kind === 'upgrade') {
          setStatus(result.upgrade.trialEnded ? trialEndedSentence(result.upgrade.trialEndedAt) : 'Reports require an active plan.');
          setNeedsPlan(true);
          return;
        }
        if (result.kind === 'notice') {
          setStatus(result.message);
          return;
        }
        if (result.kind === 'error') throw new Error(result.message);
        generated = result.data;
      }

      await downloadReport(generated.downloadUrl, generated.reportId);
      setStatus('Report generated and downloaded.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setUndelivered(generated);
      setStatus(
        generated
          ? `Error: report ${generated.reportId} was generated (see the Reports page), but the download failed: ${message}`
          : `Error: ${message}`,
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
            Generate Report
          </h2>
          <p className="text-xs text-surface-500 mt-0.5">
            Create a PDF report for {company.name} covering the period you choose. Past reports are on the Reports page.
          </p>
          {/* Announced to screen readers (F-C-15): "Report generated and downloaded."
              used to appear silently. Same pattern as the Data Intake banner: an
              error interrupts (alert), anything else waits its turn (status). The
              text-risk-* colours are the remapped ones in src/index.css that pass AA. */}
          {status && (
            <p
              role={isError ? 'alert' : 'status'}
              aria-live={isError ? 'assertive' : 'polite'}
              className={`text-xs mt-1 ${isError ? 'text-risk-high' : 'text-risk-low'}`}
            >
              {status}
              {/* A plain link: this component is mounted without a router in some tests. */}
              {needsPlan && (
                <>
                  {' '}
                  <a href="/app/pricing" className="underline underline-offset-2">
                    Choose a plan
                  </a>
                </>
              )}
            </p>
          )}
          {isError && (
            <button type="button" onClick={() => void handleGenerate(undelivered)} className="btn-secondary text-xs mt-2">
              Try again
            </button>
          )}
        </div>
        <button
          onClick={() => void handleGenerate()}
          disabled={generating || entries.length === 0 || !period.ok}
          className="bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {generating ? 'Generating…' : 'Generate PDF'}
        </button>
      </div>
      <ReportPeriodPicker idPrefix="calculator-report-period" value={choice} onChange={setChoice} disabled={generating} />
    </div>
  );
}
