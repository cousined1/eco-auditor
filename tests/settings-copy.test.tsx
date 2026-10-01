// F-C-25 / F-A-09 / F-A-20 on the Settings page. A card-free trial read
// "trialing | Starter | $149/month | Renews -": a price nobody is charged and a
// renewal that does not exist. The data-controls card said "your workspace data"
// for an export that holds the company row, the facilities and the entry rows.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFacts } from '../src/content/data-facts';
import { trialHeadline, trialLimitsLabel } from '../src/content/pricing';
import Settings from '../src/pages/Settings';
import { buttonNamed, press, settle } from './helpers/form-dom';

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), exportMyData: vi.fn(), deleteMyData: vi.fn(), hasSession: vi.fn(() => true) }));
vi.mock('../src/lib/api', () => api);
vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
// Company and Facilities (K5) load their own data; this test is about the billing card.
vi.mock('../src/components/settings/CompanySection', () => ({ default: () => null }));
vi.mock('../src/lib/stripe', () => ({
  cancelSubscription: vi.fn(),
  changeSubscription: vi.fn(),
  createBillingPortalSession: vi.fn(),
}));

const FUTURE = '2030-10-14T00:00:00Z';
const day = (iso: string) => new Date(iso).toLocaleDateString();

const CARD_FREE_TRIAL = {
  active: true,
  plan: 'starter',
  status: 'trialing',
  trialActive: true,
  trialEndsAt: FUTURE,
  currentPeriodEnd: null,
  billingCycle: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

const STRIPE_TRIAL = {
  ...CARD_FREE_TRIAL,
  plan: 'growth',
  trialActive: false,
  trialEndsAt: null,
  currentPeriodEnd: FUTURE,
  billingCycle: 'monthly',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
};

const PAID = { ...STRIPE_TRIAL, status: 'active' };

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
  vi.unstubAllGlobals();
});

async function mountWith(billing: unknown) {
  api.apiFetch.mockResolvedValue(new Response(JSON.stringify(billing), { status: 200 }));
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    ),
  );
  await settle();
  return container.textContent ?? '';
}

describe('billing card for a card-free trial', () => {
  it('names it a Starter trial, with its end date and limits, and shows no price or renewal', async () => {
    const text = await mountWith(CARD_FREE_TRIAL);

    expect(text).toContain('Free trial');
    expect(text).toContain('Starter trial');
    expect(text).toContain('Trial ends');
    expect(text).toContain(day(FUTURE));
    expect(text).toContain('No charge during the trial');
    // The wording is the claims agent's: built from pricing.ts, which reads plan-limits.json.
    expect(text).toContain(`You are on the ${trialHeadline()}`);
    expect(text).toContain(`Trial limits: ${trialLimitsLabel()}`);

    expect(text).not.toMatch(/\$\d+\/month/);
    expect(text).not.toContain('Renews');
    expect(text).not.toContain('trialing');
  });
});

describe('billing card for a Stripe trial and a paid plan', () => {
  it('a Stripe trial is a trial of the plan chosen, and still renews', async () => {
    const text = await mountWith(STRIPE_TRIAL);

    expect(text).toContain('Growth trial');
    expect(text).toContain('Free trial');
    expect(text).toContain('$399/month');
    expect(text).toContain('Renews');
    expect(text).toContain(day(FUTURE));
    // The Starter-limits notice is for the card-free trial only.
    expect(text).not.toContain('Trial limits');
  });

  it('a paid plan reads as before: plan name, status, price, renewal', async () => {
    const text = await mountWith(PAID);

    expect(text).toContain('active');
    expect(text).toContain('Growth');
    expect(text).not.toContain('Growth trial');
    expect(text).toContain('$399/month');
    expect(text).toContain('Renews');
  });
});

describe('data controls card (F-A-20)', () => {
  it('says what the export holds and what deleting leaves, not "your workspace data"', async () => {
    const text = await mountWith(PAID);

    // VF-4, VF-2: the words come from src/content/data-facts.ts, the one source the legal pages render too.
    expect(text).toContain(`machine-readable JSON copy of your ${dataFacts.export.contents} at any time`);
    expect(text).not.toContain('workspace data');
    expect(text).toContain(`Deleting removes all ${dataFacts.deleteAuditData.removes} immediately`);
    expect(text).toContain(`${dataFacts.deleteAuditData.reports}.`);
    expect(text).toContain(`Your ${dataFacts.deleteAuditData.leaves} are not affected`);
    expect(text).toContain('full account deletion is available via support');
  });

  it('the confirmation and the notice after a deletion say the report copies stay (VF-2)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.deleteMyData.mockResolvedValue({ ok: true, data: {} });
    await mountWith(PAID);

    await press(buttonNamed(container, /^Delete my audit data$/));
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0]?.[0])).toContain(`${dataFacts.deleteAuditData.reports}.`);
    expect(container.textContent).toContain(`has been deleted. ${dataFacts.deleteAuditData.reports}.`);
    confirm.mockRestore();
  });
});
