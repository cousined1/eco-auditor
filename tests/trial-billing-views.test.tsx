// F-B-10 / F-B-18 on the two billing views. Settings: a trial that ended reads as
// ended (not "inactive | — | $0/month"), and a failed portal, plan-change or cancel
// request is shown beside the buttons with the card still on screen. Pricing inside
// the app: a company whose free trial is used sees "Subscribe", not "Start free trial".
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pricing from '../src/pages/Pricing';
import Settings from '../src/pages/Settings';
import { buttonNamed, press, settle } from './helpers/form-dom';

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), exportMyData: vi.fn(), deleteMyData: vi.fn(), hasSession: vi.fn((): boolean => true) }));
const stripe = vi.hoisted(() => ({
  cancelSubscription: vi.fn(),
  changeSubscription: vi.fn(),
  createBillingPortalSession: vi.fn(),
  createCheckoutSession: vi.fn(async () => ({ ok: false as const, error: 'Pricing is temporarily unavailable.' })),
}));
vi.mock('../src/lib/api', () => api);
vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
// Company and Facilities (K5) load their own data; this test is about the billing card.
vi.mock('../src/components/settings/CompanySection', () => ({ default: () => null }));
vi.mock('../src/lib/stripe', () => stripe);

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const day = (iso: string) => new Date(iso).toLocaleDateString();

const billing = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  plan: 'growth',
  status: 'active',
  trialActive: false,
  trialEndsAt: at(-30),
  trialEnded: false,
  trialEligible: false,
  currentPeriodEnd: at(20),
  billingCycle: 'monthly',
  cancelAtPeriodEnd: false,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  ...overrides,
});

// The card-free trial ran out and nothing was ever bought.
const ENDED_AT = at(-2);
const TRIAL_ENDED = billing({
  active: false,
  plan: null,
  status: null,
  trialEndsAt: ENDED_AT,
  trialEnded: true,
  currentPeriodEnd: null,
  billingCycle: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});

// A subscriber who cancelled: nothing active, but not a trial that ended.
const CANCELLED = billing({ active: false, plan: null, status: 'canceled', currentPeriodEnd: at(-3) });

let container: HTMLDivElement;
let root: Root;

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const text = () => container.textContent ?? '';
const alerts = () => [...container.querySelectorAll<HTMLElement>('[role="alert"]')];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.apiFetch.mockReset();
  for (const fn of [stripe.cancelSubscription, stripe.changeSubscription, stripe.createBillingPortalSession, stripe.createCheckoutSession]) fn.mockReset();
  api.hasSession.mockReturnValue(true);
  stripe.createCheckoutSession.mockResolvedValue({ ok: false, error: 'Pricing is temporarily unavailable.' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountSettings(reply: unknown) {
  api.apiFetch.mockResolvedValue(ok(reply));
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    ),
  );
  await settle();
}

describe('Settings billing card when the trial has ended', () => {
  it('says the trial ended, when, and what to do, instead of "inactive | — | $0/month"', async () => {
    await mountSettings(TRIAL_ENDED);

    expect(container.querySelector('.badge')?.textContent).toBe('Trial ended');
    expect(container.querySelector('.badge')?.className).toContain('badge-amber');
    expect(text()).toContain('Starter trial ended');
    expect(text()).toContain(`Ended on ${day(ENDED_AT)}`);
    expect(text()).toContain(`Your Starter trial ended on ${day(ENDED_AT)}.`);
    expect(text()).toContain('Choose a plan to keep importing data');
    expect(text()).toContain('You can still export your data below.');
    expect(text()).not.toMatch(/\$\d+\/month/);
    expect(text()).not.toContain('inactive');
    expect(text()).not.toContain('Renews');
    expect(text()).not.toContain('No charge during the trial');
    expect(buttonNamed(container, /^Choose a plan$/)).toBeTruthy();
  });

  it('offers checkout, not plan changes: the plan list has Subscribe links and no portal or cancel', async () => {
    await mountSettings(TRIAL_ENDED);
    await press(buttonNamed(container, /^Choose a plan$/));

    const subscribe = [...container.querySelectorAll('a')].filter((a) => a.textContent === 'Subscribe');
    expect(subscribe.map((a) => a.getAttribute('href'))).toEqual([
      '/app?checkout=starter_monthly',
      '/app?checkout=growth_monthly',
      '/app?checkout=pro_monthly',
    ]);
    expect(text()).not.toContain('Manage billing portal');
    expect(text()).not.toContain('Cancel subscription');
  });

  it('a cancelled subscriber has no plan, but is not told a trial ended, and is not shown "$0/month"', async () => {
    await mountSettings(CANCELLED);

    expect(text()).toContain('No active plan');
    expect(text()).toContain('canceled');
    expect(text()).toContain('Choose a plan to continue');
    expect(text()).not.toContain('Trial ended');
    expect(text()).not.toContain('trial ended');
    expect(text()).not.toMatch(/\$\d+\/month/);
  });
});

