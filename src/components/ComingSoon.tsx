import { Link } from 'react-router-dom';

type ComingSoonProps = {
  readonly featureName: string;
};

export function ComingSoon({ featureName }: ComingSoonProps) {
  return (
    <div className="min-h-[calc(100vh-57px)] p-6">
      <section className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-2xl border border-surface-200 bg-white px-6 py-16 text-center shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <span className="mb-4 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
          Coming soon
        </span>
        <h1 className="text-2xl font-semibold text-surface-900 dark:text-white">{featureName}</h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-surface-600 dark:text-surface-400">
          {featureName} is on our roadmap and is not available yet. It will appear here when it launches.
        </p>
        <Link to="/app" className="btn-primary mt-6">
          Back to dashboard
        </Link>
      </section>
    </div>
  );
}
