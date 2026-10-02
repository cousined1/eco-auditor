import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS } from '@/data/mockData';
import type { UpgradeRequired } from '@/lib/api';
import { FACILITY_TYPES, UpgradeRequiredError, type FacilityType } from '@/lib/entries';
import { pluralize } from '@/lib/format';
import {
  CompanyApiError,
  FACILITY_FIELD_MAX,
  addFacility,
  deleteFacility,
  describeError,
  nextPlanForFacilities,
  updateFacility,
  type CompanyFacility,
  type CompanyOverview,
} from '@/lib/company';
import UpgradePrompt from '../UpgradePrompt';
import { FIELD_CLASS, LABEL_CLASS } from '../company/CompanyFields';

interface Draft {
  name: string;
  type: FacilityType | '';
  city: string;
}

const BLANK: Draft = { name: '', type: '', city: '' };
const typeLabel = (type: FacilityType | null) => FACILITY_TYPES.find((t) => t.value === type)?.label ?? 'No type';
const byName = (a: CompanyFacility, b: CompanyFacility) => a.name.localeCompare(b.name) || a.id - b.id;

function validate(draft: Draft): string | null {
  if (!draft.name.trim()) return 'Enter the facility name.';
  if (!draft.type) return 'Choose the facility type.';
  if (!draft.city.trim()) return 'Enter the city.';
  return null;
}

function DraftFields({ idPrefix, draft, onChange, disabled }: { idPrefix: string; draft: Draft; onChange: (next: Draft) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={LABEL_CLASS}>Facility name</label>
        <input id={`${idPrefix}-name`} type="text" value={draft.name} maxLength={FACILITY_FIELD_MAX} disabled={disabled}
          onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="e.g., Main Office" className={FIELD_CLASS} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-type`} className={LABEL_CLASS}>Type</label>
        <select id={`${idPrefix}-type`} value={draft.type} disabled={disabled}
          onChange={(e) => onChange({ ...draft, type: e.target.value as FacilityType | '' })} className={FIELD_CLASS}>
          <option value="">Select type</option>
          {FACILITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-city`} className={LABEL_CLASS}>City</label>
        <input id={`${idPrefix}-city`} type="text" value={draft.city} maxLength={FACILITY_FIELD_MAX} disabled={disabled}
          onChange={(e) => onChange({ ...draft, city: e.target.value })} placeholder="e.g., Sacramento" className={FIELD_CLASS} />
      </div>
    </div>
  );
}

/**
 * Settings > Facilities (F-B-03): list, add, rename and delete, under the plan's
 * facility cap. The server enforces the cap under a lock (402) and refuses to delete
 * a facility that entries still point at (409, with the count); this card shows both
 * as messages, and the cap as an upgrade prompt.
 */
