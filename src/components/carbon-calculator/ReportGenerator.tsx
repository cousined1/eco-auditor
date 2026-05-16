import { useState } from 'react';
import { insforge as _insforge } from '@/lib/insforge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insforge = _insforge as any;
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
      const safeAmount = (e: EmissionEntry) => {
        const v = parseFloat(e.amount);
        return isNaN(v) ? 0 : v;
      };

      const totalScope1 = entries
        .filter((e) => e.scope === 'Scope 1')
        .reduce((s, e) => s + safeAmount(e), 0);
      const totalScope2 = entries
        .filter((e) => e.scope === 'Scope 2')
        .reduce((s, e) => s + safeAmount(e), 0);
      const totalScope3 = entries
        .filter((e) => e.scope === 'Scope 3')
        .reduce((s, e) => s + safeAmount(e), 0);

      const { data: report, error } = await insforge
        .from('reports')
        .insert([{
          company_id: company.id,
          title: `Carbon Report ${new Date().toISOString().split('T')[0]}`,
          type: 'carbon',
          status: 'final',
          last_updated: new Date().toISOString(),
          completeness: 100,
          signoff: 'pending',
        }])
        .select()
        .single();

      if (error) throw error;

      try {
        await insforge.functions.invoke('generate-pdf', {
          body: {
            reportId: report.id,
            companyId: company.id,
            totals: { scope1: totalScope1, scope2: totalScope2, scope3: totalScope3 },
          },
        });
        setStatus('Report generated and saved.');
      } catch {
        setStatus('Report record saved. PDF generation function not yet deployed.');
      }
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
