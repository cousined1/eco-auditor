import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { EntryPatch } from '@/lib/entries';
import { describeError } from '@/lib/company';
import { RequestTimeoutError, withDeadline } from '@/lib/requestTimeout';
import { listReports, type ReportSummary } from '@/lib/reports';
import { entryReportDate, signedOffReportsCovering } from '@/lib/reportCoverage';
import { FIELD_CLASS, LABEL_CLASS } from '../company/CompanyFields';
import {
  calculateEmissions,
  formatCO2e,
  labelForCategory,
  labelForSource,
  unitsForSource,
  type EmissionEntry,
  type Facility,
} from './utils';

interface Props {
  entry: EmissionEntry;
  facilities: Facility[];
  /** Saves the change and answers with the stored entry; rejects with the server's message. */
  onSave: (patch: EntryPatch) => Promise<unknown>;
  onClose: () => void;
}

type Coverage = { status: 'loading' } | { status: 'ready'; reports: ReportSummary[] } | { status: 'error'; message: string };

const EARLIEST_ACTIVITY_DATE = '1990-01-01';
// Local calendar day, the one the user reads on their own wall calendar (as in EmissionForm).
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Edit one entry (F-B-17). The amount, unit, activity date and facility can change;
 * the category and source cannot (add a new entry for those). The server recomputes
 * the CO2e and keeps the old values in the entry history. A report is a frozen
 * snapshot, so an edit never changes one, but when a signed-off report covers the
 * entry's period (before or after the edit) the dialog says so and asks for a
 * confirmation before it saves.
 */
