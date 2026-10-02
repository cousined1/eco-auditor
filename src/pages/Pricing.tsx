import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PLANS, ADD_ONS, FEATURE_COMPARISON, TRIAL_DAYS, type PlanId } from '@/content/pricing';
import routeMeta from '@/content/route-meta.json';
import { useBillingState } from '../hooks/useBillingState';
import { hasSession } from '../lib/api';
import { createCheckoutSession } from '../lib/stripe';

// AF-1: PRICING_SCHEMA is built from pricing.ts so JSON-LD prices always match
// the UI prices and the salesbot KB. pricing.ts is the single source of truth.
const PLAN_ORDER = ['starter', 'growth', 'pro'] as const;
const PRICING_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Eco-Auditor Pricing Plans",
  "description": "Carbon accounting plans for small and mid-size businesses. Starter through Pro plans for emissions inventories.",
  "itemListElement": PLAN_ORDER.map((id, i) => ({
    "@type": "ListItem",
    "position": i + 1,
    "item": {
      "@type": "Product",
      "name": PLANS[id].name,
      "description": `${PLANS[id].name} plan`,
      "offers": { "@type": "Offer", "price": String(PLANS[id].monthly), "priceCurrency": "USD", "billingIncrement": "P1M" },
    },
  })),
};

// Title and description come from src/content/route-meta.json, the file the
// prerender step writes into the HTML, so raw and JS-rendered meta agree.
const PRICING_META = routeMeta['/pricing'];
const HOME_META = routeMeta['/'];

type BillingCycle = 'monthly' | 'annual';

