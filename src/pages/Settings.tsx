import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY, FACILITIES, BILLING_SUBSCRIPTION, INVOICES, PAYMENT_METHOD, PLANS } from '../data/mockData';
import { cancelSubscription, changeSubscription, createBillingPortalSession } from '../lib/stripe';

export default function Settings() {
  const [activeSection, setActiveSection] = useState<'general' | 'team' | 'billing' | 'templates' | 'notifications'>('general');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const handlePortalSession = async () => {
    setBillingError(null);
    const result = await createBillingPortalSession();
    if (result.ok) {
      window.location.href = result.data.url;
    } else {
      setBillingError(result.error);
    }
  };

  const handleChangePlan = async (planId: string, billingCycle: 'monthly' | 'annual') => {
    setBillingError(null);
    const result = await changeSubscription(planId, billingCycle);
    if (result.ok) {
      setShowChangePlan(false);
      window.location.reload();
    } else {
      setBillingError(result.error);
    }
  };

  const handleCancel = async () => {
    setBillingError(null);
    const result = await cancelSubscription();
    if (result.ok) {
      setShowCancelConfirm(false);
      window.location.reload();
    } else {
      setBillingError(result.error);
    }
  };

  const sub = BILLING_SUBSCRIPTION;
  const currentPlan = PLANS[sub.plan];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">Settings</h1>
        <p className="text-sm text-surface-500 mt-0.5">Manage your organization, team, and preferences</p>
      </div>

      <div className="flex gap-2 text-xs border-b border-surface-200 dark:border-surface-700">
        {(['general', 'team', 'billing', 'templates', 'notifications'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSection(tab)}
            className={`px-4 py-2.5 font-medium capitalize border-b-2 transition-colors ${
              activeSection === tab ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-surface-500'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeSection === 'general' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Organization</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-surface-500 mb-1">Company Name</label>
                <input className="input" defaultValue={COMPANY.name} />
              </div>
              <div>
                <label className="block text-xs text-surface-500 mb-1">Industry</label>
                <select className="input" defaultValue="food-beverage">
                  <option value="food-beverage">Food & Beverage</option>
                  <option value="light-manufacturing">Light Manufacturing</option>
                  <option value="generic-smb">Generic SMB</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-surface-500 mb-1">Revenue Band</label>
                <input className="input" defaultValue={COMPANY.revenue} />
              </div>
            </div>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Facilities</h3>
            <div className="space-y-2">
              {FACILITIES.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <div>
                    <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{f.name}</div>
                    <div className="text-2xs text-surface-500">{f.city} · {f.type}</div>
                  </div>
                  <button className="btn-ghost text-xs">Edit</button>
                </div>
              ))}
              <button className="btn-secondary text-xs w-full mt-2">+ Add Facility</button>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'team' && (
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Team Members</h3>
          <div className="space-y-2">
            {[
              { name: 'Sarah Chen', email: 'sarah@northstarfoods.com', role: 'Sustainability Lead', initials: 'SC' },
              { name: 'Tom Bradley', email: 'tom@northstarfoods.com', role: 'CFO', initials: 'TB' },
              { name: 'Maria Gonzalez', email: 'maria@northstarfoods.com', role: 'Operations Manager', initials: 'MG' },
            ].map((member) => (
              <div key={member.email} className="flex items-center gap-3 p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-xs font-semibold text-brand-700 dark:text-brand-300">{member.initials}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{member.name}</div>
                  <div className="text-2xs text-surface-500">{member.email} · {member.role}</div>
                </div>
                <button className="btn-ghost text-xs">Manage</button>
              </div>
            ))}
          </div>
          <button className="btn-secondary text-xs w-full mt-3">+ Invite Team Member</button>
        </div>
      )}

      {activeSection === 'billing' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Current Plan</h3>
              <span className={`badge ${sub.status === 'active' ? 'badge-green' : sub.status === 'trialing' ? 'badge-blue' : 'badge-gray'}`}>{sub.status}</span>
            </div>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="text-lg font-bold text-surface-900 dark:text-white">{currentPlan.name}</div>
                <div className="text-xs text-surface-500 mt-0.5">
                  {sub.billing === 'annual' ? `$${sub.annualRate.toLocaleString()}/year` : `$${sub.monthlyRate}/month`}
                  {sub.billing === 'annual' && ` · $${Math.round(sub.annualRate / 12)}/mo equivalent`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-surface-500">Renews</div>
                <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{sub.currentPeriodEnd}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <div className="text-2xs text-surface-500">Facilities</div>
                <div className="text-sm font-medium text-surface-800 dark:text-surface-200">3 / 5</div>
              </div>
              <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <div className="text-2xs text-surface-500">Uploads this month</div>
                <div className="text-sm font-medium text-surface-800 dark:text-surface-200">8 / Unlimited</div>
              </div>
              <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <div className="text-2xs text-surface-500">Team members</div>
                <div className="text-sm font-medium text-surface-800 dark:text-surface-200">3 / 5</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowChangePlan(!showChangePlan)} className="btn-primary text-xs">Change plan</button>
              <button onClick={handlePortalSession} className="btn-secondary text-xs">Manage billing portal</button>
              <button onClick={() => setShowCancelConfirm(true)} className="btn-ghost text-xs text-risk-high">Cancel subscription</button>
            </div>
            {billingError && (
              <div className="mt-2 p-2.5 rounded-lg bg-risk-high/10 border border-risk-high/20 text-xs text-risk-high">{billingError}</div>
            )}
            <p className="text-2xs text-surface-400 mt-2">By continuing, you agree to our <Link to="/terms" className="text-accent hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.</p>
          </div>

          {showChangePlan && (
            <div className="card border-brand-200 dark:border-brand-800">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Switch Plan</h3>
              <div className="space-y-2">
                {([PLANS.starter, PLANS.growth, PLANS.pro]).map((plan) => (
                  <div key={plan.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${plan.id === sub.plan ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-surface-200 dark:border-surface-700 hover:border-brand-300'}`}>
                    <div>
                      <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{plan.name}</div>
                      <div className="text-2xs text-surface-500">${plan.annual.toLocaleString()}/yr or ${plan.monthly}/mo</div>
                    </div>
                    {plan.id === sub.plan ? (
                      <span className="badge-green">Current</span>
                    ) : (
                      <button
                        onClick={() => handleChangePlan(plan.id, sub.billing)}
                        className={plan.monthly > currentPlan.monthly ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                      >
                        {plan.monthly > currentPlan.monthly ? 'Upgrade' : 'Downgrade'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-2xs text-surface-400 mt-3">Plan changes take effect at the end of your current billing period. Prorated credits apply for upgrades.</p>
            </div>
          )}

          {showCancelConfirm && (
            <div className="card border-risk-high/30 bg-red-50/50 dark:bg-red-950/20">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Cancel subscription?</h3>
              <p className="text-xs text-surface-600 dark:text-surface-400 mb-3">
                You will lose access to paid features at the end of your current period ({sub.currentPeriodEnd}).
                Your historical emissions data and reports will be preserved for 90 days.
              </p>
              <div className="flex gap-2">
                <button onClick={handleCancel} className="text-xs px-3 py-1.5 rounded-lg bg-risk-high text-white font-medium">Confirm cancellation</button>
                <button onClick={() => setShowCancelConfirm(false)} className="btn-secondary text-xs">Keep my plan</button>
              </div>
            </div>
          )}

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Payment Method</h3>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-7 rounded bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-xs font-bold text-surface-600 dark:text-surface-400">{PAYMENT_METHOD.brand}</div>
                <div>
                  <div className="text-sm font-medium text-surface-800 dark:text-surface-200">•••• {PAYMENT_METHOD.last4}</div>
                  <div className="text-2xs text-surface-500">Expires {PAYMENT_METHOD.expiry}</div>
                </div>
              </div>
              <button className="btn-ghost text-xs">Update</button>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Invoice History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                    <th className="pb-2 font-medium">Invoice</th>
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Plan</th>
                    <th className="pb-2 font-medium">Amount</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                  {INVOICES.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2.5 font-medium text-surface-800 dark:text-surface-200">{inv.id}</td>
                      <td className="py-2.5 text-surface-600 dark:text-surface-400">{inv.date}</td>
                      <td className="py-2.5 text-surface-600 dark:text-surface-400">{inv.plan}</td>
                      <td className="py-2.5 font-medium text-surface-800 dark:text-surface-200">{inv.amount}</td>
                      <td className="py-2.5"><span className="badge-green">{inv.status}</span></td>
                      <td className="py-2.5"><button className="btn-ghost text-xs">Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">Stripe Webhook Events</h3>
            <p className="text-2xs text-surface-500 mb-3">Configure these webhook endpoints in your Stripe dashboard to sync subscription state.</p>
            <div className="space-y-2">
              {[
                { event: 'checkout.session.completed', desc: 'Triggered when a customer completes checkout', status: 'configured' },
                { event: 'customer.subscription.updated', desc: 'Triggered on plan changes, upgrades, downgrades', status: 'configured' },
                { event: 'customer.subscription.deleted', desc: 'Triggered when a subscription is canceled', status: 'configured' },
                { event: 'invoice.paid', desc: 'Triggered when an invoice payment succeeds', status: 'configured' },
                { event: 'invoice.payment_failed', desc: 'Triggered when an invoice payment fails', status: 'configured' },
              ].map((wh) => (
                <div key={wh.event} className="flex items-center justify-between p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <div>
                    <code className="text-xs font-mono text-surface-800 dark:text-surface-200">{wh.event}</code>
                    <div className="text-2xs text-surface-500 mt-0.5">{wh.desc}</div>
                  </div>
                  <span className="badge-green">{wh.status}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <div className="text-2xs font-medium text-surface-500 mb-1">Webhook endpoint</div>
              <code className="text-xs font-mono text-surface-800 dark:text-surface-200 break-all">https://api.eco-auditor.app/webhooks/stripe</code>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'templates' && (
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Industry Templates</h3>
          <p className="text-xs text-surface-500 mb-4">Choose a template to preconfigure categories, suppliers, data sources, and reporting views.</p>
          <div className="space-y-3">
            {[
              { name: 'Food & Beverage', desc: 'Multi-facility, refrigeration, packaging, ingredient sourcing, freight', active: true },
              { name: 'Light Manufacturing', desc: 'Facility energy, purchased materials, freight, vendor data', active: false },
              { name: 'Generic SMB', desc: 'Basic energy, commute, cloud services, shipping', active: false },
            ].map((t) => (
              <div key={t.name} className={`p-4 rounded-lg border-2 transition-colors ${t.active ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-surface-200 dark:border-surface-700'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{t.name}</div>
                    <div className="text-xs text-surface-500 mt-0.5">{t.desc}</div>
                  </div>
                  {t.active ? <span className="badge-green">Active</span> : <button className="btn-secondary text-xs">Apply</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSection === 'notifications' && (
        <div className="card">
          <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Notification Preferences</h3>
          <div className="space-y-3">
            {[
              { label: 'Missing data alerts', desc: 'Notify when confidence drops below 70%', enabled: true },
              { label: 'Supplier response reminders', desc: 'Send follow-ups for overdue requests', enabled: true },
              { label: 'Compliance deadline warnings', desc: 'Alert 30 days before filing dates', enabled: true },
              { label: 'Weekly emissions summary', desc: 'Email digest every Monday', enabled: false },
              { label: 'Variance alerts', desc: 'Notify when quarterly emissions change >10%', enabled: true },
            ].map((pref) => (
              <div key={pref.label} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{pref.label}</div>
                  <div className="text-2xs text-surface-500">{pref.desc}</div>
                </div>
                <div className={`relative w-9 h-5 rounded-full cursor-pointer transition-colors ${pref.enabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${pref.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}