export default function EntryEditDialog({ entry, facilities, onSave, onClose }: Props) {
  const units = unitsForSource(entry.category, entry.source);
  // Rows saved before the activity was recorded (the old calculator stored kg CO2e
  // in `amount`) carry no amount or unit to edit: the customer states them again.
  // A CSV row does hold its activity in amount and unit, so those start filled in.
  const legacy = entry.activity_amount == null;
  const startUnit = legacy ? (units.includes(entry.unit) ? entry.unit : '') : (entry.activity_unit ?? '');
  const startAmount = legacy ? (units.includes(entry.unit) ? String(Number(entry.amount) || '') : '') : String(entry.activity_amount);
  const startDate = entryReportDate(entry);

  const [amount, setAmount] = useState(startAmount);
  const [unit, setUnit] = useState(startUnit);
  const [activityDate, setActivityDate] = useState(startDate);
  const [facilityId, setFacilityId] = useState<number | null>(entry.facility_id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [coverage, setCoverage] = useState<Coverage>({ status: 'loading' });
  const [checkAttempt, setCheckAttempt] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(() => {
    if (!busy) onClose();
  });

  // Which reports are signed off, loaded when the dialog opens (bounded at 15 s).
  useEffect(() => {
    const controller = new AbortController();
    withDeadline((signal) => listReports(signal), { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setCoverage(
          result.kind === 'ok'
            ? { status: 'ready', reports: result.data.reports }
            : { status: 'error', message: result.kind === 'upgrade' ? 'Your plan does not include reports.' : result.message },
        );
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setCoverage({ status: 'error', message: err instanceof RequestTimeoutError ? 'Checking took too long.' : describeError(err, 'Checking failed.') });
      },
    );
    return () => controller.abort();
  }, [checkAttempt]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const today = todayLocal();
  const parsedAmount = Number(amount.trim());
  const amountValid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(activityDate) && activityDate >= EARLIEST_ACTIVITY_DATE && activityDate <= today;
  const unitValid = units.includes(unit);
  const preview = amountValid && unitValid ? calculateEmissions(entry.category, entry.source, parsedAmount, unit) : null;

  const changed =
    legacy ||
    parsedAmount !== entry.activity_amount ||
    unit !== entry.activity_unit ||
    activityDate !== startDate ||
    facilityId !== (entry.facility_id ?? null);

  const covering =
    coverage.status === 'ready' ? signedOffReportsCovering(coverage.reports, [startDate, activityDate]) : [];
  const needsConfirmation = covering.length > 0;
  const checking = coverage.status === 'loading';
  const canSave = amountValid && dateValid && unitValid && changed && !checking && (!needsConfirmation || confirmed) && !busy && units.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const patch: EntryPatch = { amount: parsedAmount, unit, activity_date: activityDate };
    if (facilityId !== (entry.facility_id ?? null)) patch.facility_id = facilityId;
    setBusy(true);
    setError(null);
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      setError(describeError(err, 'Failed to save the change.'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-surface-900/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-edit-title"
        aria-describedby="entry-edit-description"
        className="card w-full max-w-lg"
      >
        <h2 id="entry-edit-title" className="text-base font-semibold text-surface-900 dark:text-white">Edit entry</h2>
        <p id="entry-edit-description" className="mt-1 text-sm text-surface-600 dark:text-surface-400">
          {entry.scope} · {labelForCategory(entry.category)} · {labelForSource(entry.category, entry.source)}. To change the category or
          source, add a new entry and delete this one.
        </p>

        {units.length === 0 ? (
          <p role="alert" className="mt-4 text-sm text-risk-high">
            This older entry cannot be edited here. Delete it and add it again.
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4" aria-busy={busy}>
            {legacy && (
              <p className="text-xs text-surface-600 dark:text-surface-400">
                This entry was saved before its amount and unit were recorded. Enter them again to update it; its date is filled in from when it was recorded.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-amount" className={LABEL_CLASS}>Amount</label>
                <input id="edit-amount" type="number" min="0" step="any" value={amount} disabled={busy}
                  onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== '' && !amountValid ? true : undefined}
                  className={FIELD_CLASS} />
                {amount !== '' && !amountValid && <p className="text-xs text-risk-high mt-1" role="alert">Amount must be a positive number.</p>}
              </div>
              <div>
                <label htmlFor="edit-unit" className={LABEL_CLASS}>Unit</label>
                <select id="edit-unit" value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value)} className={FIELD_CLASS}>
                  <option value="">Select unit</option>
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="edit-date" className={LABEL_CLASS}>Activity date</label>
                <input id="edit-date" type="date" value={activityDate} min={EARLIEST_ACTIVITY_DATE} max={today} required disabled={busy}
                  onChange={(e) => setActivityDate(e.target.value)} aria-invalid={activityDate !== '' && !dateValid ? true : undefined}
                  className={FIELD_CLASS} />
              </div>
              <div>
                <label htmlFor="edit-facility" className={LABEL_CLASS}>Facility</label>
                <select id="edit-facility" value={facilityId ?? ''} disabled={busy}
                  onChange={(e) => setFacilityId(e.target.value ? Number(e.target.value) : null)} className={FIELD_CLASS}>
                  <option value="">No facility</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>

            <p className="text-sm text-surface-600 dark:text-surface-400">
              Estimated:&nbsp;
              <span className="font-semibold text-surface-900 dark:text-white">{preview !== null ? formatCO2e(preview) : '—'}</span>
              <span className="block text-xs mt-0.5">The server recalculates the stored figure when you save.</span>
            </p>

            {checking && <p role="status" className="text-xs text-surface-600 dark:text-surface-400">Checking signed-off reports…</p>}
            {coverage.status === 'error' && (
              <p role="status" className="text-xs text-surface-600 dark:text-surface-400">
                We could not check whether a signed-off report covers this period ({coverage.message}). Reports you already generated do not change when you edit an entry.{' '}
                <button type="button" className="underline underline-offset-2" onClick={() => { setCoverage({ status: 'loading' }); setCheckAttempt((n) => n + 1); }}>
                  Check again
                </button>
              </p>
            )}
            {needsConfirmation && (
              <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  A signed-off report covers this period. Your change will not alter that report; generate a new report afterwards.
                </p>
                <label className="mt-2 flex items-start gap-2 text-sm text-surface-800 dark:text-surface-200">
                  <input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                  <span>I understand that the signed-off report will stay as it is.</span>
                </label>
              </div>
            )}

            {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-risk-high focus:outline-none">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
              <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={!canSave}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        )}
        {units.length === 0 && (
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
