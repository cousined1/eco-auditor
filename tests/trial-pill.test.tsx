// F-B-10: the card-free trial in the app header. "Starter trial: N days left" while it
// runs, "Starter trial ended" after, nothing for anyone else. The state comes from
// GET /api/billing through apiFetch (the SDK token is attached there, nowhere else).
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrialPill from '../src/components/TrialPill';
import { notifyBillingChanged, onBillingChanged } from '../src/lib/billingState';
import { verifyCheckoutSession } from '../src/lib/stripe';
import { settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({
  insforge: { getHttpClient: () => ({ getHeaders: () => ({ Authorization: 'Bearer pill-token' }) }) },
}));

const NOW = new Date('2026-09-30T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A card-free trial with nine days to run, as GET /api/billing returns it.
const billing = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  plan: 'starter',
  status: 'trialing',
  trialActive: true,
  trialEndsAt: at(9),
  trialEnded: false,
  trialEligible: true,
  currentPeriodEnd: null,
  billingCycle: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  source: 'db',
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
let navigate: ((to: string) => void) | undefined;

function Capture() {
  const go = useNavigate();
  useEffect(() => {
    navigate = go;
  }, [go]);
  return null;
}

async function mount() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/app']}>
        <Capture />
        <TrialPill />
      </MemoryRouter>,
    ),
  );
  await settle();
}

const pill = () => container.querySelector('a');
const labels = () => [...(pill()?.querySelectorAll('span') ?? [])].map((span) => span.textContent);

function stubBilling(respond: () => Response | Promise<Response>) {
  const fetchStub = vi.fn<typeof fetch>(async () => respond());
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Only the clock the countdown reads; React's and the test's own timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  navigate = undefined;
});

