import { useState } from 'react';
import { formatCO2e, entryKgCO2e, labelForCategory, labelForSource, type EmissionEntry, type Facility } from './utils';

interface Props {
  entries: EmissionEntry[];
  facilities: Facility[];
  onDelete: (id: number) => void | Promise<void>;
}

export default function EmissionList({ entries, facilities, onDelete }: Props) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const scopeBadge: Record<string, string> = {
    'Scope 1': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    'Scope 2': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'Scope 3': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  };

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">
        Emission Entries ({entries.length})
      </h2>
      {deleteError && (
        <p className="text-sm text-risk-high mb-3">{deleteError}</p>
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
              <th className="py-2 text-xs font-medium text-surface-500 w-10" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                className="border-b border-surface-100 dark:border-surface-800 last:border-0"
              >
                <td className="py-2 pr-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-2xs font-medium ${scopeBadge[e.scope] ?? ''}`}>
                    {e.scope}
                  </span>
                </td>
                {/* Entries store catalog keys; rows written before the merge
                    store display labels. Both resolve, and an unknown value
                    falls back to the raw string rather than rendering blank. */}
                <td className="py-2 pr-3 text-surface-700 dark:text-surface-300">{labelForCategory(e.category)}</td>
                <td className="py-2 pr-3 text-surface-700 dark:text-surface-300">{labelForSource(e.category, e.source)}</td>
                <td className="py-2 pr-3 text-right font-medium text-surface-900 dark:text-white">
                  {formatCO2e(entryKgCO2e(e))}
                </td>
                <td className="py-2 pr-3 text-surface-500">{facilityName(e.facility_id)}</td>
                <td className="py-2">
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
    </div>
  );
}
