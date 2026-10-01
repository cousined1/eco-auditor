import { Link, useLocation } from 'react-router-dom';
import { useBillingState } from '../hooks/useBillingState';
import { trialPillModel } from '../lib/trial';

// The card-free trial in the app header: "Starter trial: 9 days left", and
// "Starter trial ended" once it has run out. It links to the plans. Renders
// nothing for a paid plan, a Stripe trial, or when the billing state is not known.
// The plan name is left out below the sm breakpoint so the pill fits a phone header.
export default function TrialPill() {
  const { pathname } = useLocation();
  const model = trialPillModel(useBillingState(true, pathname));
  if (!model) return null;

  const ended = model.kind === 'ended';
  return (
    <Link
      to="/app/pricing"
      title={model.detail}
      aria-label={`${model.label}. ${ended ? 'Choose a plan' : 'View plans'}`}
      className={
        'min-w-0 truncate whitespace-nowrap rounded-full border px-2 py-1 text-2xs font-medium transition-colors sm:px-2.5 ' +
        (ended
          ? 'border-risk-high/20 bg-risk-high/10 text-risk-high hover:bg-risk-high/20'
          : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40')
      }
    >
      <span className="max-sm:hidden">{model.label}</span>
      <span className="sm:hidden">{model.shortLabel}</span>
    </Link>
  );
}
