import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useCompanyOverview } from '@/hooks/useCompanyOverview';
import Onboarding from '../carbon-calculator/Onboarding';

/**
 * The first thing an auto-provisioned company sees (F-B-03). It wraps the routes
 * that would otherwise be the first screen (dashboard, data intake, calculator,
 * reports): while the server says onboarding is pending it shows the onboarding
 * form instead of them; once the customer saves a name or chooses "Finish later",
 * and for every company that is not a placeholder, it renders the route.
 *
 *  - loading: a skeleton, bounded at 15 s by the request itself
 *  - error: a message with "Try again", and a way on, because this check is a
 *    nudge and must not be able to lock anyone out of the app
 *  - paused (402, the trial is over): the route, which shows its own paywall
 */
export default function OnboardingGate() {
  const { load, retry, replace } = useCompanyOverview();
  const [continued, setContinued] = useState(false);

  if (continued) return <Outlet />;

  if (load.status === 'loading') {
    return (
      <div className="p-6 max-w-7xl mx-auto" role="status">
        <span className="sr-only">Loading your workspace…</span>
        <div className="card animate-pulse" aria-hidden="true">
          <div className="h-6 w-48 bg-surface-200 dark:bg-surface-700 rounded mb-4" />
          <div className="h-40 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="sr-only">Eco-Auditor</h1>
        <div className="card border border-risk-high/30" role="alert">
          <h2 className="text-sm font-semibold text-risk-high mb-1">We could not check your workspace</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400">{load.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={retry} className="btn-primary">Try again</button>
            <button type="button" onClick={() => setContinued(true)} className="btn-secondary">Continue to the app</button>
          </div>
        </div>
      </div>
    );
  }

  if (load.status === 'ready' && load.overview.onboarding.needs_onboarding) {
    return <Onboarding overview={load.overview} onDone={replace} />;
  }

  return <Outlet />;
}
