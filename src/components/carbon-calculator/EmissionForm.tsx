import { useRef, useState } from 'react';
import UpgradePrompt from '../UpgradePrompt';
import type { UpgradeRequired } from '@/lib/api';
import { SCOPE3_PLAN, UpgradeRequiredError, newIdempotencyKey } from '@/lib/entries';
import {
  SCOPES,
  calculateEmissions,
  categoriesForScope,
  formatCO2e,
  sourcesForCategory,
  unitsForSource,
  type Scope,
  type Facility,
} from './utils';

export interface EmissionFormData {
  scope: string;
  category: string;
  source: string;
  amount: number;
  unit: string;
  /** YYYY-MM-DD, required: it decides which reporting year the entry counts in. */
  activityDate: string;
  facilityId: number | null;
  /** The browser's own estimate, for the confirmation message only; the server computes the stored value. */
  calculatedKg: number;
  /** Same key while the same entry is retried, a new one for the next entry. */
  idempotencyKey: string;
}

interface Props {
  facilities: Facility[];
  onSubmit: (data: EmissionFormData) => Promise<void>;
  /** false: the plan has no Scope 3, so Scope 3 shows an upgrade prompt. null/undefined: unknown, the server decides. */
  scope3Allowed?: boolean | null;
}

// Local calendar day, the one the user reads on their own wall calendar.
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// The server accepts the same range (server-entries.cjs).
const EARLIEST_ACTIVITY_DATE = '1990-01-01';