// `embedded`: rendered inside the app shell (/app/pricing). The 240px sidebar leaves the content
// column ~528px wide at tablet width, so the plan grid waits for a wider viewport there (F-C-27).
export default function Pricing({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  // Monthly first: the trial is only offered on monthly billing, so an annual
  // default hid it behind small grey text (F-C-10).
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [showComparison, setShowComparison] = useState(false);
  // The error is kept with the plan whose button was clicked so it renders
  // under that button, where the user is looking. It used to render below the
  // whole plan grid, ~2,000 px down on a phone, so a failed checkout looked like
  // a dead button (F-B-11).
  const [checkoutError, setCheckoutError] = useState<{ planId: PlanId; message: string } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Plan id whose checkout is in flight, or null. Blocks double-submit.
  const [checkoutPending, setCheckoutPending] = useState<string | null>(null);
  // Inside the app the visitor is signed in, so the server can say whether a free
  // trial is still on offer (F-B-18). The public page is cached and the same for
  // everyone, so it keeps the trial wording; checkout decides either way.
  const trialUsed = useBillingState(embedded)?.trialEligible === false;

  useEffect(() => {
    document.title = PRICING_META.title;

    const meta = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (meta) meta.content = PRICING_META.description;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(PRICING_SCHEMA);
    document.head.appendChild(script);

    return () => {
      document.title = HOME_META.title;
      if (meta) meta.content = HOME_META.description;
      document.head.removeChild(script);
    };
  }, []);

  // Move focus to the error so it is announced (role="alert") and scrolled into view.
  useEffect(() => {
    if (checkoutError) errorRef.current?.focus();
  }, [checkoutError]);

  const handleCheckout = async (planId: PlanId, billingCycle: BillingCycle, trial: boolean | undefined) => {
    // Without this guard a double-click created two Stripe checkout sessions
    // before window.location.assign won the race.
    if (checkoutPending) return;
    setCheckoutPending(planId);
    setCheckoutError(null);
    if (!hasSession()) {
      navigate(`/signup?plan=${planId}&billing=${billingCycle}`);
      return;
    }
    const result = await createCheckoutSession({ priceId: `${planId}_${billingCycle}`, planId, billing: billingCycle, trial });
    if (result.ok) {
      window.location.assign(result.data.url);
    } else {
      setCheckoutError({ planId, message: result.error });
      setCheckoutPending(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 overflow-y-auto">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Plans for your first GHG inventory</h1>
        <p className="text-sm text-surface-500 mt-2 leading-relaxed">
          Import activity data by CSV and download a PDF emissions summary.
          Every plan lists what works today; items marked Soon are on our roadmap and not available yet.
        </p>
      </div>

      <div className="flex items-center justify-center gap-3" aria-live="polite">
        <span className={`text-sm font-medium ${billing === 'monthly' ? 'text-surface-800 dark:text-white' : 'text-surface-600 dark:text-surface-400'}`}>Monthly</span>
        <button
          type="button"
          onClick={() => setBilling(billing === 'monthly' ? 'annual' : 'monthly')}
          className={`relative w-11 h-6 rounded-full transition-colors ${billing === 'annual' ? 'bg-brand-600' : 'bg-surface-500'}`}
          role="switch"
          aria-checked={billing === 'annual'}
          aria-label={`Billing: ${billing === 'annual' ? 'annual (save ~17%)' : 'monthly'}`}
        >
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${billing === 'annual' ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className={`text-sm font-medium ${billing === 'annual' ? 'text-surface-800 dark:text-white' : 'text-surface-600 dark:text-surface-400'}`}>
          Annual <span className="text-brand-600 dark:text-brand-400 text-xs font-semibold">Save ~17%</span>
        </span>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${embedded ? 'xl:grid-cols-3' : 'md:grid-cols-3'}`}>
        {([PLANS.starter, PLANS.growth, PLANS.pro]).map((plan) => {
          const price = billing === 'annual' ? plan.annual : plan.monthly;
          const annualMonthly = Math.round(plan.annual / 12);
          const isPopular = plan.id === 'growth';
          // Server only honors trials on monthly billing (TRIAL_ELIGIBLE_PLANS in server.cjs)
          const trialEligible = Boolean(plan.trial) && billing === 'monthly' && !trialUsed;

          return (
            <div key={plan.id} className={`relative card !p-0 flex flex-col ${isPopular ? 'ring-2 ring-brand-500' : ''}`}>
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">{plan.badge}</span>
                </div>
              )}
              <div className="p-5 flex-1">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-surface-900 dark:text-white">{plan.name}</h2>
                  {/* The recommended plan's badge is the pill above the card: one badge, not two. */}
                  {!isPopular && plan.badge && <span className="badge-gray text-2xs max-w-[120px] text-center">{plan.badge}</span>}
                </div>
                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-surface-900 dark:text-white">${billing === 'annual' ? annualMonthly : price}</span>
                    <span className="text-sm text-surface-500">/month</span>
                  </div>
                  {billing === 'monthly' && (
                    <div className="text-xs text-surface-500 mt-1">${price}/month, billed monthly</div>
                  )}
                  {billing === 'annual' && (
                    <div className="text-xs text-surface-500 mt-1">
                      ${annualMonthly}/month equivalent · ${plan.annual.toLocaleString()}/year billed annually · save ${(plan.monthly * 12 - plan.annual).toLocaleString()} vs monthly
                    </div>
                  )}
                  {plan.trial && (
                    <div className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                      {trialUsed
                        ? 'Free trial already used · billing starts at checkout'
                        : billing === 'monthly'
                          ? `${TRIAL_DAYS}-day free trial, once per company · a card is required to start it`
                          : 'Free trial available on monthly billing'}
                    </div>
                  )}
                </div>
                <ul className="space-y-2 mb-4">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
                      <svg className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span><span className="sr-only">Included: </span>{f}</span>
                    </li>
                  ))}
                </ul>
                {plan.locked.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-2">Not included</h3>
                    <ul className="space-y-2">
                      {plan.locked.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-400">
                          <svg className="w-4 h-4 text-surface-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan.roadmap.length > 0 && (
                  <div className="mt-1 pt-4 border-t border-surface-200 dark:border-surface-700">
                    <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">On the roadmap</h3>
                    <ul className="space-y-2">
                      {plan.roadmap.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-surface-500 dark:text-surface-500">
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700">Soon</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="p-5 pt-0 space-y-2">
                <button
                  type="button"
                  onClick={() => handleCheckout(plan.id, billing, trialEligible)}
                  disabled={checkoutPending !== null}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isPopular
                      ? 'bg-brand-600 hover:bg-brand-700 text-white'
                      : 'bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-800 dark:text-surface-200'
                  }`}
                >
                  {checkoutPending === plan.id
                    ? 'Redirecting…'
                    : trialEligible ? 'Start free trial' : trialUsed ? 'Subscribe' : 'Get started'}
                </button>
                {checkoutError?.planId === plan.id && (
                  <p
                    ref={errorRef}
                    role="alert"
                    tabIndex={-1}
                    className="p-2.5 rounded-lg bg-risk-high/10 border border-risk-high/20 text-sm text-risk-high focus:outline-none focus-visible:ring-2 focus-visible:ring-risk-high/40"
                  >
                    {checkoutError.message}
                  </p>
                )}
                <Link to="/demo/" className="block w-full py-2 rounded-lg text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-center">
                  Book a Demo
                </Link>
                <p className="text-2xs text-surface-600 dark:text-surface-400 text-center mt-1">
                  By signing up, you agree to our <Link to="/terms/" className="text-accent-text hover:underline">Terms</Link> and <Link to="/privacy/" className="text-accent-text hover:underline">Privacy Policy</Link>.
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ADD_ONS.map((addon) => (
            <div key={addon.id} className="p-3.5 rounded-lg border border-surface-200 dark:border-surface-700 hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
              <div className="text-sm font-medium text-surface-800 dark:text-surface-200">{addon.name}</div>
              <div className="mt-1">
                <span className="text-lg font-bold text-surface-900 dark:text-white">${addon.price.toLocaleString()}</span>
                <span className="text-xs text-surface-500">{addon.unit}</span>
              </div>
              {/* Was a bare "Add" button with no handler — a purchase-shaped
                  control in the money path that silently did nothing. These
                  add-ons have no Stripe products, so route to sales instead of
                  implying self-serve checkout. */}
              <Link to="/contact/?topic=sales" className="btn-secondary text-xs mt-2 w-full text-center block">
                Talk to sales
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center">
        <button
          type="button"
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
        <h2 className="text-lg font-bold text-surface-900 dark:text-white">Need something different?</h2>
        <p className="text-sm text-surface-500 mt-1 max-w-md mx-auto">
          For organizations with complex requirements, multiple entities, or custom integration needs.
        </p>
        <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">EU-facing customers can request a <Link to="/dpa/" className="text-accent-text hover:underline">Data Processing Addendum</Link>.</p>
        <div className="flex items-center justify-center gap-3 mt-4">
          <Link to="/contact/" className="btn-primary">Talk to sales</Link>
          <Link to="/demo/" className="btn-secondary">Book a Demo</Link>
        </div>
      </div>
    </div>
  );
}

function formatCell(value: string): React.ReactNode {
  if (value === '✓' || value === '✓ (advanced)') return <span className="text-risk-low font-medium">{value}</span>;
  // A dash alone is invisible at low contrast and says nothing to a screen reader.
  if (value === '—') return <><span aria-hidden="true" className="text-surface-600 dark:text-surface-400">—</span><span className="sr-only">Not included</span></>;
  if (value === 'Roadmap') return <span className="text-xs text-surface-600 dark:text-surface-400">Roadmap</span>;
  return value;
}
