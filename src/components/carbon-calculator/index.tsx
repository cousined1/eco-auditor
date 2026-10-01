import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { insforge } from '@/lib/insforge';
import type { UpgradeRequired } from '@/lib/api';
import { UpgradeRequiredError, createEntry, deleteEntry, listEntries, planIncludesScope3, updateEntry, type EntryPatch } from '@/lib/entries';
import { pluralize } from '@/lib/format';
import { RequestTimeoutError, withDeadline } from '@/lib/requestTimeout';
import UpgradePrompt from '../UpgradePrompt';
import EmissionForm, { type EmissionFormData } from './EmissionForm';
import EmissionList from './EmissionList';
import EmissionsDashboard from './EmissionsDashboard';
import ReportGenerator from './ReportGenerator';
import type { Company, Facility, EmissionEntry } from './utils';

export default function CarbonCalculator() {
  const [company, setCompany] = useState<Company | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [entries, setEntries] = useState<EmissionEntry[]>([]);
  const [scope3Allowed, setScope3Allowed] = useState<boolean | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeRequired | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Entries are read from the server (GET /api/entries), not the records API:
  // its CO2e per row is the one the dashboard counts, and the plan gate pauses
  // the calculator with the rest of the app when a trial ends.
  const loadEntries = useCallback(async () => {
    setEntries(await listEntries());
  }, []);

  useEffect(() => {
    // cancelled: a retry or unmount replaced this run. abandoned: it gave up at
    // its deadline. Either way the request may still complete later, and a late
    // answer must not overwrite what the screen shows now.
    let cancelled = false;
    let abandoned = false;
    const isStale = () => cancelled || abandoned;

    async function loadData() {
      setLoading(true);
      setError(null);
      setUpgrade(null);
      try {
        // Bounded: a hung request used to leave the skeleton up forever. The
        // database client takes no AbortSignal, so the deadline abandons the
        // request rather than cancelling it (the server calls do take it).
        await withDeadline(async (signal) => {
          const { data } = await insforge.auth.getCurrentUser();
          if (isStale()) return;
          const user = data?.user;
          if (!user) {
            setError('Not authenticated.');
            setLoading(false);
            return;
          }

          const { data: companyData, error: companyError } = await insforge.database
            .from('companies')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

          if (isStale()) return;
          if (companyError) throw companyError;

          if (!companyData) {
            // No company row yet: nothing to calculate for. The server creates it on
            // the first authenticated call and onboarding names it (OnboardingGate);
            // the page below says to come back through the dashboard.
            setLoading(false);
            return;
          }

          setCompany(companyData as Company);

          // Same contract as the company query above: a failed facilities read
          // must surface through setError, not silently render an empty list
          // that looks like "no facilities yet".
          const { data: facilityData, error: facilityError } = await insforge.database
            .from('facilities')
            .select('*')
            .eq('company_id', (companyData as Company).id);

          if (isStale()) return;
          if (facilityError) throw facilityError;

          setFacilities((facilityData as Facility[]) ?? []);
          const [loadedEntries, includesScope3] = await Promise.all([listEntries(signal), planIncludesScope3(signal)]);
          if (isStale()) return;
          setEntries(loadedEntries);
          setScope3Allowed(includesScope3);
        });
      } catch (err) {
        if (cancelled) return;
        // The plan gate (trial over, no subscription): the calculator is
        // paused like the dashboard, which is not a load failure.
        if (err instanceof UpgradeRequiredError) {
          setUpgrade(err.upgrade);
          return;
        }
        abandoned = true;
        setError(
          err instanceof RequestTimeoutError
            ? 'Loading took too long. Check your connection and try again.'
            : err instanceof Error
              ? err.message
              : 'Failed to load data',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // The server computes CO2e, the factor, its dataset and the confidence from
  // the activity alone, and checks the plan (Scope 3, trial end) before it
  // stores anything. A 402 comes back as UpgradeRequiredError for the form.
  async function handleSubmit(data: EmissionFormData) {
    if (!company) return;
    await createEntry(
      {
        scope: data.scope,
        category: data.category,
        source: data.source,
        amount: data.amount,
        unit: data.unit,
        activity_date: data.activityDate,
        facility_id: data.facilityId,
      },
      data.idempotencyKey,
    );
    await loadEntries();
  }

  async function handleDelete(id: number) {
    await deleteEntry(id);
    await loadEntries();
  }

  // The server recomputes the CO2e from the new activity, stamps updated_at and keeps
  // the old values in the entry's history (F-B-17). Bounded at 15 s like the page's
  // other requests; a timeout reaches the dialog as an error with the form intact.
  async function handleUpdate(id: number, patch: EntryPatch) {
    const updated = await withDeadline((signal) => updateEntry(id, patch, signal));
    await loadEntries();
    return updated;
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="card animate-pulse">
          <div className="h-6 w-48 bg-surface-200 dark:bg-surface-700 rounded mb-4" />
          <div className="h-40 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="sr-only">Carbon Calculator</h1>
        <div className="card border border-risk-high/30" role="alert">
          <h2 className="text-sm font-semibold text-risk-high mb-1">Unable to load calculator</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400">{error}</p>
          <button type="button" onClick={() => setLoadAttempt((n) => n + 1)} className="btn-primary mt-4">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (upgrade) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="sr-only">Carbon Calculator</h1>
        <div className="py-12">
          <UpgradePrompt
            fullPage
            feature="The calculator needs an active plan"
            requiredPlan={upgrade.requiredPlan}
            reason={upgrade.message || 'Your trial has ended. Reactivate a plan to add and review emission entries.'}
          />
          {/* Export is not plan-gated (server.cjs /api/account/export), so this stays true. */}
          <p className="mt-4 text-center text-sm text-surface-600 dark:text-surface-400">
            You can still{' '}
            <Link to="/app/settings" className="underline underline-offset-2 text-brand-700 dark:text-brand-300">
              export your data from Settings
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="sr-only">Carbon Calculator</h1>
        <div className="card" role="status">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-1">Your workspace is not set up yet</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400">
            Open the dashboard once to finish setting it up, then come back to the calculator.
          </p>
          <Link to="/app" className="btn-primary mt-4 inline-flex">Go to the dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* flex-wrap and nowrap: beside the 240px sidebar at tablet width these
          badges used to wrap to "0 / Facilities" and "3 / Entries". */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">
            Carbon Calculator
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            Track and calculate emissions for {company.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-blue whitespace-nowrap">{pluralize(facilities.length, 'facility', 'facilities')}</span>
          <span className="badge-green whitespace-nowrap">{pluralize(entries.length, 'entry', 'entries')}</span>
        </div>
      </div>

      <EmissionForm facilities={facilities} onSubmit={handleSubmit} scope3Allowed={scope3Allowed} />
      <EmissionsDashboard entries={entries} facilities={facilities} />
      <EmissionList entries={entries} facilities={facilities} onDelete={handleDelete} onUpdate={handleUpdate} />
      <ReportGenerator company={company} entries={entries} />
    </div>
  );
}
