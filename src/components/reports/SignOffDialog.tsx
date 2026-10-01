import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatTonnesCO2e } from '@/lib/format';
import type { ReportSummary } from '@/lib/reports';

interface Props {
  report: ReportSummary;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirms a sign-off. It says what signing off does before it happens: the
 * report becomes final and frozen, and cannot be changed or signed again.
 */
export default function SignOffDialog({ report, busy, onConfirm, onCancel }: Props) {
  const ref = useFocusTrap<HTMLDivElement>(() => {
    if (!busy) onCancel();
  });
  const total = report.total_tco2e == null ? null : formatTonnesCO2e(report.total_tco2e);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/50 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signoff-title"
        aria-describedby="signoff-description"
        className="card w-full max-w-md"
      >
        <h2 id="signoff-title" className="text-base font-semibold text-surface-900 dark:text-white">
          Sign off report {report.id}?
        </h2>
        <div id="signoff-description" className="mt-2 space-y-2 text-sm text-surface-600 dark:text-surface-400">
          <p>
            {report.period_label}
            {total ? `, ${total}` : ''}, generated {new Date(report.generated_at).toLocaleString()}.
          </p>
          <p>
            Signing off freezes this report as final. It can never be changed or signed off again. Its figures were
            already fixed when it was generated; to include data added or changed since then, generate a new report.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary">
            {busy ? 'Signing off…' : 'Sign off and freeze'}
          </button>
        </div>
      </div>
    </div>
  );
}
