// F-B-10: at the moment a trial ends the product says so. The plan-gate 402 carries
// `reason: 'trial_expired'`; every surface that shows that refusal (Dashboard, CSV
// import, Generate PDF) names the trial, gives its date and offers plans instead of
// asking for "a subscription" from someone who never had one. A 402 without the
// reason, or for a plan limit, keeps its old wording.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportGenerator from '../src/components/carbon-calculator/ReportGenerator';
import UpgradePrompt from '../src/components/UpgradePrompt';
import { getUpgradeRequired } from '../src/lib/api';
import DataIntake from '../src/pages/DataIntake';
import Dashboard from '../src/pages/Dashboard';
import { buttonNamed, press, settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
vi.mock('recharts', async () => import('./helpers/recharts-stub'));

const ENDED_AT = '2026-09-28T12:00:00.000Z';
const ENDED_ON = new Date(ENDED_AT).toLocaleDateString();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// What server-billing.cjs planAccessDecision answers for a company whose trial ended.
const trialExpired = () =>
  json(
    {
      success: false,
      error: 'Your trial has ended. Choose a plan to continue.',
      code: 'upgrade_required',
      requiredPlan: 'starter',
      reason: 'trial_expired',
      trialEndedAt: ENDED_AT,
    },
    402,
  );

// ... and for an account with no plan that never had a trial to end.
const noPlan = () =>
  json({ success: false, error: 'An active subscription is required for this feature', code: 'upgrade_required', requiredPlan: 'starter' }, 402);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? '';
const link = (name: string) => [...container.querySelectorAll('a')].find((a) => a.textContent === name);

async function mount(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
}

describe('getUpgradeRequired reads the ended-trial reason', () => {
  it('reports the trial as ended, with its date', async () => {
    expect(await getUpgradeRequired(trialExpired())).toEqual({
      requiredPlan: 'starter',
      message: 'Your trial has ended. Choose a plan to continue.',
      trialEnded: true,
      trialEndedAt: ENDED_AT,
    });
  });

  it('leaves every other 402 exactly as it was read before', async () => {
    expect(await getUpgradeRequired(noPlan())).toEqual({
      requiredPlan: 'starter',
      message: 'An active subscription is required for this feature',
    });
  });

  it('ignores a reason it does not know and a date that is not a string', async () => {
    const odd = json({ code: 'upgrade_required', requiredPlan: 'growth', reason: 'something_new', trialEndedAt: 5 }, 402);
    expect(await getUpgradeRequired(odd)).toEqual({ requiredPlan: 'growth', message: undefined });
    const noDate = json({ code: 'upgrade_required', requiredPlan: 'starter', reason: 'trial_expired' }, 402);
    expect(await getUpgradeRequired(noDate)).toEqual({ requiredPlan: 'starter', message: undefined, trialEnded: true });
  });
});

describe('UpgradePrompt for an ended trial', () => {
  it('names the trial and offers plans, not an upgrade', async () => {
    await mount(<UpgradePrompt fullPage feature="Your dashboard is a paid feature" requiredPlan="starter" trialEnded trialEndedAt={ENDED_AT} />);

    const region = container.querySelector('[role="region"]')!;
    expect(region.getAttribute('aria-label')).toBe('Trial ended');
    expect(region.querySelector('h2')?.textContent).toBe('Your Starter trial has ended');
    expect(text()).toContain(`Your Starter trial ended on ${ENDED_ON}.`);
    expect(link('Choose a plan')?.getAttribute('href')).toBe('/app/pricing');
    expect(text()).not.toContain('Upgrade to');
    expect(text()).not.toContain('paid feature');
    expect(text()).not.toContain('plan and above');
  });

  it('is the old prompt when the trial has not ended', async () => {
    await mount(<UpgradePrompt feature="CSV import requires an active plan" requiredPlan="growth" reason="Scope 3 needs Growth" />);

    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Upgrade required');
    expect(container.querySelector('h2')?.textContent).toBe('CSV import requires an active plan');
    expect(text()).toContain('Scope 3 needs Growth');
    expect(text()).toContain('Available on the Growth plan and above');
    expect(link('Upgrade to Growth')?.getAttribute('href')).toBe('/app/pricing');
    expect(link('Choose a plan')).toBeUndefined();
  });
});

describe('Dashboard when the trial has ended', () => {
  it('shows the ended-trial paywall with its date, a way to choose a plan, and the export that still works', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => trialExpired()));
    await mount(<Dashboard />);

    expect(container.querySelector('[role="region"] h2')?.textContent).toBe('Your Starter trial has ended');
    expect(text()).toContain(`Your Starter trial ended on ${ENDED_ON}.`);
    expect(link('Choose a plan')?.getAttribute('href')).toBe('/app/pricing');
    expect(link('export your data from Settings')?.getAttribute('href')).toBe('/app/settings');
    // Not the generic paywall, and not the server's sentence (the page writes its own, with the date).
    expect(text()).not.toContain('Your dashboard is a paid feature');
    expect(text()).not.toContain('An active subscription is required');
  });

  it('keeps the generic paywall for an account with no plan that never had a trial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => noPlan()));
    await mount(<Dashboard />);

    expect(text()).toContain('Your dashboard is a paid feature');
    expect(text()).toContain('An active subscription is required for this feature');
    expect(text()).not.toContain('trial');
  });
});

