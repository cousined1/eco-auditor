import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS } from '../data/mockData';
import { cancelSubscription, changeSubscription, createBillingPortalSession } from '../lib/stripe';
import { apiFetch, deleteMyData, exportMyData, hasSession } from '../lib/api';
import type { BillingState } from '../lib/billingState';
import { insforge } from '../lib/insforge';
import CompanySection from '../components/settings/CompanySection';
import { RequestTimeoutError, withDeadline } from '../lib/requestTimeout';
import { trialEndedMessage } from '../lib/trial';
import { dataFacts } from '@/content/data-facts';
import { trialHeadline, trialLimitsLabel, TRIAL_PLAN_ID } from '@/content/pricing';

type BillingLoad = { kind: 'loaded'; billing: BillingState } | { kind: 'failed'; message: string };

// Everything the billing card needs, fetched under one signal. It sets no state, so a
// run that outlives its deadline can never write into a screen that has already moved
// on to an error or a retry (the same shape as the Dashboard's loadDashboard).
async function loadBilling(signal: AbortSignal): Promise<BillingLoad> {
  if (!hasSession()) return { kind: 'failed', message: 'You must be signed in to view billing.' };
  const res = await apiFetch('/api/billing', { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { kind: 'failed', message: body.error || 'Failed to load billing state.' };
  }
  return { kind: 'loaded', billing: (await res.json()) as BillingState };
}

export default function Settings() {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState(false);
  // Why the billing state could not be loaded. Replaces the billing card, so it
  // carries a retry.
  const [billingError, setBillingError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Why a portal, plan-change or cancel request failed. Shown beside the buttons,
  // with the billing card kept on screen: sharing billingError with the load error
  // used to swap the whole card for a red box, buttons and all (F-B-10/K16).
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorRef = useRef<HTMLParagraphElement>(null);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  // Guards the money-path buttons. Without it a double-click fired two
  // DELETE /api/subscription or two prorated PATCH /api/subscription calls.
  const [billingBusy, setBillingBusy] = useState(false);
  // Data controls (DATA-005): self-serve export + audit-data deletion.
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    // Aborted on unmount and on retry, so a superseded request never touches state.
    const controller = new AbortController();

    const run = async () => {
      setBillingLoading(true);
      setBillingError(null);
      try {
        // Bounded (F-B-15): a stalled connection used to leave "Loading billing..." on
        // screen forever, with no error and no way to retry.
        const result = await withDeadline(loadBilling, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.kind === 'loaded') setBilling(result.billing);
        else setBillingError(result.message);
      } catch (err) {
        if (controller.signal.aborted) return;
        setBillingError(
          err instanceof RequestTimeoutError
            ? 'Loading your billing details took too long. Check your connection and try again.'
            : err instanceof Error
              ? err.message
              : 'Failed to load billing state.',
        );
      } finally {
        if (!controller.signal.aborted) setBillingLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [loadAttempt]);

  // Move focus to a failed action's message so it is announced and scrolled into view.
  useEffect(() => {
    if (actionError) actionErrorRef.current?.focus();
  }, [actionError]);

  const handlePortalSession = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setActionError(null);
    const result = await createBillingPortalSession();
    if (result.ok) {
      window.location.href = result.data.url;
    } else {
      setActionError(result.error);
      setBillingBusy(false);
    }
  };

  const handleChangePlan = async (planId: string, billingCycle: 'monthly' | 'annual') => {
    if (billingBusy) return;
    setBillingBusy(true);
    setActionError(null);
    const result = await changeSubscription(planId, billingCycle);
    if (result.ok) {
      setShowChangePlan(false);
      window.location.reload();
    } else {
      setActionError(result.error);
      setBillingBusy(false);
    }
  };

  const handleCancel = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setActionError(null);
    const result = await cancelSubscription();
    if (result.ok) {
      setShowCancelConfirm(false);
      window.location.reload();
    } else {
      setActionError(result.error);
      setBillingBusy(false);
    }
  };

  const handleExportData = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setDataError(null);
    setDataNotice(null);
    const result = await exportMyData(insforge);
    if (result.ok) {
      // Download the JSON in the browser: the request needs the bearer token,
      // so we cannot just navigate to the endpoint.
      const url = URL.createObjectURL(result.data.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.data.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDataNotice('Your data export has been downloaded as a machine-readable JSON file.');
    } else {
      setDataError(result.error);
    }
    setExportBusy(false);
  };

  const handleDeleteData = async () => {
    if (deleteBusy) return;
    // VF-2: the confirmation is where the customer decides, so it says what the deletion leaves.
    const confirmed = window.confirm(
      `This permanently deletes all ${dataFacts.deleteAuditData.removes} in your workspace. This cannot be undone. ` +
        `${dataFacts.deleteAuditData.reports}. ` +
        'Your login and account stay active; full account deletion is available via support. Continue?'
    );
    if (!confirmed) return;
    setDeleteBusy(true);
    setDataError(null);
    setDataNotice(null);
    const result = await deleteMyData(insforge);
    if (result.ok) {
      setDataNotice(`Your audit data (emissions entries and facilities) has been deleted. ${dataFacts.deleteAuditData.reports}. Your account remains active.`);
    } else {
      setDataError(result.error);
    }
    setDeleteBusy(false);
  };

  const currentPlan = billing?.plan ? PLANS[billing.plan] : null;
  const billingCycle = billing?.billingCycle ?? 'monthly';
  const monthlyRate = currentPlan?.monthly ?? 0;
  const annualRate = currentPlan?.annual ?? 0;
  const formattedPeriodEnd = billing?.currentPeriodEnd
    ? new Date(billing.currentPeriodEnd).toLocaleDateString()
    : '—';
  const formattedTrialEnd = billing?.trialEndsAt
    ? new Date(billing.trialEndsAt).toLocaleDateString()
    : '—';
  // F-C-25: a card-free trial (`trialActive`) has no subscription, so it has no
  // price and nothing to renew. The card used to show the plan's monthly price and
  // "Renews —" for it, under the raw status "trialing". `status === 'trialing'`
  // also covers a Stripe trial started from a monthly plan, which does renew.
  const isTrialing = billing?.status === 'trialing';
  // F-B-10: the card-free trial ran out and nothing was ever bought. The card used to
  // read "inactive | — | $0/month"; it now says the trial ended, when, and what to do.
  const trialEnded = billing?.trialEnded === true;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Settings</h1>
        <p className="text-sm text-surface-500 mt-0.5">Manage your company, facilities, billing, subscription, and data</p>
      </div>

      {/* Company and facilities (F-B-03): rename the company, choose its reporting
          basis, add and edit facilities. First, so the dashboard checklist's links
          land on it. */}
      <CompanySection />

      <div className="space-y-4">
          {billingLoading && (
            <div className="card">
              <div className="text-sm text-surface-500">Loading billing...</div>
            </div>
          )}

          {billingError && !billingLoading && (
            <div role="alert" className="card border-risk-high/30 bg-red-50/50 dark:bg-red-950/20">
              <div className="text-sm text-risk-high">{billingError}</div>
              <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="btn-secondary text-xs mt-3">
                Try Again
              </button>
            </div>
          )}

          {!billingLoading && !billingError && billing && (
            <>
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Current Plan</h3>
                  <span className={`badge ${billing.status === 'active' ? 'badge-green' : isTrialing ? 'badge-blue' : trialEnded ? 'badge-amber' : 'badge-gray'}`}>
                    {isTrialing ? 'Free trial' : trialEnded ? 'Trial ended' : billing.status || 'inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1">
                    <div className="text-lg font-bold text-surface-900 dark:text-white">
                      {currentPlan
                        ? (isTrialing ? `${currentPlan.name} trial` : currentPlan.name)
                        : trialEnded ? `${PLANS[TRIAL_PLAN_ID].name} trial ended` : 'No active plan'}
                    </div>
                    <div className="text-xs text-surface-500 mt-0.5">
                      {!currentPlan
                        ? (trialEnded ? `Ended on ${formattedTrialEnd}` : 'Choose a plan to continue')
                        : billing.trialActive
                          ? 'No charge during the trial'
                          : billingCycle === 'annual' ? `$${annualRate.toLocaleString()}/year` : `$${monthlyRate}/month`}
                      {currentPlan && !billing.trialActive && billingCycle === 'annual' && ` · $${Math.round(annualRate / 12)}/mo equivalent`}
                    </div>
                  </div>
                  {/* Nothing to renew or end when there is no plan: the line under the title says what happened. */}
                  {currentPlan && (
                    <div className="text-right">
                      <div className="text-xs text-surface-500">{billing.trialActive ? 'Trial ends' : 'Renews'}</div>
                      <div className="text-sm font-medium text-surface-800 dark:text-surface-200">
                        {billing.trialActive ? formattedTrialEnd : formattedPeriodEnd}
                      </div>
                    </div>
                  )}
                </div>
                {billing.trialActive && (
                  <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 mb-4">
                    <div className="text-xs text-brand-700 dark:text-brand-300">
                      You are on the {trialHeadline()}{billing.trialEndsAt ? `, ending on ${formattedTrialEnd}` : ''}. Trial limits: {trialLimitsLabel()}.
                    </div>
                  </div>
                )}
                {trialEnded && (
                  <div className="p-3 rounded-lg bg-risk-high/10 border border-risk-high/20 mb-4">
                    {/* Export is not plan-gated (server.cjs /api/account/export), so this stays true. */}
                    <div className="text-xs text-risk-high">{trialEndedMessage(billing.trialEndsAt)} You can still export your data below.</div>
                  </div>
                )}
                {billing.cancelAtPeriodEnd && (
                  <div className="p-3 rounded-lg bg-risk-high/10 border border-risk-high/20 mb-4">
                    <div className="text-xs text-risk-high">Your subscription will cancel at the end of the current period.</div>
                  </div>
                )}
                {/* A card-free trial has no Stripe subscription, so the
                    portal / change / cancel routes all 404 with "No active
                    subscription". Offering them to the most common visitor was
                    a guaranteed dead end -- send them to checkout instead. */}
                <div className="flex gap-2">
                  <button onClick={() => setShowChangePlan(!showChangePlan)} className="btn-primary text-xs">
                    {billing.stripeSubscriptionId ? 'Change plan' : 'Choose a plan'}
                  </button>
                  {billing.stripeSubscriptionId && (
                    <>
                      <button onClick={handlePortalSession} disabled={billingBusy} className="btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed">Manage billing portal</button>
                      <button onClick={() => setShowCancelConfirm(true)} disabled={billingBusy} className="btn-ghost text-xs text-risk-high disabled:opacity-50 disabled:cursor-not-allowed">Cancel subscription</button>
                    </>
                  )}
                </div>
                {actionError && (
                  <p
                    ref={actionErrorRef}
                    role="alert"
                    tabIndex={-1}
                    className="mt-3 p-2.5 rounded-lg bg-risk-high/10 border border-risk-high/20 text-sm text-risk-high focus:outline-none focus-visible:ring-2 focus-visible:ring-risk-high/40"
                  >
                    {actionError}
                  </p>
                )}
                <p className="text-2xs text-surface-600 dark:text-surface-400 mt-2">By continuing, you agree to our <Link to="/terms/" className="text-accent-text hover:underline">Terms of Service</Link> and <Link to="/privacy/" className="text-accent-text hover:underline">Privacy Policy</Link>.</p>
              </div>

              {showChangePlan && (
                <div className="card border-brand-200 dark:border-brand-800">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Switch Plan</h3>
                  <div className="space-y-2">
                    {([PLANS.starter, PLANS.growth, PLANS.pro]).map((plan) => (
                      <div key={plan.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${plan.id === billing.plan ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-surface-200 dark:border-surface-700 hover:border-brand-300'}`}>
                        <div>
                          <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{plan.name}</div>
                          <div className="text-2xs text-surface-500">${plan.annual.toLocaleString()}/yr or ${plan.monthly}/mo</div>
                        </div>
                        {plan.id === billing.plan ? (
                          <span className="badge-green">Current</span>
                        ) : !billing.stripeSubscriptionId ? (
                          // No subscription yet: PATCH would 404. Start checkout.
                          <Link
                            to={`/app?checkout=${plan.id}_${billingCycle}`}
                            className="btn-primary text-xs"
                          >
                            Subscribe
                          </Link>
                        ) : (
                          <button
                            onClick={() => handleChangePlan(plan.id, billingCycle)}
                            disabled={billingBusy}
                            className={`${plan.monthly > (currentPlan?.monthly ?? 0) ? 'btn-primary text-xs' : 'btn-secondary text-xs'} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {plan.monthly > (currentPlan?.monthly ?? 0) ? 'Upgrade' : 'Downgrade'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-2xs text-surface-600 dark:text-surface-400 mt-3">Plan changes take effect according to Stripe billing terms. Any applicable charges or credits will appear on your next invoice.</p>
                </div>
              )}

              {showCancelConfirm && (
                <div className="card border-risk-high/30 bg-red-50/50 dark:bg-red-950/20">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Cancel subscription?</h3>
                  <p className="text-xs text-surface-600 dark:text-surface-400 mb-3">
                    You will lose access to paid features at the end of your current period ({formattedPeriodEnd}).
                  </p>
                  <div className="flex gap-2">
                    <button onClick={handleCancel} disabled={billingBusy} className="text-xs px-3 py-1.5 rounded-lg bg-risk-high text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                      {billingBusy ? 'Cancelling…' : 'Confirm cancellation'}
                    </button>
                    <button onClick={() => setShowCancelConfirm(false)} className="btn-secondary text-xs">Keep my plan</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      {/* DATA-005: self-serve data controls. Export downloads a machine-readable
          JSON export; delete removes the workspace's audit data (emissions
          entries and facilities) immediately — the account itself stays, and
          full account deletion remains a support-assisted request. */}
      <div className="card">
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Data controls</h3>
        {/* F-A-20, VF-2, VF-4: says what the export holds and what the deletion removes and
            leaves, in the words the Privacy Policy, Security page and DPA render from
            src/content/data-facts.ts (tests hold them to server.cjs). Generated reports
            are not part of the deletion. */}
        <p className="text-xs text-surface-600 dark:text-surface-400 mb-4">
          Download a machine-readable JSON copy of your {dataFacts.export.contents} at any time,
          or delete your audit data. Deleting removes all {dataFacts.deleteAuditData.removes} immediately and cannot be undone.{' '}
          {dataFacts.deleteAuditData.reports}. Your {dataFacts.deleteAuditData.leaves} are not affected, and
          full account deletion is available via support.
        </p>
        <div className="flex gap-2">
          <button onClick={handleExportData} disabled={exportBusy} className="btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed">
            {exportBusy ? 'Exporting…' : 'Export my data'}
          </button>
          <button onClick={handleDeleteData} disabled={deleteBusy} className="btn-ghost text-xs text-risk-high disabled:opacity-50 disabled:cursor-not-allowed">
            {deleteBusy ? 'Deleting…' : 'Delete my audit data'}
          </button>
        </div>
        {dataNotice && (
          <div className="mt-3 p-3 rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
            <div className="text-xs text-brand-700 dark:text-brand-300">{dataNotice}</div>
          </div>
        )}
        {dataError && (
          <div className="mt-3 p-3 rounded-lg border border-risk-high/20 bg-risk-high/10">
            <div className="text-xs text-risk-high">{dataError}</div>
          </div>
        )}
      </div>
      </div>
  );
}