describe('Settings billing errors', () => {
  it('a failed portal request is announced beside the buttons and the card stays', async () => {
    stripe.createBillingPortalSession.mockResolvedValue({ ok: false, error: 'Billing portal session creation failed' });
    await mountSettings(billing());
    await press(buttonNamed(container, /^Manage billing portal$/));

    expect(alerts()).toHaveLength(1);
    const alert = alerts()[0]!;
    expect(alert.textContent).toBe('Billing portal session creation failed');
    // In the billing card, under the buttons that were clicked, and focused so it is read out.
    expect(alert.closest('.card')?.textContent).toContain('Current Plan');
    expect(alert.closest('.card')?.contains(buttonNamed(container, /^Manage billing portal$/))).toBe(true);
    expect(document.activeElement).toBe(alert);
    // Nothing the customer needs to retry went away, and the button is usable again.
    expect(buttonNamed(container, /^Change plan$/)).toBeTruthy();
    expect(buttonNamed(container, /^Cancel subscription$/)).toBeTruthy();
    expect(buttonNamed(container, /^Manage billing portal$/).disabled).toBe(false);
  });

  it('a failed plan change keeps the plan picker open beside its error', async () => {
    stripe.changeSubscription.mockResolvedValue({ ok: false, error: 'Subscription change failed' });
    await mountSettings(billing({ plan: 'starter' }));
    await press(buttonNamed(container, /^Change plan$/));
    await press(buttonNamed(container, /^Upgrade$/));

    expect(stripe.changeSubscription).toHaveBeenCalledTimes(1);
    expect(alerts().map((a) => a.textContent)).toEqual(['Subscription change failed']);
    expect(text()).toContain('Switch Plan');
    expect(text()).toContain('Current Plan');
  });

  it('a failed cancellation keeps the confirmation, so it can be retried or dropped', async () => {
    stripe.cancelSubscription.mockResolvedValue({ ok: false, error: 'Cancellation failed' });
    await mountSettings(billing());
    await press(buttonNamed(container, /^Cancel subscription$/));
    await press(buttonNamed(container, /^Confirm cancellation$/));

    expect(alerts().map((a) => a.textContent)).toEqual(['Cancellation failed']);
    expect(buttonNamed(container, /^Confirm cancellation$/).disabled).toBe(false);
    expect(buttonNamed(container, /^Keep my plan$/)).toBeTruthy();
  });

  it('the message goes away when the next attempt starts', async () => {
    stripe.createBillingPortalSession.mockResolvedValueOnce({ ok: false, error: 'Billing portal session creation failed' });
    await mountSettings(billing());
    await press(buttonNamed(container, /^Manage billing portal$/));
    expect(alerts()).toHaveLength(1);

    stripe.createBillingPortalSession.mockReturnValueOnce(new Promise(() => {})); // still in flight
    await act(async () => buttonNamed(container, /^Manage billing portal$/).click());

    expect(alerts()).toHaveLength(0);
  });

  it('when billing cannot be loaded it says so and offers a retry that brings the card back', async () => {
    api.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Failed to load billing state' }), { status: 500 }));
    await act(async () =>
      root.render(
        <MemoryRouter>
          <Settings />
        </MemoryRouter>,
      ),
    );
    await settle();

    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.textContent).toContain('Failed to load billing state');
    expect(alerts()[0]!.querySelector('button')?.textContent).toBe('Try Again');
    expect(text()).not.toContain('Current Plan');

    api.apiFetch.mockResolvedValue(ok(billing()));
    await press(buttonNamed(container, /^Try Again$/));

    expect(alerts()).toHaveLength(0);
    expect(text()).toContain('Current Plan');
    expect(api.apiFetch).toHaveBeenCalledTimes(2);
    expect(api.apiFetch.mock.calls.map(([path]) => path)).toEqual(['/api/billing', '/api/billing']);
  });
});

