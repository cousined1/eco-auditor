import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS } from '../data/mockData';
import { cancelSubscription, changeSubscription, createBillingPortalSession, getAuthToken } from '../lib/stripe';

interface BillingState {
  active: boolean;
  plan: 'starter' | 'growth' | 'pro' | null;
  status: string | null;
  trialActive: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  billingCycle: 'monthly' | 'annual' | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export default function Settings() {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  // Guards the money-path buttons. Without it a double-click fired two
  // DELETE /api/subscription or two prorated PATCH /api/subscription calls.
  const [billingBusy, setBillingBusy] = useState(false);

  useEffect(() => {
    async function loadBilling() {
      setBillingLoading(true);
      setBillingError(null);
      try {
        const token = await getAuthToken();
        if (!token) {
          setBillingError('You must be signed in to view billing.');
          setBillingLoading(false);
          return;
        }
        const res = await fetch('/api/billing', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setBillingError(body.error || 'Failed to load billing state.');
          setBillingLoading(false);
          return;
        }
        const data = await res.json();
        setBilling(data);
      } catch (err) {
        setBillingError(err instanceof Error ? err.message : 'Failed to load billing state.');
      } finally {
        setBillingLoading(false);
      }
    }
    loadBilling();
  }, []);

  const handlePortalSession = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingError(null);
    const result = await createBillingPortalSession();
    if (result.ok) {
      window.location.href = result.data.url;
    } else {
      setBillingError(result.error);
      setBillingBusy(false);
    }
  };

  const handleChangePlan = async (planId: string, billingCycle: 'monthly' | 'annual') => {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingError(null);
    const result = await changeSubscription(planId, billingCycle);
    if (result.ok) {
      setShowChangePlan(false);
      window.location.reload();
    } else {
      setBillingError(result.error);
      setBillingBusy(false);
    }
  };

  const handleCancel = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingError(null);
    const result = await cancelSubscription();
    if (result.ok) {
      setShowCancelConfirm(false);
      window.location.reload();
    } else {
      setBillingError(result.error);
      setBillingBusy(false);
    }
  };

  const currentPlan = billing?.plan ? PLANS[billing.plan] : null;
  const billingCycle = billing?.billingCycle ?? 'monthly';
  const monthlyRate = currentPlan?.monthly ?? 0;
  const annualRate = currentPlan?.annual ?? 0;
  const formattedPeriodEnd = billing?.currentPeriodEnd
    ? new Date(billing.currentPeriodEnd).toLocaleDateString()
    : '—';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Settings</h1>
        <p className="text-sm text-surface-500 mt-0.5">Manage your billing and subscription</p>
      </div>

      <div className="space-y-4">
          {billingLoading && (
            <div className="card">
              <div className="text-sm text-surface-500">Loading billing...</div>
            </div>
          )}

          {billingError && !billingLoading && (
            <div className="card border-risk-high/30 bg-red-50/50 dark:bg-red-950/20">
              <div className="text-sm text-risk-high">{billingError}</div>
            </div>
          )}

          {!billingLoading && !billingError && billing && (
            <>
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Current Plan</h3>
                  <span className={`badge ${billing.status === 'active' ? 'badge-green' : billing.status === 'trialing' ? 'badge-blue' : 'badge-gray'}`}>
                    {billing.status || 'inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1">
                    <div className="text-lg font-bold text-surface-900 dark:text-white">{currentPlan?.name || '—'}</div>
                    <div className="text-xs text-surface-500 mt-0.5">
                      {billingCycle === 'annual' ? `$${annualRate.toLocaleString()}/year` : `$${monthlyRate}/month`}
                      {billingCycle === 'annual' && ` · $${Math.round(annualRate / 12)}/mo equivalent`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-surface-500">Renews</div>
                    <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{formattedPeriodEnd}</div>
                  </div>
                </div>
                {billing.trialActive && (
                  <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 mb-4">
                    <div className="text-xs text-brand-700 dark:text-brand-300">
                      You are on a trial {billing.trialEndsAt ? `ending on ${new Date(billing.trialEndsAt).toLocaleDateString()}` : ''}.
                    </div>
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
                <p className="text-2xs text-surface-600 dark:text-surface-400 mt-2">By continuing, you agree to our <Link to="/terms" className="text-accent-text hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-accent-text hover:underline">Privacy Policy</Link>.</p>
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
      </div>
  );
}