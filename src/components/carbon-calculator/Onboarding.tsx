import { useEffect, useRef, useState } from 'react';
import { FACILITY_TYPES, type FacilityType } from '@/lib/entries';
import {
  FACILITY_FIELD_MAX,
  addFacility,
  describeError,
  getCompanyOverview,
  parseBaseYear,
  skipOnboarding,
  updateCompany,
  type CompanyFacility,
  type CompanyOverview,
  type CompanyPatch,
} from '@/lib/company';
import CompanyFields, { FIELD_CLASS, LABEL_CLASS, type CompanyFieldErrors, type CompanyFieldValues } from '../company/CompanyFields';

interface Props {
  /** The company as the server provisioned it: a placeholder name, no facilities. */
  overview: CompanyOverview;
  /** Called with the overview the saved answers make, so the caller can carry on without another request. */
  onDone: (next: CompanyOverview) => void;
}

type Saved = Awaited<ReturnType<typeof updateCompany>>;

const EMPTY: CompanyFieldValues = { name: '', industry: '', approach: 'unspecified', baseYear: '' };

/**
 * First-run onboarding (F-B-03): the screen an auto-provisioned company sees before
 * the dashboard or the calculator. It used to render only when no company row existed,
 * which the server made impossible by creating "<email-prefix> Organization" on the
 * first call. Company name, industry, the reporting basis, and an optional first
 * facility; "Finish later" leaves the placeholder and keeps the dashboard checklist.
 * Everything goes through the server API (plan cap, ownership, validation).
 */
export default function Onboarding({ overview, onDone }: Props) {
  const [values, setValues] = useState<CompanyFieldValues>(EMPTY);
  const [facilityName, setFacilityName] = useState('');
  const [facilityType, setFacilityType] = useState<FacilityType | ''>('');
  const [facilityCity, setFacilityCity] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CompanyFieldErrors>({});
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The company is saved but its first facility was not: the form gives way to a
  // choice, and a retry repeats only the facility.
  const [saved, setSaved] = useState<Saved | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // The screen replaces whatever was loading: announce it, like a page change.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const company = overview.company;
  const trimmedFacility = facilityName.trim();
  const trimmedCity = facilityCity.trim();

  function finish(result: Saved, created?: CompanyFacility) {
    onDone({
      ...overview,
      company: result.company,
      onboarding: result.onboarding,
      facilities: created ? [...overview.facilities, created] : overview.facilities,
    });
  }

  async function createFirstFacility(result: Saved, retry: boolean) {
    if (!facilityType) return;
    try {
      // After a failed attempt the server may still have stored the facility (the
      // answer can be the part that was lost): look before adding it a second time.
      const existing = retry
        ? (await getCompanyOverview()).facilities.find(
            (f) => f.name.toLowerCase() === trimmedFacility.toLowerCase() && (f.city ?? '').toLowerCase() === trimmedCity.toLowerCase(),
          )
        : undefined;
      const created = existing ?? (await addFacility(company.id, { name: trimmedFacility, type: facilityType, city: trimmedCity }));
      finish(result, created);
    } catch (err) {
      setSaved(result);
      setError(`Your company was saved, but the facility was not added: ${describeError(err, 'Something went wrong.')}`);
      setBusy(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const year = parseBaseYear(values.baseYear);
    const errors: CompanyFieldErrors = {};
    if (!values.name.trim()) errors.name = 'Enter your company name.';
    if (!year.ok) errors.baseYear = year.error;
    setFieldErrors(errors);
    if (errors.name || errors.baseYear) {
      setError('Check the highlighted fields.');
      return;
    }
    // The facility route needs all three; say so before the company is saved.
    if (trimmedFacility && (!facilityType || !trimmedCity)) {
      setError('Add the facility type and city, or leave the facility name empty to add one later.');
      return;
    }
    setBusy('save');
    setError(null);

    const patch: CompanyPatch = { name: values.name.trim(), consolidation_approach: values.approach };
    if (values.industry) patch.industry = values.industry;
    if (year.ok && year.value !== null) patch.base_year = year.value;
    let result: Saved;
    try {
      result = await updateCompany(company.id, patch);
    } catch (err) {
      setError(describeError(err, 'Failed to save your company.'));
      setBusy(null);
      return;
    }
    if (trimmedFacility && facilityType) {
      await createFirstFacility(result, false);
      return;
    }
    finish(result);
  }

  async function handleSkip() {
    if (busy) return;
    setBusy('skip');
    setError(null);
    try {
      const onboarding = await skipOnboarding(company.id);
      onDone({ ...overview, onboarding });
    } catch (err) {
      setError(describeError(err, 'Could not save that choice.'));
      setBusy(null);
    }
  }

  if (saved) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="card space-y-4">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-surface-900 dark:text-white focus:outline-none">
            Your company is saved
          </h1>
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-risk-high focus:outline-none">{error}</p>
          )}
          <p className="text-sm text-surface-600 dark:text-surface-400">
            You can add the facility again now, or continue and add it later in Settings.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => finish(saved)}>
              Continue without a facility
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('save');
                setError(null);
                await createFirstFacility(saved, true);
              }}
            >
              {busy === 'save' ? 'Adding…' : 'Try adding the facility again'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="card space-y-4" aria-busy={busy !== null} noValidate>
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-surface-900 dark:text-white focus:outline-none">
            Welcome to Eco-Auditor
          </h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Name your company and add a first facility to start tracking emissions. You can change all of this later in Settings.
          </p>
        </div>

        <CompanyFields idPrefix="onboarding" values={values} onChange={setValues} errors={fieldErrors} disabled={busy !== null} />

        <div>
          <label htmlFor="onboarding-facility-name" className={LABEL_CLASS}>First facility</label>
          <input
            id="onboarding-facility-name"
            type="text"
            value={facilityName}
            onChange={(e) => setFacilityName(e.target.value)}
            maxLength={FACILITY_FIELD_MAX}
            disabled={busy !== null}
            placeholder="e.g., Main Office (optional)"
            className={FIELD_CLASS}
          />
        </div>

        {trimmedFacility && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="onboarding-facility-type" className={LABEL_CLASS}>
                Facility type <span className="text-risk-high" aria-hidden="true">*</span>
              </label>
              <select
                id="onboarding-facility-type"
                value={facilityType}
                onChange={(e) => setFacilityType(e.target.value as FacilityType | '')}
                required
                disabled={busy !== null}
                className={FIELD_CLASS}
              >
                <option value="">Select type</option>
                {FACILITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="onboarding-facility-city" className={LABEL_CLASS}>
                City <span className="text-risk-high" aria-hidden="true">*</span>
              </label>
              <input
                id="onboarding-facility-city"
                type="text"
                value={facilityCity}
                onChange={(e) => setFacilityCity(e.target.value)}
                maxLength={FACILITY_FIELD_MAX}
                required
                disabled={busy !== null}
                placeholder="e.g., Sacramento"
                className={FIELD_CLASS}
              />
            </div>
          </div>
        )}

        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-risk-high focus:outline-none">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-surface-200 dark:border-surface-700">
          <div>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={handleSkip}>
              {busy === 'skip' ? 'Saving…' : 'Finish later'}
            </button>
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">A setup checklist stays on your dashboard until you are done.</p>
          </div>
          <button type="submit" className="btn-primary" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
