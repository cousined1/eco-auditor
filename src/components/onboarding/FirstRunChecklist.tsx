import { Link } from 'react-router-dom';
import { useCompanyOverview } from '@/hooks/useCompanyOverview';
import type { Checklist } from '@/lib/company';

interface Step {
  key: keyof Omit<Checklist, 'complete'>;
  label: string;
  links: readonly { to: string; text: string }[];
}

// Each step links to the screen where it is done and ticks from what is stored
// (server-company.cjs buildChecklist), so it un-ticks if the data goes.
const STEPS: readonly Step[] = [
  { key: 'company_named', label: 'Name your company', links: [{ to: '/app/settings', text: 'Company settings' }] },
  { key: 'facility_added', label: 'Add a facility', links: [{ to: '/app/settings', text: 'Facility settings' }] },
  {
    key: 'data_added',
    label: 'Add data',
    links: [
      { to: '/app/intake', text: 'Import a CSV' },
      { to: '/app/calculator', text: 'Add an entry' },
    ],
  },
  { key: 'report_generated', label: 'Generate a report', links: [{ to: '/app/reports', text: 'Go to Reports' }] },
];

/**
 * The first-run checklist (F-B-03, F-C-03): name the company, add a facility, add
 * data, generate a report. Shown on the dashboard until all four are true.
 */
export function FirstRunChecklist({ checklist }: { checklist: Checklist }) {
  const done = STEPS.filter((step) => checklist[step.key]).length;
  return (
    <section aria-labelledby="first-run-title" className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="first-run-title" className="text-sm font-semibold text-surface-800 dark:text-surface-200">Finish setting up</h2>
        <p className="text-xs text-surface-600 dark:text-surface-400">{done} of {STEPS.length} done</p>
      </div>
      <ol className="mt-3 space-y-2">
        {STEPS.map((step) => {
          const ticked = checklist[step.key];
          return (
            <li key={step.key} className="flex items-start gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className={
                  'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-2xs leading-none ' +
                  (ticked
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-surface-400 dark:border-surface-500 text-transparent')
                }
              >
                ✓
              </span>
              <span className="sr-only">{ticked ? 'Done: ' : 'To do: '}</span>
              <span className={ticked ? 'text-surface-600 dark:text-surface-400' : 'text-surface-900 dark:text-white font-medium'}>
                {step.label}
              </span>
              {/* A real space, so the text reads "Name your company · Company settings" (the flex gap is only visual). */}
              {' '}
              <span className="text-surface-600 dark:text-surface-400">
                {step.links.map((link, i) => (
                  <span key={link.to}>
                    {i === 0 ? '· ' : ' or '}
                    <Link to={link.to} className="underline underline-offset-2 text-brand-700 dark:text-brand-300">
                      {link.text}
                    </Link>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The checklist for the dashboard: loads the company overview itself and shows
 * nothing while it loads, when it fails, when the plan is paused, or once all four
 * steps are done. The dashboard never waits on it.
 */
export default function DashboardChecklist() {
  const { load } = useCompanyOverview();
  if (load.status !== 'ready' || load.overview.checklist.complete) return null;
  return <FirstRunChecklist checklist={load.overview.checklist} />;
}
