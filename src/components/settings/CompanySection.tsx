import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompanyOverview } from '@/hooks/useCompanyOverview';
import {
  describeError,
  industryValue,
  parseBaseYear,
  updateCompany,
  type CompanyOverview,
  type CompanyPatch,
} from '@/lib/company';
import UpgradePrompt from '../UpgradePrompt';
import CompanyFields, { type CompanyFieldErrors, type CompanyFieldValues } from '../company/CompanyFields';
import FacilitiesCard from './FacilitiesCard';

function valuesOf(company: CompanyOverview['company']): CompanyFieldValues {
  return {
    name: company.name,
    industry: industryValue(company.industry),
    approach: company.consolidation_approach,
    baseYear: company.base_year === null ? '' : String(company.base_year),
  };
}

function CompanyCard({ overview, onSaved }: { overview: CompanyOverview; onSaved: (next: CompanyOverview) => void }) {
  const company = overview.company;
  const [values, setValues] = useState<CompanyFieldValues>(() => valuesOf(company));
  const [fieldErrors, setFieldErrors] = useState<CompanyFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const saved = valuesOf(company);
  const dirty = (Object.keys(saved) as (keyof CompanyFieldValues)[]).some((key) => saved[key] !== values[key]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    const year = parseBaseYear(values.baseYear);
    const errors: CompanyFieldErrors = {};
    if (!values.name.trim()) errors.name = 'Enter your company name.';
    if (!year.ok) errors.baseYear = year.error;
    setFieldErrors(errors);
    setNotice(null);
    if (errors.name || errors.baseYear || !year.ok) {
      setError('Check the highlighted fields.');
      return;
    }

    // Only what changed: the server validates each field it is sent.
    const patch: CompanyPatch = {};
    if (values.name.trim() !== saved.name) patch.name = values.name.trim();
    if (values.industry !== saved.industry) patch.industry = values.industry || null;
    if (values.approach !== saved.approach) patch.consolidation_approach = values.approach;
    if (values.baseYear.trim() !== saved.baseYear) patch.base_year = year.value;

    setBusy(true);
    setError(null);
    try {
      const result = await updateCompany(company.id, patch);
      onSaved({ ...overview, company: result.company, onboarding: result.onboarding });
      setValues(valuesOf(result.company));
      setNotice('Saved. Reports you generate from now on use these details; reports you already generated are not changed.');
    } catch (err) {
      setError(describeError(err, 'Failed to save your company.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="company-settings" onSubmit={handleSubmit} noValidate aria-busy={busy} aria-labelledby="company-settings-title" className="card space-y-4">
      <div>
        <h2 id="company-settings-title" className="text-sm font-semibold text-surface-800 dark:text-surface-200">Company</h2>
        <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
          Your company name is printed on your reports, and so is the reporting basis below.
        </p>
      </div>

      <CompanyFields idPrefix="settings" values={values} onChange={setValues} errors={fieldErrors} disabled={busy} />

      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-risk-high focus:outline-none">{error}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-surface-200 dark:border-surface-700">
        <p role="status" aria-live="polite" className="text-xs text-risk-low max-w-md">{notice}</p>
        <button type="submit" className="btn-primary text-xs" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save company'}
        </button>
      </div>
    </form>
  );
}

/**
 * Settings > Company and Facilities (F-B-03 = F-C-03): rename the company, choose
 * its reporting basis, and add, rename or delete facilities under the plan's cap.
 * One request loads both cards; each save updates them from its own response.
 */
export default function CompanySection() {
  const { load, retry, replace } = useCompanyOverview();

  if (load.status === 'loading') {
    return (
      <div className="card" role="status">
        <div className="text-sm text-surface-500">Loading company…</div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div role="alert" className="card border-risk-high/30 bg-red-50/50 dark:bg-red-950/20">
        <div className="text-sm text-risk-high">{load.message}</div>
        <button type="button" onClick={retry} className="btn-secondary text-xs mt-3">Try Again</button>
      </div>
    );
  }

  if (load.status === 'paused') {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Company and facilities</h2>
        <UpgradePrompt
          feature="Company and facility settings need an active plan"
          requiredPlan={load.upgrade.requiredPlan}
          reason={load.upgrade.message || 'An active plan is required to change your company and facilities.'}
          trialEnded={load.upgrade.trialEnded}
          trialEndedAt={load.upgrade.trialEndedAt}
        />
        <p className="mt-3 text-center text-xs text-surface-600 dark:text-surface-400">
          Your data is not removed. You can still export it below, or <Link to="/app/pricing" className="underline underline-offset-2">choose a plan</Link>.
        </p>
      </div>
    );
  }

  const { overview } = load;
  return (
    <>
      <CompanyCard overview={overview} onSaved={replace} />
      <FacilitiesCard overview={overview} onChange={replace} />
    </>
  );
}
