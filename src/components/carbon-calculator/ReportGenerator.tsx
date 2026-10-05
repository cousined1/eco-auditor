import { useState } from 'react';
import { insforge } from '@/lib/insforge';
import { buildApiRequestInit, getUpgradeRequired } from '@/lib/api';
import type { Company, EmissionEntry } from './utils';

interface Props {
  company: Company;
  entries: EmissionEntry[];
}

export default function ReportGenerator({ company, entries }: Props) {
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setStatus(null);

    try {
      const init = buildApiRequestInit(insforge);
      const headers = { ...(init.headers as Record<string, string>), 'Content-Type': 'application/json' };

      // Generate the report server-side from persisted emissions data.
      const genRes = await fetch(`/api/companies/${company.id}/reports/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });

      const upgrade = await getUpgradeRequired(genRes);
      if (upgrade) {
        setStatus('Reports require an active plan — visit Pricing to upgrade.');
        return;
      }
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Report generation failed (${genRes.status})`);
      }
      const data = (await genRes.json()) as { success?: boolean; report_id?: string; download_url?: string; error?: string };
      if (!data.success || !data.download_url) {
        throw new Error(data.error || 'Report generation failed');
      }

      // Download the generated PDF (auth header required — so fetch + blob, not a bare link).
      const dlRes = await fetch(data.download_url, { ...init, signal: AbortSignal.timeout(15000) });
      if (!dlRes.ok) throw new Error(`Report download failed (${dlRes.status})`);
      const blob = await dlRes.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ecoauditor-report-${data.report_id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setStatus('Report generated and downloaded.');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card flex items-center justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
          Generate Report
        </h2>
        <p className="text-xs text-surface-500 mt-0.5">
          Create a PDF summary of {entries.length} emission entries for {company.name}.
        </p>
        {status && (
          <p className={`text-xs mt-1 ${status.startsWith('Error') ? 'text-risk-high' : 'text-risk-low'}`}>
            {status}
          </p>
        )}
      </div>
      <button
        onClick={handleGenerate}
        disabled={generating || entries.length === 0}
        className="bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {generating ? 'Generating…' : 'Generate PDF'}
      </button>
    </div>
  );
}