export default function EmissionForm({ facilities, onSubmit, scope3Allowed }: Props) {
  const [scope, setScope] = useState<Scope>('Scope 1');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  // No default: a bill from last year entered today used to be booked to this
  // year, because the entry date was the only date stored (F-E-05).
  const [activityDate, setActivityDate] = useState('');
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeRequired | null>(null);
  // "Entry added": a saved entry used to change nothing a screen reader could hear.
  const [added, setAdded] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const pendingKey = useRef<{ payload: string; key: string } | null>(null);

  const today = todayLocal();
  const scope3Locked = scope === 'Scope 3' && scope3Allowed === false;
  const categories = categoriesForScope(scope);
  const sources = sourcesForCategory(category);
  // Only the units this source is actually defined for. Offering every unit for
  // every source is what made the selector decorative: the factor was applied
  // regardless, so 1000 therms of gas was priced with the per-MMBtu factor.
  const units = unitsForSource(category, source);
  const parsedAmount = parseFloat(amount);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const isDateValid = /^\d{4}-\d{2}-\d{2}$/.test(activityDate) && activityDate >= EARLIEST_ACTIVITY_DATE && activityDate <= today;

  // null means the category/source/unit triple has no factor — never zero.
  const preview = isAmountValid && unit ? calculateEmissions(category, source, parsedAmount, unit) : null;
  const isFormValid = Boolean(category && source && unit && isAmountValid && isDateValid && preview !== null && !scope3Locked);

  // Changing the source can invalidate the chosen unit (gallons is meaningless
  // for a grid subregion), so clear it unless the new source also supports it.
  function selectSource(nextSource: string) {
    setSource(nextSource);
    const nextUnits = unitsForSource(category, nextSource);
    const onlyUnit = nextUnits.length === 1 ? nextUnits[0] : undefined;
    setUnit(onlyUnit ?? (nextUnits.includes(unit) ? unit : ''));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (scope3Locked) return;
    if (!category || !source || !isAmountValid || !unit) {
      setError('Please select a category, source, and unit, and enter a positive amount.');
      return;
    }
    if (!isDateValid) {
      setError('Choose the activity date: the day the activity happened, or the last day of the bill\'s period.');
      return;
    }
    if (preview === null) {
      setError(`No emission factor for ${source} measured in ${unit}. Choose a supported unit.`);
      return;
    }
    // A retry of the same contents (after a timeout, say) keeps its key, so the
    // server stores the entry once; anything else is a new entry.
    const payload = JSON.stringify([scope, category, source, parsedAmount, unit, activityDate, facilityId]);
    if (pendingKey.current?.payload !== payload) pendingKey.current = { payload, key: newIdempotencyKey() };
    setSubmitting(true);
    setError(null);
    setUpgrade(null);
    setAdded(null);
    try {
      await onSubmit({
        scope,
        category,
        source,
        amount: parsedAmount,
        unit,
        activityDate,
        facilityId,
        calculatedKg: preview,
        idempotencyKey: pendingKey.current.key,
      });
      pendingKey.current = null;
      setCategory('');
      setSource('');
      setAmount('');
      setUnit('');
      setActivityDate('');
      setFacilityId(null);
      setAdded(`Entry added — ${formatCO2e(preview)}`);
      // The form empties and "Add Entry" disables itself, so the focused button
      // dropped focus to <body>. Put it back at the top of the form, ready for the next entry.
      firstFieldRef.current?.focus();
    } catch (err) {
      // The plan gate (402): an upgrade prompt, not an error.
      if (err instanceof UpgradeRequiredError) setUpgrade(err.upgrade);
      else setError(err instanceof Error ? err.message : 'Failed to add emission entry');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
        Add Emission Entry
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Scope */}
        <div>
          <label htmlFor="scope" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Scope
          </label>
          <select
            id="scope"
            ref={firstFieldRef}
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setCategory('');
              setSource('');
              setUnit('');
              setUpgrade(null);
            }}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <label htmlFor="category" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Category
          </label>
          <select
            id="category"
            value={category}
            disabled={scope3Locked}
            onChange={(e) => {
              setCategory(e.target.value);
              setSource('');
              setUnit('');
            }}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50"
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label htmlFor="source" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Source
          </label>
          <select
            id="source"
            value={source}
            disabled={scope3Locked || !category}
            onChange={(e) => selectSource(e.target.value)}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50"
          >
            <option value="">{category ? 'Select source' : 'Select a category first'}</option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="amount" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Amount
          </label>
          <input
            id="amount"
            type="number"
            value={amount}
            disabled={scope3Locked}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="any"
            placeholder="0"
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50"
          />
          {amount && !isAmountValid && (
            <p className="text-xs text-risk-high mt-1" role="alert">Amount must be a positive number.</p>
          )}
        </div>

        {/* Unit */}
        <div>
          <label htmlFor="unit" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Unit
          </label>
          <select
            id="unit"
            value={unit}
            disabled={scope3Locked || !source}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50"
          >
            <option value="">{source ? 'Select unit' : 'Select a source first'}</option>
            {units.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Activity date */}
        <div>
          <label htmlFor="activity-date" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Activity date
          </label>
          <input
            id="activity-date"
            type="date"
            value={activityDate}
            disabled={scope3Locked}
            onChange={(e) => setActivityDate(e.target.value)}
            min={EARLIEST_ACTIVITY_DATE}
            max={today}
            required
            aria-describedby="activity-date-hint"
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50"
          />
          <p id="activity-date-hint" className="text-xs text-surface-500 mt-1">
            When it happened (for a bill, the last day of its period). Sets the reporting year.
          </p>
        </div>

        {/* Facility */}
        <div>
          <label htmlFor="facility" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Facility
          </label>
          <select
            id="facility"
            value={facilityId ?? ''}
            disabled={scope3Locked}
            onChange={(e) => setFacilityId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50"
          >
            <option value="">No facility</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      {scope3Locked && (
        <UpgradePrompt
          feature="Scope 3 workflows"
          requiredPlan={SCOPE3_PLAN}
          reason="Your plan covers Scope 1 and Scope 2 entries."
        />
      )}
      {upgrade && !scope3Locked && (
        <UpgradePrompt
          feature="Upgrade to save this entry"
          requiredPlan={upgrade.requiredPlan}
          reason={upgrade.message || 'Reactivate a plan to add emission entries.'}
        />
      )}
      {error && (
        <p className="text-xs text-risk-high" role="alert">{error}</p>
      )}
      {/* text-risk-low is the remapped status green in src/index.css (AA on white and on dark). */}
      {added && (
        <p className="text-xs text-risk-low" role="status" aria-live="polite">{added}</p>
      )}

      {/* Preview + Submit */}
      <div className="flex items-center justify-between pt-2 border-t border-surface-200 dark:border-surface-700">
        <div className="text-sm text-surface-600 dark:text-surface-400">
          Estimated:&nbsp;
          <span className="font-semibold text-surface-900 dark:text-white">
            {preview !== null ? `${preview.toFixed(1)} kg CO2e` : '—'}
          </span>
        </div>
        <button
          type="submit"
          disabled={submitting || !isFormValid}
          className="bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Saving…' : 'Add Entry'}
        </button>
      </div>
    </form>
  );
}
