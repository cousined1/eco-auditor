import { useFocusTrap } from '@/hooks/useFocusTrap';
import { pluralize } from '@/lib/format';
import type { ImportRecord, SignedOffReportRef } from '@/lib/csvImport';

interface Props {
  record: ImportRecord;
  /** Signed-off reports whose period holds one of the import's rows. */
  reports: SignedOffReportRef[];
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function reportName(report: SignedOffReportRef): string {
  const period = report.period_start && report.period_end ? `${report.period_start} to ${report.period_end}` : report.period;
  return `report ${report.id}${period ? ` (${period})` : ''}`;
}

/**
 * Confirms an undo, saying what it does before it happens: the import's rows are
 * removed, the import stays listed as undone, and a signed-off report whose
 * period holds its rows keeps its own frozen figures.
 */
export default function UndoImportDialog({ record, reports, busy, error, onConfirm, onCancel }: Props) {
  const ref = useFocusTrap<HTMLDivElement>(() => {
    if (!busy) onCancel();
  });
  const rows = record.rows_present ?? record.row_count;
  const name = record.original_filename || `import ${record.id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/50 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="undo-import-title"
        aria-describedby="undo-import-description"
        className="card w-full max-w-md"
      >
        <h2 id="undo-import-title" className="text-base font-semibold text-surface-900 dark:text-white">
          Undo the import of {name}?
        </h2>
        <div id="undo-import-description" className="mt-2 space-y-2 text-sm text-surface-600 dark:text-surface-400">
          <p>
            Its {pluralize(rows, 'row')} will be removed from your inventory. The import stays in this list as undone, and
            it still counts toward this month’s imports.
          </p>
          {reports.length > 0 && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              This import falls in a period with a signed-off report. Undoing it will not change that report; generate a new
              report afterwards. {reports.length === 1 ? 'The signed-off report is' : 'The signed-off reports are'}{' '}
              {reports.map(reportName).join(', ')}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-risk-high">
              {error}
            </p>
          )}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary">
            {busy ? 'Undoing…' : 'Undo import'}
          </button>
        </div>
      </div>
    </div>
  );
}
