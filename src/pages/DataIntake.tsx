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

/** Per-file outcome for a multi-file upload, so no file's result is hidden. */
type FileOutcome = {
  name: string;
  status: 'imported' | 'skipped' | 'failed';
  detail: string;
};

export default function DataIntake() {
  const [activeTab, setActiveTab] = useState<'files' | 'integrations' | 'review'>('files');
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);
  const [csvResult, setCsvResult] = useState<CsvUploadResult | null>(null);
  const [uploadUpgrade, setUploadUpgrade] = useState<UpgradeRequired | null>(null);
  const [uploading, setUploading] = useState(false);
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Only successes auto-dismiss. Errors used to disappear after 4s too, so a
  // failed import — a skipped file, an expired session, a plan limit — vanished
  // before it could be read and the upload looked like it had worked.
  const showStatus = useCallback((type: 'success' | 'error', message: string) => {
    setActionStatus({ type, message });
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (type === 'success') {
      statusTimerRef.current = setTimeout(() => setActionStatus(null), 4000);
    }
  }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setCsvResult(null);

    // Every file's outcome is collected and rendered, rather than each call to
    // showStatus overwriting the previous one. With a single status slot, a
    // batch of [ok, failed, ok] ended on "Imported 5 of 5 rows from good2.csv"
    // and the failure in the middle was invisible — the user was told the
    // import succeeded while rows were silently missing from their inventory.
    const collected: FileOutcome[] = [];
    setOutcomes([]);
    setUploading(true);

    // Upload each CSV and display results
    for (let i = 0; i < files.length; i++) {
      const file: File | undefined = files.item(i) ?? undefined;
      if (!file) continue;
      if (!file.name.toLowerCase().endsWith('.csv')) {
        collected.push({ name: file.name, status: 'skipped', detail: 'Not a CSV file' });
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
          collected.push({ name: file.name, status: 'failed', detail: 'Session expired — sign in again to upload' });
          continue;
        }
        if (res.status === 402) {
          const up = await getUpgradeRequired(res);
          setUploadUpgrade(up || { requiredPlan: 'starter' });
          // Prefer the server's reason — "you have used all 10 imports this
          // month" or "this file contains Scope 3 rows" tells the customer what
          // to do; a generic "requires an active plan" does not.
          collected.push({ name: file.name, status: 'failed', detail: up?.message || 'CSV import requires an active plan' });
          continue;
        }
        // The server caps the body at 100kb; a 413 comes back as HTML, not
        // JSON, so res.json() threw and the user saw
        // "Unexpected token 'P'... is not valid JSON" instead of the reason.
        if (res.status === 413) {
          collected.push({
            name: file.name,
            status: 'failed',
            detail: 'File is larger than the 100 KB import limit — split it into smaller files and retry',
          });
          continue;
        }
        if (!res.ok && !(res.headers.get('content-type') || '').includes('json')) {
          collected.push({ name: file.name, status: 'failed', detail: `Import failed (HTTP ${res.status})` });
          continue;
        }
        const data = await res.json();

        if (data.success) {
          const rowErrors: string[] = data.errors || [];
          const rowWarnings: string[] = data.warnings || [];
          setCsvResult({ imported: data.imported, total_rows: data.total_rows, errors: rowErrors, warnings: rowWarnings });
          collected.push({
            name: file.name,
            // A partial import is not a success: some rows did not land, and on
            // an emissions inventory that difference is the whole point.
            status: data.imported === data.total_rows ? 'imported' : 'failed',
            // setCsvResult holds only ONE file's diagnostics, so in a multi-file
            // batch the last file overwrote the earlier ones and the specific
            // failing rows vanished. Carry them into this file's own outcome.
            detail: `${data.imported} of ${data.total_rows} rows imported`
              + (rowErrors.length ? ` — ${rowErrors.slice(0, 3).join('; ')}${rowErrors.length > 3 ? ` (+${rowErrors.length - 3} more)` : ''}` : ''),
          });
        } else {
          collected.push({ name: file.name, status: 'failed', detail: data.error || 'Import failed' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        collected.push({ name: file.name, status: 'failed', detail: msg });
      }
    }

    setOutcomes(collected);
    setUploading(false);

    // Summarise honestly: the banner reports failure whenever ANY file failed,
    // so a mixed batch can never read as a clean success.
    const failed = collected.filter((o) => o.status !== 'imported');
    if (failed.length === 0) {
      showStatus('success', `Imported ${collected.length} file${collected.length === 1 ? '' : 's'}`);
    } else {
      showStatus(
        'error',
        `${failed.length} of ${collected.length} file${collected.length === 1 ? '' : 's'} did not import — see details below`,
      );
    }

    // Clearing the input is what makes re-selecting the SAME file work. Without
    // it the change event never fires again, so a user who fixes a rejected CSV
    // and picks it a second time gets no response at all.
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-busy={uploading}
          className="btn-primary disabled:opacity-60"
        >
          {uploading ? (
            <span className="mr-1.5 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-b-white" aria-hidden="true" />
          ) : (
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" strokeLinecap="round"/></svg>
          )}
          {uploading ? 'Uploading…' : 'Upload Files'}
        </button>
      </div>

      {/* Per-file outcomes. A single status line could only ever show the LAST
          file's result, so a failure followed by a success reported as success. */}
      {outcomes.length > 0 && (
        <div className="card" role="status" aria-live="polite">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Upload results</h2>
          <ul className="space-y-1.5">
            {outcomes.map((o) => (
              <li key={o.name} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={
                    o.status === 'imported'
                      ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-risk-low'
                      : o.status === 'skipped'
                        ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-risk-medium'
                        : 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-risk-high'
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium text-surface-800 dark:text-surface-200 break-all">{o.name}</span>
                  <span className="text-surface-500"> — {o.status === 'imported' ? 'imported' : o.status}: {o.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          role={actionStatus.type === 'error' ? 'alert' : 'status'}
          aria-live={actionStatus.type === 'error' ? 'assertive' : 'polite'}
          className={`flex items-start justify-between gap-3 px-4 py-2.5 rounded-lg text-sm border ${
            actionStatus.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          <span>{actionStatus.message}</span>
          {actionStatus.type === 'error' && (
            <button
              type="button"
              onClick={() => setActionStatus(null)}
              aria-label="Dismiss error"
              className="flex-shrink-0 text-lg leading-none hover:opacity-70"
            >
              &times;
            </button>
          )}
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
              className="text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200 text-lg leading-none"
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

      {/* Each tab's aria-controls pointed at an id that was never rendered, so
          the relationship was broken for assistive tech. The panels now carry
          the matching id, role, and label, and are focusable after activation. */}
      {activeTab === 'files' && (
        <div id="tab-panel-files" role="tabpanel" aria-labelledby="tab-files" tabIndex={0} className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Uploaded Files</h3>
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Only CSV imports are supported today. Document scanning, OCR previews, and the human review queue are coming soon.
          </p>
        </div>
      )}

      {activeTab === 'integrations' && (
        <div id="tab-panel-integrations" role="tabpanel" aria-labelledby="tab-integrations" tabIndex={0}>
          <ComingSoon featureName="Integrations" />
        </div>
      )}

      {activeTab === 'review' && (
        <div id="tab-panel-review" role="tabpanel" aria-labelledby="tab-review" tabIndex={0}>
          <ComingSoon featureName="Human Review Queue" />
        </div>
      )}
    </div>
  );
}