describe('CSV import when the plan gate refuses', () => {
  async function upload(response: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await mount(<DataIntake />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['scope,amount\n1,10'], 'emissions.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'scope,amount\n1,10' });
    Object.defineProperty(input, 'files', { configurable: true, value: { length: 1, item: () => file } });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await settle();
  }

  it('an ended trial gets the ended-trial prompt, not "requires an active plan"', async () => {
    await upload(trialExpired);

    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.querySelector('h2')?.textContent).toBe('Your Starter trial has ended');
    expect(alert.textContent).toContain(`ended on ${ENDED_ON}`);
    expect(link('Choose a plan')?.getAttribute('href')).toBe('/app/pricing');
    expect(text()).not.toContain('requires an active plan');
  });

  it('a plan that is too small is told which plan it needs, not that it has none (an active trial hitting Scope 3)', async () => {
    await upload(() =>
      json(
        {
          success: false,
          code: 'upgrade_required',
          requiredPlan: 'growth',
          error: 'This file contains Scope 3 rows. Scope 3 workflows are included from the growth plan up.',
        },
        402,
      ),
    );

    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.querySelector('h2')?.textContent).toBe('This import needs the Growth plan');
    expect(alert.textContent).toContain('This file contains Scope 3 rows.');
    expect(alert.textContent).not.toContain('requires an active plan');
    expect(link('Upgrade to Growth')?.getAttribute('href')).toBe('/app/pricing');
  });

  it('an account with no plan still reads "requires an active plan"', async () => {
    await upload(noPlan);

    expect(container.querySelector('[role="alert"] h2')?.textContent).toBe('CSV import requires an active plan');
  });
});

describe('Generate PDF when the plan gate refuses', () => {
  const company = { id: 7, name: 'Acme Ltd', industry: 'Retail' };
  const entries = [{ id: 1 }] as never;

  async function generate(response: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await act(async () => root.render(<ReportGenerator company={company} entries={entries} />));
    await press(buttonNamed(container, /^Generate PDF$/));
  }

  const status = () => container.querySelector('[role="status"]');
  const pricingLink = () => status()?.querySelector('a');

  it('says the trial ended, and on which date, and links to the plans', async () => {
    await generate(trialExpired);

    expect(status()?.textContent).toContain(`Your Starter trial ended on ${ENDED_ON}.`);
    expect(pricingLink()?.textContent).toBe('Choose a plan');
    expect(pricingLink()?.getAttribute('href')).toBe('/app/pricing');
  });

  it('keeps the plain requirement otherwise, now with a link instead of "visit Pricing"', async () => {
    await generate(noPlan);

    expect(status()?.textContent).toContain('Reports require an active plan.');
    expect(status()?.textContent).not.toContain('visit Pricing');
    expect(pricingLink()?.getAttribute('href')).toBe('/app/pricing');
  });

  it('offers no plan link after a refusal once a later report goes through', async () => {
    await generate(noPlan);
    expect(pricingLink()).toBeTruthy();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/reports/generate')
          ? json({ success: true, report_id: 'r1', download_url: '/api/reports/r1/download' })
          : new Response('%PDF', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
      ),
    );
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await press(buttonNamed(container, /^Generate PDF$/));

    expect(status()?.textContent).toBe('Report generated and downloaded.');
    expect(pricingLink()).toBeNull();
  });
});
