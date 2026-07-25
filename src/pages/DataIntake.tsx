import { useState, useRef, useEffect, useCallback } from 'react';
import { ComingSoon } from '../components/ComingSoon';
import { insforge } from '../lib/insforge';
import { buildApiRequestInit, getUpgradeRequired, type UpgradeRequired } from '../lib/api';
import UpgradePrompt from '../components/UpgradePrompt';

type ActionStatus = { type: 'success' | 'error'; message: string } | null;

type CsvUploadResult = {
  imported: number;
  total_rows: number;
  errors: string[];
  warnings: string[];
};

export default function DataIntake() {
  const [activeTab, setActiveTab] = useState<'files' | 'integrations' | 'review'>('files');
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);
  const [csvResult, setCsvResult] = useState<CsvUploadResult | null>(null);
  const [uploadUpgrade, setUploadUpgrade] = useState<UpgradeRequired | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const showStatus = useCallback((type: 'success' | 'error', message: string) => {
    setActionStatus({ type, message });
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setActionStatus(null), 4000);
  }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setCsvResult(null);

    // Upload each CSV and display results
    for (let i = 0; i < files.length; i++) {
      const file: File | undefined = files.item(i) ?? undefined;
      if (!file) continue;
      if (!file.name.endsWith('.csv')) {
        showStatus('error', `${file.name} is not a CSV file — skipped`);
        continue;
      }

      try {
        const text = await file.text();
        // The /api/ingest/csv route is auth-guarded and plan-gated, so the
        // request must carry the InsForge bearer token — without it every
        // production upload 401s before parsing. See audit finding C5.
        const authInit = buildApiRequestInit(insforge);
        const res = await fetch('/api/ingest/csv', {
          method: 'POST',
          headers: { ...(authInit.headers as Record<string, string>), 'Content-Type': 'text/csv' },
          body: text,
        });
        if (res.status === 401) {
          showStatus('error', 'Your session expired — please sign in again to upload.');
          continue;
        }
        if (res.status === 402) {
          const up = await getUpgradeRequired(res);
          setUploadUpgrade(up || { requiredPlan: 'starter' });
          // Prefer the server's reason — "you have used all 10 imports this
          // month" or "this file contains Scope 3 rows" tells the customer what
          // to do; a generic "requires an active plan" does not.
          showStatus('error', up?.message || 'CSV import requires an active plan.');
          continue;
        }
        const data = await res.json();

        if (data.success) {
          setCsvResult({ imported: data.imported, total_rows: data.total_rows, errors: data.errors || [], warnings: data.warnings || [] });
          showStatus('success', `Imported ${data.imported} of ${data.total_rows} rows from ${file.name}`);
        } else {
          showStatus('error', data.error || `Failed to import ${file.name}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : `Failed to upload ${file.name}`;
        showStatus('error', msg);
      }
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Select files to upload"
        onChange={(e) => handleUpload(e.target.files)}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Data Intake</h1>
          <p className="text-sm text-surface-500 mt-0.5">Upload, connect, and review emissions data sources</p>
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary">
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" strokeLinecap="round"/></svg>
          Upload Files
        </button>
      </div>

      {/* Plan gate: CSV import rejected because the account has no active plan */}
      {uploadUpgrade && (
        <UpgradePrompt
          feature="CSV import requires an active plan"
          requiredPlan={uploadUpgrade.requiredPlan}
          reason={uploadUpgrade.message || 'Reactivate a plan to import emissions data from CSV files.'}
        />
      )}

      {/* Action status banner */}
      {actionStatus && (
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2.5 rounded-lg text-sm border ${
            actionStatus.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          {actionStatus.message}
        </div>
      )}

      {/* CSV upload result summary */}
      {csvResult && (
        <div className="card border-brand-200 dark:border-brand-800">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
              CSV Import Results — {csvResult.imported} of {csvResult.total_rows} rows imported
            </h3>
            <button
              type="button"
              onClick={() => setCsvResult(null)}
              className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 text-lg leading-none"
              aria-label="Dismiss results"
            >
              &times;
            </button>
          </div>
          {csvResult.imported > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="badge-green">{csvResult.imported} imported</span>
              {csvResult.errors.length > 0 && <span className="badge-amber">{csvResult.errors.length} error(s)</span>}
              {csvResult.warnings.length > 0 && <span className="badge-amber">{csvResult.warnings.length} warning(s)</span>}
            </div>
          )}
          {csvResult.errors.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Errors</p>
              <ul className="space-y-0.5">
                {csvResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-600 dark:text-red-400 pl-3 border-l-2 border-red-400">{err}</li>
                ))}
              </ul>
            </div>
          )}
          {csvResult.warnings.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Warnings</p>
              <ul className="space-y-0.5">
                {csvResult.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-600 dark:text-amber-400 pl-3 border-l-2 border-amber-400">{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div role="tablist" aria-label="Data intake sections" className="flex gap-2 border-b border-surface-200 dark:border-surface-700">
        {(['files', 'integrations', 'review'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tab-panel-${tab}`}
            id={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            {tab === 'review' ? 'Human Review Queue' : tab === 'integrations' ? 'Integrations' : 'Uploaded Files'}
          </button>
        ))}
      </div>

      {activeTab === 'files' && (
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Uploaded Files</h3>
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Only CSV imports are supported today. Document scanning, OCR previews, and the human review queue are coming soon.
          </p>
        </div>
      )}

      {activeTab === 'integrations' && (
        <ComingSoon featureName="Integrations" />
      )}

      {activeTab === 'review' && (
        <ComingSoon featureName="Human Review Queue" />
      )}
    </div>
  );
}