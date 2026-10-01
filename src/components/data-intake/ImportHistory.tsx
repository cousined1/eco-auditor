import { useEffect, useState } from 'react';
import { listImports, undoImport, type ImportRecord, type SignedOffReportRef } from '@/lib/csvImport';
import { pluralize } from '@/lib/format';
import UndoImportDialog from './UndoImportDialog';

interface Props {
  /** Changes whenever an import was committed on the page, to reload the list. */
  refreshToken: number;
  /** Tells the page an import was undone (its status line and totals). */
  onUndone: (message: string) => void;
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'gated' }
  | { status: 'ready'; imports: ImportRecord[] };

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusText(record: ImportRecord): string {
  if (record.status === 'undone') return `Undone ${formatDateTime(record.undone_at)}`;
  if (record.status === 'legacy') return 'Imported before import history (cannot be undone here)';
  if (record.rows_present !== undefined && record.rows_present < record.row_count) {
    return `Imported (${record.rows_present} of ${record.row_count} rows still stored)`;
  }
  return 'Imported';
}

/**
 * "Uploaded Files": the company's CSV imports (date, file, rows, warnings,
 * status) with Undo. The tab used to say only that CSV import exists, even
 * after an import, so nothing showed what had been imported or let a mistaken
 * import be taken back (audit F-C-06, F-E-04).
 */
export default function ImportHistory({ refreshToken, onUndone }: Props) {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  const [confirming, setConfirming] = useState<{ record: ImportRecord; reports: SignedOffReportRef[] } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setState({ status: 'loading' });
      const result = await listImports(controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind === 'ok') setState({ status: 'ready', imports: result.data });
      else if (result.kind === 'upgrade') setState({ status: 'gated' });
      else setState({ status: 'error', message: result.message });
    };
    void load();
    return () => controller.abort();
  }, [refreshToken, retryToken]);

  function openUndo(record: ImportRecord) {
    setUndoError(null);
    setConfirming({ record, reports: record.signed_off_reports ?? [] });
  }

  async function confirmUndo() {
    if (!confirming) return;
    const { record, reports } = confirming;
    setUndoing(true);
    setUndoError(null);
    const result = await undoImport(record.id, reports.length > 0);
    setUndoing(false);
    if (result.kind === 'ok') {
      setConfirming(null);
      setState((current) =>
        current.status === 'ready'
          ? { ...current, imports: current.imports.map((item) => (item.id === record.id ? { ...result.data.import, rows_present: 0 } : item)) }
          : current,
      );
      onUndone(`Undid the import of ${record.original_filename || `import ${record.id}`}: ${pluralize(result.data.removed_rows, 'row')} removed.`);
    } else if (result.kind === 'signed_off') {
      // A report was signed off after the list loaded: show it and ask again.
      setConfirming({ record, reports: result.reports });
    } else if (result.kind === 'upgrade') {
      setUndoError(result.upgrade.message || 'This needs an active plan.');
    } else {
      setUndoError(result.message);
    }
  }

  let body;
  if (state.status === 'loading') {
    body = <p className="text-sm text-surface-500" role="status">Loading your imports…</p>;
  } else if (state.status === 'gated') {
    body = <p className="text-sm text-surface-600 dark:text-surface-400">Your import history is available with an active plan.</p>;
  } else if (state.status === 'error') {
    body = (
      <div role="alert" className="text-sm">
        <p className="text-risk-high">{state.message}</p>
        <button type="button" onClick={() => setRetryToken((token) => token + 1)} className="btn-secondary mt-2 text-xs">
          Try again
        </button>
      </div>
    );
  } else if (state.imports.length === 0) {
    body = <p className="text-sm text-surface-500">No imports yet. Files you import are listed here, and each one can be undone.</p>;
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">CSV imports, newest first</caption>
          <thead>
            <tr className="border-b border-surface-200 text-left text-xs text-surface-500 dark:border-surface-700">
              <th scope="col" className="py-2 pr-4 font-medium">Imported</th>
              <th scope="col" className="py-2 pr-4 font-medium">File</th>
              <th scope="col" className="py-2 pr-4 font-medium">Rows</th>
              <th scope="col" className="py-2 pr-4 font-medium">Warnings</th>
              <th scope="col" className="py-2 pr-4 font-medium">Status</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {state.imports.map((record) => (
              <tr key={record.id} className="border-b border-surface-100 last:border-0 dark:border-surface-800">
                <td className="whitespace-nowrap py-2 pr-4">{formatDateTime(record.created_at)}</td>
                <td className="break-all py-2 pr-4">{record.original_filename || '—'}</td>
                <td className="py-2 pr-4">{record.row_count}</td>
                <td className="py-2 pr-4">{record.warning_count ?? '—'}</td>
                <td className="py-2 pr-4">{statusText(record)}</td>
                <td className="py-2 text-right">
                  {record.status === 'committed' && (
                    <button
                      type="button"
                      onClick={() => openUndo(record)}
                      aria-label={`Undo the import of ${record.original_filename || `import ${record.id}`}`}
                      className="btn-secondary text-xs"
                    >
                      Undo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {body}
      {confirming && (
        <UndoImportDialog
          record={confirming.record}
          reports={confirming.reports}
          busy={undoing}
          error={undoError}
          onConfirm={() => void confirmUndo()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
