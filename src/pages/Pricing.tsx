import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS, ADD_ONS, FEATURE_COMPARISON } from '../data/mockData';
import { createCheckoutSession } from '../lib/stripe';

type BillingCycle = 'monthly' | 'annual';

export default function Pricing() {
  const [billing, setBilling] = useState<BillingCycle>('annual');
  const [showComparison, setShowComparison] = useState(false);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 overflow-y-auto">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Carbon accounting that pays for itself</h1>
        <p className="text-sm text-surface-500 mt-2 leading-relaxed">
          Cheaper than a single consultant engagement. Move from spreadsheet risk to reviewable records.
          Know what is estimated, what is primary, and what is defensible.
        </p>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm font-medium ${billing === 'monthly' ? 'text-surface-800 dark:text-white' : 'text-surface-400'}`}>Monthly</span>
        <button
          onClick={() => setBilling(billing === 'monthly' ? 'annual' : 'monthly')}
          className="relative w-11 h-6 rounded-full transition-colors bg-surface-300 dark:bg-surface-600"
          role="switch"
          aria-checked={billing === 'annual'}
        >
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${billing === 'annual' ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className={`text-sm font-medium ${billing === 'annual' ? 'text-surface-800 dark:text-white' : 'text-surface-400'}`}>
          Annual <span className="text-brand-600 dark:text-brand-400 text-xs font-semibold">Save ~17%</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {([PLANS.starter, PLANS.growth, PLANS.pro]).map((plan) => {
          const price = billing === 'annual' ? plan.annual : plan.monthly;
          const annualMonthly = Math.round(plan.annual / 12);
          const isPopular = plan.id === 'growth';

          return (
            <div key={plan.id} className={`relative card !p-0 flex flex-col ${isPopular ? 'ring-2 ring-brand-500' : ''}`}>
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">{plan.badge}</span>
                </div>
              )}
              <div className="p-5 flex-1">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-surface-900 dark:text-white">{plan.name}</h3>
                  {!isPopular && plan.badge && <span className="badge-gray text-2xs max-w-[120px] text-center">{plan.badge}</span>}
                  {isPopular && <span className="badge-green text-2xs">{plan.badge}</span>}
                </div>
                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-surface-900 dark:text-white">${billing === 'annual' ? annualMonthly : price}</span>
                    <span className="text-sm text-surface-500">/month</span>
                  </div>
                  {billing === 'annual' && (
                    <div className="text-xs text-surface-500 mt-1">
                      ${plan.annual.toLocaleString()}/year · save ${(plan.monthly * 12 - plan.annual).toLocaleString()}
                    </div>
                  )}
                </div>
                <ul className="space-y-2 mb-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
                      <svg className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {f}
                    </li>
                  ))}
                  {plan.locked.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-surface-400 dark:text-surface-600">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M5 3h6M5 7h6M5 11h4" strokeLinecap="round"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-5 pt-0 space-y-2">
                <button
                  onClick={() => createCheckoutSession({ priceId: `${plan.id}_${billing}`, planId: plan.id, billing, trial: plan.trial })}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    isPopular
                      ? 'bg-brand-600 hover:bg-brand-700 text-white'
                      : 'bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-800 dark:text-surface-200'
                  }`}
                >
                  {plan.trial ? 'Start free trial' : 'Get started'}
                </button>
                <button className="w-full py-2 rounded-lg text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
                  Book demo
                </button>
                <p className="text-2xs text-surface-400 text-center mt-1">
                  By signing up, you agree to our <Link to="/terms" className="text-accent hover:underline">Terms</Link> and <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">One-time & Add-on Services</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {ADD_ONS.map((addon) => (
            <div key={addon.id} className="p-3.5 rounded-lg border border-surface-200 dark:border-surface-700 hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
              <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{addon.name}</div>
              <div className="mt-1">
                <span className="text-lg font-bold text-surface-900 dark:text-white">${addon.price.toLocaleString()}</span>
                <span className="text-xs text-surface-500">{addon.unit}</span>
              </div>
              <button className="btn-secondary text-xs mt-2 w-full">Add</button>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={() => setShowComparison(!showComparison)}
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {showComparison ? 'Hide' : 'Show'} full feature comparison
        </button>
      </div>

      {showComparison && (
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-700">
                  <th className="px-4 py-3 text-xs font-semibold text-surface-500 w-48">Feature</th>
                  <th className="px-4 py-3 text-xs font-semibold text-surface-500">Starter</th>
                  <th className="px-4 py-3 text-xs font-semibold text-brand-600 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-900/10">Growth</th>
                  <th className="px-4 py-3 text-xs font-semibold text-surface-500">Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {FEATURE_COMPARISON.map((row) => (
                  <tr key={row.feature} className="hover:bg-surface-50 dark:hover:bg-surface-800/30">
                    <td className="px-4 py-2.5 text-surface-700 dark:text-surface-300 font-medium">{row.feature}</td>
                    <td className="px-4 py-2.5 text-surface-600 dark:text-surface-400">{formatCell(row.starter)}</td>
                    <td className="px-4 py-2.5 bg-brand-50/30 dark:bg-brand-900/5 text-surface-600 dark:text-surface-400">{formatCell(row.growth)}</td>
                    <td className="px-4 py-2.5 text-surface-600 dark:text-surface-400">{formatCell(row.pro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card text-center py-10">
        <h3 className="text-lg font-bold text-surface-900 dark:text-white">Need something different?</h3>
        <p className="text-sm text-surface-500 mt-1 max-w-md mx-auto">
          For organizations with complex requirements, multiple entities, or custom integration needs.
        </p>
        <p className="text-xs text-surface-400 mt-1">EU-facing customers can request a <Link to="/dpa" className="text-accent hover:underline">Data Processing Addendum</Link>.</p>
        <div className="flex items-center justify-center gap-3 mt-4">
          <button className="btn-primary">Talk to sales</button>
          <button className="btn-secondary">Book a demo</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        {[
          { title: 'Get audit-ready without enterprise-software overhead', desc: 'Scope 1–3 tracking, methodology documentation, and reviewable records — without a six-figure platform.' },
          { title: 'Contract readiness, not just compliance', desc: 'Large-company disclosure rules are cascading through supply chains. Be ready when your customers ask.' },
          { title: 'Cheaper than a single consultant engagement', desc: 'Typical consultant fees for a basic GHG inventory: $15K–$40K. Eco-Auditor Growth plan: $3,990/year.' },
        ].map((item) => (
          <div key={item.title} className="card">
            <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{item.title}</h4>
            <p className="text-xs text-surface-500 mt-1.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCell(value: string): React.ReactNode {
  if (value === '✓' || value === '✓ (advanced)') return <span className="text-risk-low font-medium">{value}</span>;
  if (value === '—') return <span className="text-surface-300 dark:text-surface-600">—</span>;
  return value;
}