describe('Settings: a billing request that never answers (F-B-15)', () => {
  // Only the clocks the code under test reads; React's own scheduling stays real.
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  /** The billing request: never answers, but honours cancellation like a real fetch. */
  function hang(signals: AbortSignal[]) {
    api.apiFetch.mockImplementation(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        }),
    );
  }

  const mountAndWait = () =>
    act(async () =>
      root.render(
        <MemoryRouter>
          <Settings />
        </MemoryRouter>,
      ),
    );
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('gives up after 15 s with a visible error and a working Try Again, and cancels the hung request', async () => {
    const signals: AbortSignal[] = [];
    hang(signals);

    await mountAndWait();
    expect(text()).toContain('Loading billing');

    await advance(14_999);
    expect(text()).toContain('Loading billing');
    expect(alerts()).toHaveLength(0);

    await advance(1);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.textContent).toContain('Loading your billing details took too long');
    expect(buttonNamed(container, /^Try Again$/)).toBeTruthy();
    expect(text()).not.toContain('Loading billing'); // the loading card is gone
    expect(text()).not.toContain('Current Plan');
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);

    api.apiFetch.mockReset();
    api.apiFetch.mockResolvedValue(ok(billing()));
    await act(async () => buttonNamed(container, /^Try Again$/).click());
    expect(alerts()).toHaveLength(0);
    expect(text()).toContain('Current Plan');
  });

  it('a late answer to a request that was already abandoned cannot flip the card back to an error', async () => {
    const signals: AbortSignal[] = [];
    hang(signals);

    await mountAndWait();
    await advance(15_000);
    api.apiFetch.mockReset();
    api.apiFetch.mockResolvedValue(ok(billing()));
    await act(async () => buttonNamed(container, /^Try Again$/).click());
    expect(text()).toContain('Current Plan');

    // The abandoned attempt's aborted request has long since rejected; nothing may resurface.
    await advance(60_000);
    expect(text()).toContain('Current Plan');
    expect(alerts()).toHaveLength(0);
  });

  it('a slow answer inside the deadline still shows the card, and the deadline does not fire afterwards', async () => {
    api.apiFetch.mockImplementation(() => new Promise<Response>((resolve) => setTimeout(() => resolve(ok(billing())), 14_000)));

    await mountAndWait();
    await advance(14_000);
    expect(text()).toContain('Current Plan');

    await advance(30_000);
    expect(text()).toContain('Current Plan');
    expect(alerts()).toHaveLength(0);
  });

  it('cancels its request when the page is left', async () => {
    const signals: AbortSignal[] = [];
    hang(signals);

    await mountAndWait();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    await act(async () => root.render(<MemoryRouter>{null}</MemoryRouter>));
    expect(signals[0]!.aborted).toBe(true);
  });
});

describe('Pricing inside the app when the free trial is used (F-B-18)', () => {
  async function mountPricing(embedded: boolean, reply: Response | null = null) {
    api.apiFetch.mockResolvedValue(reply ?? ok(TRIAL_ENDED));
    await act(async () =>
      root.render(
        <MemoryRouter>
          <Pricing embedded={embedded} />
        </MemoryRouter>,
      ),
    );
    await settle();
  }

  const ctas = () =>
    [...container.querySelectorAll('button')]
      .filter((b) => /start free trial|subscribe|get started/i.test(b.textContent ?? ''))
      .map((b) => b.textContent);

  it('reads "Subscribe" on every plan and says the trial is used', async () => {
    await mountPricing(true);

    expect(api.apiFetch.mock.calls.map(([path]) => path)).toEqual(['/api/billing']);
    expect(ctas()).toEqual(['Subscribe', 'Subscribe', 'Subscribe']);
    expect(text()).toContain('Free trial already used · billing starts at checkout');
    expect(text()).not.toContain('a card is required to start it');
  });

  it('asks checkout for no trial, as the server would refuse it anyway', async () => {
    await mountPricing(true);
    await press(buttonNamed(container, /^Subscribe$/));

    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ planId: 'starter', trial: false }));
  });

  it('still says "Subscribe" on annual billing, where "Get started" was the new-customer wording', async () => {
    await mountPricing(true);
    await press(container.querySelector('[role="switch"]') as HTMLElement);

    expect(ctas()).toEqual(['Subscribe', 'Subscribe', 'Subscribe']);
  });

  it('keeps the free-trial buttons for a company that can still have one', async () => {
    await mountPricing(true, ok(billing({ plan: 'starter', status: 'trialing', trialActive: true, trialEndsAt: at(9), trialEligible: true, stripeSubscriptionId: null, stripeCustomerId: null })));

    expect(ctas()).toEqual(['Start free trial', 'Start free trial', 'Get started']);
    await press(buttonNamed(container, /^Start free trial$/));
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ planId: 'starter', trial: true }));
  });

  it('keeps the trial wording when the billing state cannot be had', async () => {
    await mountPricing(true, new Response('{}', { status: 500 }));

    expect(ctas()).toEqual(['Start free trial', 'Start free trial', 'Get started']);
  });

  it('the public pricing page is the same for everyone: no billing request, trial wording', async () => {
    await mountPricing(false);

    expect(api.apiFetch).not.toHaveBeenCalled();
    expect(ctas()).toEqual(['Start free trial', 'Start free trial', 'Get started']);
  });
});

describe('Pricing on the server (the prerender step)', () => {
  it('renders with the trial wording and asks for nothing: effects do not run, and no billing state is fetched', () => {
    const html = renderToString(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );

    expect(html).toContain('Start free trial');
    expect(html).not.toContain('Free trial already used');
    expect(api.apiFetch).not.toHaveBeenCalled();
  });
});
