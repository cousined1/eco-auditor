import { useState, useRef, useEffect, useCallback } from 'react';
import { ComingSoon } from '../components/ComingSoon';
import type { UpgradeRequired } from '../lib/api';
import { checkCsv, commitCsv, decodeCsvFile, type OnDuplicate } from '../lib/csvImport';
import { newIdempotencyKey } from '../lib/entries';
import { pluralize } from '../lib/format';
import { PLANS } from '../data/mockData';
import UpgradePrompt from '../components/UpgradePrompt';
import CsvFormatPanel from '../components/data-intake/CsvFormatPanel';
import ImportHistory from '../components/data-intake/ImportHistory';
import ImportPreview, { type FileItem } from '../components/data-intake/ImportPreview';

type ActionStatus = { type: 'success' | 'error'; message: string } | null;

// A CSV import has two steps (audit K4): every selected file is checked first
// (a dry run that stores nothing and spends no import), its errors, warnings
// and unit conversions are shown, and only then does the user import it. A file
// with errors imports nothing, so fixing it and uploading it again counts each
// row once; it used to store the good rows at once, and the re-upload that the
// error message invited counted them twice.
export default function DataIntake() {
  const [activeTab, setActiveTab] = useState<'files' | 'integrations' | 'review'>('files');
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);
  const [uploadUpgrade, setUploadUpgrade] = useState<UpgradeRequired | null>(null);
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<FileItem[]>([]);
  const [historyToken, setHistoryToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

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

  const update = (id: string, change: Partial<FileItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));

  // The check: every error and warning at once, nothing stored.
  async function check(item: FileItem): Promise<FileItem> {
    const result = await checkCsv(item.text ?? '', item.name);
    if (result.kind === 'ok') return { ...item, phase: 'checked', check: result.data, message: undefined, retry: undefined };
    if (result.kind === 'upgrade') {
      setUploadUpgrade(result.upgrade);
      // The plan notice carries the server's reason ("you have used all 10
      // imports this month", "this file contains Scope 3 rows"); this row only
      // points at it, so the reason is said once.
      return { ...item, phase: 'gated' };
    }
    return { ...item, phase: 'failed', message: result.message, retry: result.kind === 'error' && result.final ? undefined : 'check' };
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Clear any stale plan-gate prompt: a 402 from an earlier attempt must not
    // stay on screen once a later upload in this mount succeeds (FEW-08).
    setUploadUpgrade(null);
    setActionStatus(null);
    setUploading(true);

    // Every file gets its own result, rather than one status slot that showed
    // only the last file's outcome and hid a failure in the middle of a batch.
    const selected: FileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file: File | undefined = files.item(i) ?? undefined;
      if (!file) continue;
      const item: FileItem = { id: String(nextId.current++), name: file.name, phase: 'checking', key: newIdempotencyKey() };
      if (!file.name.toLowerCase().endsWith('.csv')) {
        selected.push({ ...item, phase: 'skipped', message: 'Not a CSV file' });
        continue;
      }
      try {
        const decoded = await decodeCsvFile(file);
        selected.push({ ...item, text: decoded.text, encodingNote: decoded.encodingNote });
      } catch (err) {
        selected.push({ ...item, phase: 'failed', message: err instanceof Error ? err.message : 'The file could not be read' });
      }
    }
    setItems(selected);

    const checked: FileItem[] = [];
    for (const item of selected) {
      const done = item.phase === 'checking' ? await check(item) : item;
      checked.push(done);
      update(item.id, done);
    }
    setUploading(false);
    // A batch refused only by the plan gate is one message, the plan notice.
    if (checked.length > 0 && checked.every((item) => item.phase === 'gated')) setItems([]);

    // Clearing the input is what makes re-selecting the SAME file work. Without
    // it the change event never fires again, so a user who fixes a rejected CSV
    // and picks it a second time gets no response at all.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  async function handleImport(item: FileItem, onDuplicate?: OnDuplicate) {
    update(item.id, { phase: 'importing', onDuplicate, message: undefined, errors: undefined });
    const result = await commitCsv(item.text ?? '', item.name, item.key, onDuplicate);
    if (result.kind === 'ok') {
      update(item.id, { phase: 'imported', commit: result.data });
      setHistoryToken((token) => token + 1);
      showStatus(
        'success',
        result.data.replayed
          ? `${item.name} was already imported (${pluralize(result.data.imported, 'row')}).`
          : `Imported ${pluralize(result.data.imported, 'row')} from ${item.name}.`,
      );
    } else if (result.kind === 'duplicate' && item.check) {
      // Imported by someone else (another tab) since the check: offer the choice.
      update(item.id, { phase: 'checked', check: { ...item.check, duplicate_of: result.previous, warnings: [result.message, ...item.check.warnings] } });
    } else if (result.kind === 'upgrade') {
      setUploadUpgrade(result.upgrade);
      update(item.id, { phase: 'gated' });
    } else if (result.kind === 'invalid') {
      update(item.id, { phase: 'failed', message: result.message, errors: result.errors, retry: 'check' });
    } else {
      // A timeout may have stored the import: Try again sends the same
      // Idempotency-Key, and the server answers with what it stored.
      update(item.id, { phase: 'failed', message: result.message, retry: 'commit' });
      showStatus('error', `${item.name} was not imported: ${result.message}`);
    }
  }

  async function handleRetry(item: FileItem) {
    if (item.retry === 'commit') return handleImport(item, item.onDuplicate);
    update(item.id, { phase: 'checking', message: undefined, errors: undefined });
    update(item.id, await check(item));
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Hidden file input for upload. The "Upload Files" button opens it, so it
          is taken out of the tab order and the accessibility tree: left
          focusable, it was an invisible 1x1 px stop before the button. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
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
          {uploading ? 'Checking…' : 'Upload Files'}
        </button>
      </div>

      {/* Each file's check and import. Announced, since it is the only place
          that says what the upload found (F-C-15). */}
      {items.length > 0 && (
        <section className="card" role="status" aria-live="polite" aria-labelledby="upload-results-heading">
          <h2 id="upload-results-heading" className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">
            Upload results
          </h2>
          <ul className="space-y-3">
            {items.map((item) => (
              <ImportPreview
                key={item.id}
                item={item}
                onImport={(target, onDuplicate) => void handleImport(target, onDuplicate)}
                onRetry={(target) => void handleRetry(target)}
                onDiscard={(target) => setItems((current) => current.filter((other) => other.id !== target.id))}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Plan gate: CSV import rejected because the account has no active plan.
          role="alert" so it is announced on its own when it is the only message. */}
      {uploadUpgrade && (
        <div role="alert">
          <UpgradePrompt
            // "Requires an active plan" is for an account with no plan. A plan that
            // exists but is too small (the Scope 3 or monthly import gate names the
            // plan above it) gets the plan it needs named instead (F-B-10).
            feature={
              uploadUpgrade.requiredPlan === 'starter'
                ? 'CSV import requires an active plan'
                : `This import needs the ${PLANS[uploadUpgrade.requiredPlan].name} plan`
            }
            requiredPlan={uploadUpgrade.requiredPlan}
            reason={uploadUpgrade.message || 'Choose a plan to import emissions data from CSV files.'}
            trialEnded={uploadUpgrade.trialEnded}
            trialEndedAt={uploadUpgrade.trialEndedAt}
          />
        </div>
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

      <CsvFormatPanel />

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
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Uploaded Files</h2>
          <ImportHistory refreshToken={historyToken} onUndone={(message) => showStatus('success', message)} />
          <p className="mt-3 text-xs text-surface-500">
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
