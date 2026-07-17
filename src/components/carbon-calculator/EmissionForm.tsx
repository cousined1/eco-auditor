import { useState } from 'react';
import {
  SCOPE_CATEGORIES,
  UNITS,
  EMISSION_FACTORS,
  calculateEmissions,
  getSourcesForCategory,
  type Scope,
  type Facility,
} from './utils';

interface Props {
  facilities: Facility[];
  onSubmit: (data: {
    scope: string;
    category: string;
    source: string;
    amount: number;
    unit: string;
    facilityId: number | null;
    calculatedKg: number;
  }) => Promise<void>;
}

export default function EmissionForm({ facilities, onSubmit }: Props) {
  const [scope, setScope] = useState<Scope>('Scope 1');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = SCOPE_CATEGORIES[scope];
  const sources = getSourcesForCategory(category);
  const parsedAmount = parseFloat(amount);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const preview = isAmountValid ? calculateEmissions(category, source, parsedAmount) : 0;

  const factor = EMISSION_FACTORS[category]?.[source];
  const hasKnownFactor = factor !== undefined;
  const isZeroFactor = factor === 0;
  const isFormValid =
    category && source && isAmountValid && unit && hasKnownFactor && (preview > 0 || isZeroFactor);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !source || !isAmountValid || !unit) {
      setError('Please select a category, source, and unit, and enter a positive amount.');
      return;
    }
    if (!hasKnownFactor || (preview <= 0 && !isZeroFactor)) {
      setError('Selected source has no usable emission factor. Please choose a supported source and unit.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        scope,
        category,
        source,
        amount: parsedAmount,
        unit,
        facilityId,
        calculatedKg: preview,
      });
      setCategory('');
      setSource('');
      setAmount('');
      setUnit('');
      setFacilityId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add emission entry');
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
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setCategory('');
              setSource('');
            }}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          >
            {Object.keys(SCOPE_CATEGORIES).map((s) => (
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
            onChange={(e) => {
              setCategory(e.target.value);
              setSource('');
            }}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label htmlFor="source" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Source
          </label>
          {sources.length > 0 ? (
            <select
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
            >
              <option value="">Select source</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              id="source"
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g., Natural gas furnace"
              className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
            />
          )}
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
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="any"
            placeholder="0"
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
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
            onChange={(e) => setUnit(e.target.value)}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          >
            <option value="">Select unit</option>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Facility */}
        <div>
          <label htmlFor="facility" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Facility
          </label>
          <select
            id="facility"
            value={facilityId ?? ''}
            onChange={(e) => setFacilityId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          >
            <option value="">No facility</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="text-xs text-risk-high" role="alert">{error}</p>
      )}

      {/* Preview + Submit */}
      <div className="flex items-center justify-between pt-2 border-t border-surface-200 dark:border-surface-700">
        <div className="text-sm text-surface-600 dark:text-surface-400">
          Estimated:&nbsp;
          <span className="font-semibold text-surface-900 dark:text-white">
            {preview > 0 ? `${preview.toFixed(1)} kg CO2e` : '—'}
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
