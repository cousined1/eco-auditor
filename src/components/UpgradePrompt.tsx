import { Link } from 'react-router-dom';
import { PLANS } from '../data/mockData';
import type { PlanId } from '../lib/api';
import { trialEndedHeading, trialEndedMessage } from '../lib/trial';

interface UpgradePromptProps {
  feature: string;
  requiredPlan: PlanId;
  reason?: string;
  /** Renders a centered, larger paywall for full-page gating (e.g. an expired trial). */
  fullPage?: boolean;
  /**
   * The card-free trial ran out and nothing was ever bought. The prompt then names
   * the trial and offers plans ("Choose a plan") instead of an "upgrade" from a
   * plan the person never had; `feature` and `reason` give way to that wording.
   */
  trialEnded?: boolean | undefined;
  /** When the trial ended, shown in the message when known. */
  trialEndedAt?: string | undefined;
}

export default function UpgradePrompt({ feature, requiredPlan, reason, fullPage, trialEnded, trialEndedAt }: UpgradePromptProps) {
  const plan = PLANS[requiredPlan];
  const heading = trialEnded ? trialEndedHeading() : feature;
  const body = trialEnded ? trialEndedMessage(trialEndedAt) : reason;
  return (
    <div
      role="region"
      aria-label={trialEnded ? 'Trial ended' : 'Upgrade required'}
      className={
        (fullPage
          ? 'max-w-md mx-auto p-8 '
          : 'p-6 ') +
        'rounded-lg border border-dashed border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/30 text-center'
      }
    >
      <div className={(fullPage ? 'w-12 h-12 mb-4 ' : 'w-8 h-8 mb-3 ') + 'mx-auto rounded-full bg-surface-200 dark:bg-surface-700 flex items-center justify-center'}>
        <svg className={(fullPage ? 'w-6 h-6 ' : 'w-4 h-4 ') + 'text-surface-600 dark:text-surface-400'} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M8 4v4M8 10h.01M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" strokeLinecap="round"/></svg>
      </div>
      <h2 className={(fullPage ? 'text-lg ' : 'text-sm ') + 'font-semibold text-surface-800 dark:text-surface-200'}>{heading}</h2>
      {body && <p className={(fullPage ? 'text-sm ' : 'text-xs ') + 'text-surface-500 mt-1'}>{body}</p>}
      {!trialEnded && <p className="text-2xs text-surface-600 dark:text-surface-400 mt-1">Available on the {plan.name} plan and above</p>}
      <Link to="/app/pricing" className={(fullPage ? 'text-sm ' : 'text-xs ') + 'btn-primary mt-3 inline-flex'}>
        {trialEnded ? 'Choose a plan' : `Upgrade to ${plan.name}`}
      </Link>
    </div>
  );
}