describe('the trial pill', () => {
  it('counts the days left on a running card-free trial and links to the plans', async () => {
    stubBilling(() => json(billing()));
    await mount();

    expect(labels()).toEqual(['Starter trial: 9 days left', 'Trial: 9 days left']);
    expect(pill()?.getAttribute('href')).toBe('/app/pricing');
    expect(pill()?.getAttribute('aria-label')).toBe('Starter trial: 9 days left. View plans');
    expect(pill()?.getAttribute('title')).toBe(`Your Starter trial ends on ${new Date(at(9)).toLocaleDateString()}.`);
  });

  it('asks the billing endpoint through apiFetch: same-origin path, the SDK token attached there', async () => {
    const fetchStub = stubBilling(() => json(billing()));
    await mount();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe('/api/billing');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pill-token');
  });

  it('says the trial ended, and offers a plan', async () => {
    stubBilling(() => json(billing({ active: false, plan: null, status: null, trialActive: false, trialEndsAt: at(-2), trialEnded: true, trialEligible: false })));
    await mount();

    expect(labels()).toEqual(['Starter trial ended', 'Trial ended']);
    expect(pill()?.getAttribute('aria-label')).toBe('Starter trial ended. Choose a plan');
    expect(pill()?.getAttribute('title')).toBe(`Your Starter trial ended on ${new Date(at(-2)).toLocaleDateString()}.`);
  });

  it('reads "1 day left" on the last day', async () => {
    stubBilling(() => json(billing({ trialEndsAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString() })));
    await mount();

    expect(labels()[0]).toBe('Starter trial: 1 day left');
  });

  it.each([
    ['a paying customer', billing({ plan: 'growth', status: 'active', trialActive: false, trialEndsAt: at(-30), trialEligible: false, stripeSubscriptionId: 'sub_1' })],
    ['a Stripe trial', billing({ plan: 'growth', status: 'trialing', trialActive: false, trialEndsAt: at(-30), trialEligible: false, stripeSubscriptionId: 'sub_1' })],
    ['a cancelled subscriber', billing({ active: false, plan: null, status: 'canceled', trialActive: false, trialEndsAt: at(-30), trialEligible: false })],
    ['a trial with no end date (no database, company not provisioned yet)', billing({ trialEndsAt: null })],
  ])('shows nothing for %s', async (_who, reply) => {
    stubBilling(() => json(reply));
    await mount();

    expect(pill()).toBeNull();
  });

  it.each([
    ['a reply without billing data', () => json({})],
    ['a server error', () => json({ error: 'Failed to load billing state' }, 500)],
    ['a refused token', () => json({ error: 'Unauthorized' }, 401)],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('shows nothing, and does not break the page, on %s', async (_what, respond) => {
    stubBilling(respond);
    await mount();

    expect(pill()).toBeNull();
  });

  it('reloads the state when a checkout is confirmed: the pill goes once a plan is bought', async () => {
    let reply: Record<string, unknown> = billing();
    const fetchStub = stubBilling(() => json(reply));
    await mount();
    expect(pill()).not.toBeNull();

    reply = billing({ plan: 'growth', status: 'active', trialActive: false, trialEligible: false, stripeSubscriptionId: 'sub_1' });
    await act(async () => notifyBillingChanged());
    await settle();

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(pill()).toBeNull();
  });

  it('stops listening once it is gone', async () => {
    const fetchStub = stubBilling(() => json(billing()));
    await mount();
    await act(async () => root.unmount());
    root = createRoot(container);

    notifyBillingChanged();
    await settle();

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('refreshes on a page view, at most once a minute', async () => {
    const fetchStub = stubBilling(() => json(billing()));
    await mount();
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await act(async () => navigate?.('/app/settings'));
    await settle();
    expect(fetchStub, 'a page view inside the minute does not reload').toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    await act(async () => navigate?.('/app/intake'));
    await settle();
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('asks again at the next page view when the company did not exist yet, as on a new signup’s first load', async () => {
    let reply: Record<string, unknown> = { active: true, plan: 'starter', status: 'trialing', trialActive: true, trialEndsAt: null, source: 'pending' };
    const fetchStub = stubBilling(() => json(reply));
    await mount();
    expect(pill()).toBeNull();

    // The first data request has created the company by now; no minute has passed.
    reply = billing();
    await act(async () => navigate?.('/app/intake'));
    await settle();

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(labels()[0]).toBe('Starter trial: 9 days left');
  });

  it('flips to "ended" on the clock when the tab outlives the trial', async () => {
    stubBilling(() => json(billing({ trialEndsAt: at(1) })));
    await mount();
    expect(labels()[0]).toBe('Starter trial: 1 day left');

    // Two days on, with no new reply from the server: the same state, read against a later clock.
    vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
    await act(async () => navigate?.('/app/settings'));
    await settle();

    expect(labels()[0]).toBe('Starter trial ended');
  });
});

describe('confirming a checkout', () => {
  // The pill reloads through this event; what matters here is when it is sent.
  async function verifyWith(respond: () => Response | Promise<Response>) {
    const url = vi.fn<typeof fetch>(async () => respond());
    vi.stubGlobal('fetch', url);
    const heard = vi.fn();
    const off = onBillingChanged(heard);
    const result = await verifyCheckoutSession('cs_test_123');
    off();
    return { result, heard, url };
  }

  it('tells whoever shows the billing state once the subscription is confirmed', async () => {
    const { result, heard, url } = await verifyWith(() => json({ verified: true }));

    expect(result).toEqual({ ok: true, data: { verified: true } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(url.mock.calls[0]![0]).toBe('/api/checkout/verify');
  });

  it('says nothing while the subscription is still being finalised, or when confirming fails', async () => {
    const pending = await verifyWith(() => json({ verified: false, reason: 'no_subscription_on_session' }));
    expect(pending.heard).not.toHaveBeenCalled();

    const failed = await verifyWith(() => json({ error: 'Checkout verification failed' }, 500));
    expect(failed.result.ok).toBe(false);
    expect(failed.heard).not.toHaveBeenCalled();
  });
});
