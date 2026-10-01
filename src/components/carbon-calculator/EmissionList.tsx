import { useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import type { EntryPatch } from '@/lib/entries';
import { scopeColor } from '@/lib/scopeColors';
import { LEGACY_CATALOG_VERSION } from '@/lib/emission-factors/factors';
import EntryEditDialog from './EntryEditDialog';
import { describeEntryChange } from './entryChange';
import {
  countsInScopeTotals,
  datasetLabel,
  formatCO2e,
  entryKgCO2e,
  labelForCategory,
  labelForSource,
  type EmissionEntry,
  type Facility,
} from './utils';

interface Props {
  entries: EmissionEntry[];
  facilities: Facility[];
  onDelete: (id: number) => void | Promise<void>;
  /** Saves an edit and answers with the stored entry. Without it the list has no Edit action. */
  onUpdate?: (id: number, patch: EntryPatch) => Promise<EmissionEntry>;
}

const AMOUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const FACTOR = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const NOT_RECORDED = 'Not recorded';

// What the customer entered and the factor applied to it, as the server stored
// them (K2). Rows saved before that have no such record, and say so. A CSV row
// in a unit the catalog has no factor for was converted first (K4): it shows
// what the file said and the quantity the factor applies to ("1,000 ccf (100 MCF)").
function activityText(e: EmissionEntry): string {
  if (e.activity_amount == null || !e.activity_unit) return NOT_RECORDED;
  const entered = `${AMOUNT.format(e.activity_amount)} ${e.activity_unit}`;
  return e.unit && e.unit !== e.activity_unit ? `${entered} (${AMOUNT.format(Number(e.amount))} ${e.unit})` : entered;
}

// The pinned factor is per `unit`, the catalog unit the amount is in.
function factorText(e: EmissionEntry): string {
  return e.factor_value != null && e.activity_unit ? `${FACTOR.format(e.factor_value)} kg CO2e/${e.unit || e.activity_unit}` : NOT_RECORDED;
}

export default function EmissionList({ entries, facilities, onDelete, onUpdate }: Props) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmissionEntry | null>(null);
  // What the last edit changed, said after it is saved (F-B-17).
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const { theme } = useTheme();

  async function saveEdit(entry: EmissionEntry, patch: EntryPatch) {
    if (!onUpdate) return;
    const updated = await onUpdate(entry.id, patch);
    setChangeNote(describeEntryChange(entry, updated, facilities));
  }

  async function handleDelete(entry: EmissionEntry) {
    if (!window.confirm(`Delete emission entry "${entry.source}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(entry.id);
    setDeleteError(null);
    try {
      await onDelete(entry.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete entry');
    } finally {
      setDeletingId(null);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">
          Emission Entries
        </h2>
        <p className="text-sm text-surface-500">No entries yet. Add your first emission source above.</p>
      </div>
    );
  }

  function facilityName(id: number | null) {
    if (!id) return '—';
    return facilities.find((f) => f.id === id)?.name ?? '—';
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">
        Emission Entries ({entries.length})
      </h2>
      {deleteError && (
        <p className="text-sm text-risk-high mb-3">{deleteError}</p>
      )}
      {changeNote && (
        <p role="status" aria-live="polite" className="text-sm text-risk-low mb-3">{changeNote}</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700">
              <th className="text-left py-2 pr-3 text-xs font-medium text-surface-500">Scope</th>
              <th className="text-left py-2 pr-3 text-xs font-medium text-surface-500">Category</th>
              <th className="text-left py-2 pr-3 text-xs font-medium text-surface-500">Source</th>
              <th className="text-right py-2 pr-3 text-xs font-medium text-surface-500">CO2e</th>
              <th className="text-left py-2 pr-3 text-xs font-medium text-surface-500">Facility</th>
              <th className="text-left py-2 pr-3 text-xs font-medium text-surface-500">Activity date</th>
              <th className="text-right py-2 pr-3 text-xs font-medium text-surface-500">Activity</th>
              <th className="text-right py-2 pr-3 text-xs font-medium text-surface-500">Factor</th>
              <th className="text-left py-2 pr-3 text-xs font-medium text-surface-500">Dataset</th>
              <th className="py-2 text-xs font-medium text-surface-500 w-16"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                className="border-b border-surface-100 dark:border-surface-800 last:border-0"
              >
                <td className="py-2 pr-3">
                  {/* The dot is the scope's chart colour (src/lib/scopeColors.ts); the
                      name beside it keeps colour from being the only cue. nowrap: at
                      tablet width this badge used to break into "Scope / 2". */}
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-surface-100 px-2 py-0.5 text-2xs font-medium text-surface-700 dark:bg-surface-800 dark:text-surface-300">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: scopeColor(e.scope, theme) }} aria-hidden="true" />
                    {e.scope}
                  </span>
                </td>
                {/* Entries store catalog keys; rows written before the merge
                    store display labels. Both resolve, and an unknown value
                    falls back to the raw string rather than rendering blank. */}
                <td className="py-2 pr-3 text-surface-700 dark:text-surface-300">{labelForCategory(e.category)}</td>
                <td className="py-2 pr-3 text-surface-700 dark:text-surface-300">
                  {labelForSource(e.category, e.source)}
                  {e.updated_at && (
                    <span className="badge-gray ml-1.5 whitespace-nowrap" title={`Last edited ${new Date(e.updated_at).toLocaleString()}`}>
                      Edited
                    </span>
                  )}
                </td>
                <td
                  className="py-2 pr-3 text-right font-medium whitespace-nowrap text-surface-900 dark:text-white"
                  title={e.calculation_error ? `Not counted in any total: ${e.calculation_error}` : undefined}
                >
                  {e.calculation_error ? '—' : formatCO2e(entryKgCO2e(e))}
                  {!e.calculation_error && !countsInScopeTotals(e) && (
                    <span className="block text-2xs font-normal text-surface-500">reported separately, not in Scope 1</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-surface-500">{facilityName(e.facility_id)}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-surface-700 dark:text-surface-300">{e.activity_date ?? NOT_RECORDED}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap text-surface-700 dark:text-surface-300">{activityText(e)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap text-surface-700 dark:text-surface-300">{factorText(e)}</td>
                <td className="py-2 pr-3 text-surface-700 dark:text-surface-300">{datasetLabel(e.factor_source)}</td>
                <td className="py-2 whitespace-nowrap">
                  {onUpdate && (
                    <button
                      type="button"
                      onClick={() => { setChangeNote(null); setEditing(e); }}
                      disabled={deletingId === e.id}
                      className="mr-2 text-surface-600 dark:text-surface-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Edit entry ${e.source}`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5L11 2.5z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(e)}
                    disabled={deletingId === e.id}
                    className="text-surface-600 dark:text-surface-400 hover:text-risk-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Delete entry ${e.source}`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <EntryEditDialog
          entry={editing}
          facilities={facilities}
          onSave={(patch) => saveEdit(editing, patch)}
          onClose={() => setEditing(null)}
        />
      )}
      {entries.some((e) => e.factor_source == null) && (
        <p className="text-xs text-surface-500 mt-3">
          Not recorded: the entry has no stored activity, factor or dataset (calculator entries and CSV imports
          saved before these were kept). Its CO2e is calculated from the {LEGACY_CATALOG_VERSION} factor catalog, which
          prices every entry saved without a recorded version, so later factor corrections do not change it.
        </p>
      )}
    </div>
  );
}
