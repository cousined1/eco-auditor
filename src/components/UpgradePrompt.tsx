import { Link } from 'react-router-dom';
import { PLANS } from '../data/mockData';

interface UpgradePromptProps {
  feature: string;
  requiredPlan: 'growth' | 'pro';
  reason?: string;
}

export default function UpgradePrompt({ feature, requiredPlan, reason }: UpgradePromptProps) {
  const plan = PLANS[requiredPlan];
  return (
    <div className="rounded-lg border border-dashed border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/30 p-6 text-center">
      <div className="w-8 h-8 mx-auto rounded-full bg-surface-200 dark:bg-surface-700 flex items-center justify-center mb-3">
        <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M8 4v4M8 10h.01M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" strokeLinecap="round"/></svg>
      </div>
      <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{feature}</h4>
      {reason && <p className="text-xs text-surface-500 mt-1">{reason}</p>}
      <p className="text-2xs text-surface-400 mt-1">Available on the {plan.name} plan and above</p>
      <Link to="/pricing" className="btn-primary text-xs mt-3 inline-flex">
        Upgrade to {plan.name}
      </Link>
    </div>
  );
}