export default function FacilitiesCard({ overview, onChange }: { overview: CompanyOverview; onChange: (next: CompanyOverview) => void }) {
  const { facilities, plan, company } = overview;
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft>(BLANK);
  // What is in flight: 'add', or the facility id being saved or deleted.
  const [busy, setBusy] = useState<'add' | number | null>(null);
  // Where the last failure belongs: the add form ('add') or one facility's row.
  const [problem, setProblem] = useState<{ at: 'add' | number; message: string; code?: string } | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeRequired | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const limit = plan.facility_limit;
  const atCap = limit !== null && facilities.length >= limit;
  const planName = PLANS[plan.id].name;
  const publish = (next: CompanyFacility[]) => onChange({ ...overview, facilities: [...next].sort(byName) });

  function fail(at: 'add' | number, err: unknown, fallback: string) {
    if (err instanceof UpgradeRequiredError) {
      setUpgrade(err.upgrade);
      setProblem(null);
      return;
    }
    setProblem({ at, message: describeError(err, fallback), ...(err instanceof CompanyApiError && err.code ? { code: err.code } : {}) });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (busy !== null) return;
    setNotice(null);
    setUpgrade(null);
    const message = validate(draft);
    if (message) {
      setProblem({ at: 'add', message });
      return;
    }
    setBusy('add');
    setProblem(null);
    try {
      const created = await addFacility(company.id, { name: draft.name.trim(), type: draft.type as FacilityType, city: draft.city.trim() });
      publish([...facilities, created]);
      setDraft(BLANK);
      setNotice(`Facility “${created.name}” added.`);
    } catch (err) {
      fail('add', err, 'Failed to add the facility.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit(e: React.FormEvent, facility: CompanyFacility) {
    e.preventDefault();
    if (busy !== null) return;
    setNotice(null);
    const message = validate(edit);
    if (message) {
      setProblem({ at: facility.id, message });
      return;
    }
    setBusy(facility.id);
    setProblem(null);
    try {
      const saved = await updateFacility(company.id, facility.id, { name: edit.name.trim(), type: edit.type as FacilityType, city: edit.city.trim() });
      publish(facilities.map((f) => (f.id === saved.id ? saved : f)));
      setEditingId(null);
      setNotice(`Facility “${saved.name}” saved.`);
    } catch (err) {
      fail(facility.id, err, 'Failed to save the facility.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(facility: CompanyFacility) {
    if (busy !== null) return;
    if (!window.confirm(`Delete the facility “${facility.name}”? This cannot be undone.`)) return;
    setNotice(null);
    setBusy(facility.id);
    setProblem(null);
    try {
      await deleteFacility(company.id, facility.id);
      publish(facilities.filter((f) => f.id !== facility.id));
      setNotice(`Facility “${facility.name}” deleted.`);
    } catch (err) {
      fail(facility.id, err, 'Failed to delete the facility.');
    } finally {
      setBusy(null);
    }
  }

  const problemText = (at: 'add' | number) =>
    problem && problem.at === at ? (
      <p ref={problemRef} tabIndex={-1} role="alert" className="mt-2 text-sm text-risk-high focus:outline-none">
        {problem.message}
        {problem.code === 'facility_has_entries' && (
          <>
            {' '}
            <Link to="/app/calculator" className="underline underline-offset-2">Open the calculator</Link>
          </>
        )}
      </p>
    ) : null;

  return (
    <section id="facilities-settings" aria-labelledby="facilities-settings-title" className="card space-y-4">
      <div>
        <h2 id="facilities-settings-title" className="text-sm font-semibold text-surface-800 dark:text-surface-200">Facilities</h2>
        <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
          {limit === null
            ? `${pluralize(facilities.length, 'facility', 'facilities')}. There is no facility limit on the ${planName} plan.`
            : `${facilities.length} of ${limit} ${limit === 1 ? 'facility' : 'facilities'} used on the ${planName} plan.`}
          {' '}Entries and CSV rows are assigned to a facility by name.
        </p>
      </div>

      {facilities.length === 0 ? (
        <p className="text-sm text-surface-600 dark:text-surface-400">
          No facilities yet. Add your first facility below, then choose it when you add an entry or name it in a CSV.
        </p>
      ) : (
        <ul className="divide-y divide-surface-200 dark:divide-surface-700 border border-surface-200 dark:border-surface-700 rounded-lg">
          {facilities.map((facility) => (
            <li key={facility.id} className="p-3">
              {editingId === facility.id ? (
                <form onSubmit={(e) => handleSaveEdit(e, facility)} noValidate aria-label={`Edit facility ${facility.name}`} className="space-y-3">
                  <DraftFields idPrefix={`facility-${facility.id}`} draft={edit} onChange={setEdit} disabled={busy !== null} />
                  {problemText(facility.id)}
                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary text-xs" disabled={busy !== null}>{busy === facility.id ? 'Saving…' : 'Save facility'}</button>
                    <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={() => { setEditingId(null); setProblem(null); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium text-surface-900 dark:text-white">{facility.name}</span>
                      <span className="text-surface-600 dark:text-surface-400"> · {typeLabel(facility.type)} · {facility.city ?? 'No city'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary text-xs" disabled={busy !== null} aria-label={`Edit facility ${facility.name}`}
                        onClick={() => { setEditingId(facility.id); setEdit({ name: facility.name, type: facility.type ?? '', city: facility.city ?? '' }); setProblem(null); setNotice(null); }}>
                        Edit
                      </button>
                      <button type="button" className="btn-ghost text-xs text-risk-high" disabled={busy !== null} aria-label={`Delete facility ${facility.name}`} onClick={() => handleDelete(facility)}>
                        {busy === facility.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                  {problemText(facility.id)}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {notice && <p role="status" aria-live="polite" className="text-xs text-risk-low">{notice}</p>}

      {atCap || upgrade ? (
        <UpgradePrompt
          feature="More facilities"
          requiredPlan={upgrade?.requiredPlan ?? nextPlanForFacilities(plan.id)}
          reason={upgrade?.message || `Your ${planName} plan includes ${limit} ${limit === 1 ? 'facility' : 'facilities'}.`}
        />
      ) : (
        <form onSubmit={handleAdd} noValidate aria-label="Add a facility" className="space-y-3">
          <h3 className="text-xs font-medium text-surface-700 dark:text-surface-300">Add a facility</h3>
          <DraftFields idPrefix="new-facility" draft={draft} onChange={setDraft} disabled={busy !== null} />
          {problemText('add')}
          <button type="submit" className="btn-primary text-xs" disabled={busy !== null}>{busy === 'add' ? 'Adding…' : 'Add facility'}</button>
        </form>
      )}
    </section>
  );
}
