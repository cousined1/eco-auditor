// F-B-10 in the real <App/>: the trial pill sits in the app header next to the theme
// toggle, only inside the signed-in shell, and the shell's other promises (one
// toggle, the skip link first) are untouched. Network, auth and the route bodies are
// stubbed out the way tests/app-shell.test.tsx does it.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/hooks/useTheme';
import { companyOverview, settleShell } from './helpers/company-overview';

vi.mock('../src/lib/insforge', () => ({
  insforge: {
    getHttpClient: () => ({ getHeaders: () => ({ Authorization: 'Bearer shell-token' }) }),
    auth: {
      getCurrentUser: vi.fn(async () => ({
        data: { user: { email: 'ada@example.test', profile: { name: 'Ada Lovelace' } } },
      })),
      signOut: vi.fn(async () => {}),
    },
  },
}));

vi.mock('../src/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/session')>()),
  isSessionValid: vi.fn(async () => true),
  installUnauthorizedInterceptor: vi.fn(() => () => {}),
}));

vi.mock('../src/lib/consent-context', () => ({
  useConsent: () => ({
    consentState: {
      hasConsented: true,
      consent: { strictlyNecessary: true, analytics: false, preferences: false, marketing: false },
      timestamp: null,
      policyVersion: '1.0.0',
    },
    privacySignals: { gpc: false, dnt: false },
    updateConsent: () => {},
    acceptAll: () => {},
    rejectAll: () => {},
    resetConsent: () => {},
  }),
}));

const { stub } = vi.hoisted(() => ({
  stub: (title: string) => async () => {
    const { createElement } = await import('react');
    return { default: () => createElement('div', null, createElement('h1', null, title)) };
  },
}));
vi.mock('../src/pages/Dashboard', stub('Dashboard'));
vi.mock('../src/pages/DataIntake', stub('Data Intake'));
vi.mock('../src/pages/AIAssistant', stub('AI Assistant'));
vi.mock('../src/pages/Ledger', stub('Ledger'));
vi.mock('../src/pages/Reports', stub('Reports'));
vi.mock('../src/pages/Suppliers', stub('Suppliers'));
vi.mock('../src/pages/Methodology', stub('Methodology'));
vi.mock('../src/pages/Settings', stub('Settings'));
vi.mock('../src/pages/Pricing', stub('Pricing'));
vi.mock('../src/components/carbon-calculator', stub('Calculator'));

// The onboarding gate is a real (lazy) chunk in front of the stubbed pages: transform it here,
// not inside the first test's timeout, where a loaded machine makes it the slowest thing in the file.
await import('../src/components/onboarding/OnboardingGate');

const NOW = new Date('2026-09-30T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const billing = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  plan: 'starter',
  status: 'trialing',
  trialActive: true,
  trialEndsAt: new Date(NOW.getTime() + 9 * DAY).toISOString(),
  trialEnded: false,
  trialEligible: true,
  currentPeriodEnd: null,
  billingCycle: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
let fetchStub: ReturnType<typeof vi.fn>;

// The page is behind the onboarding gate (a lazy chunk and one company fetch): wait for it, not a fixed delay.
const settle = () => settleShell(container);

async function mountAt(path: string) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>,
    ),
  );
  await settle();
}

function stubFetch(reply: unknown) {
  // /api/company is the onboarding gate's own request (K5), answered with a company with nothing pending.
  fetchStub = vi.fn(async (url: string) =>
    String(url).startsWith('/api/billing')
      ? new Response(JSON.stringify(reply), { status: 200 })
      : new Response(String(url) === '/api/company' ? JSON.stringify(companyOverview()) : '{}', { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchStub);
}

const billingCalls = () => fetchStub.mock.calls.filter(([url]) => String(url).startsWith('/api/billing'));
const header = () => container.querySelector<HTMLElement>('main')!.parentElement!.querySelector<HTMLElement>('header')!;
const toggles = () => container.querySelectorAll('button[aria-label^="Switch to"]');
const pill = () => header().querySelector<HTMLAnchorElement>('a[href="/app/pricing"]');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the trial pill in the app shell', () => {
  it('shows the days left in the header, beside the theme toggle', async () => {
    stubFetch(billing());
    await mountAt('/app/calculator');

    expect(pill()?.getAttribute('aria-label')).toBe('Starter trial: 9 days left. View plans');
    expect(pill()?.textContent).toContain('Starter trial: 9 days left');
    const toggle = toggles()[0]!;
    expect(pill()!.parentElement).toBe(toggle.parentElement);
    expect(pill()!.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says so in the header once the trial has ended', async () => {
    stubFetch(billing({ active: false, plan: null, status: null, trialActive: false, trialEnded: true, trialEligible: false, trialEndsAt: new Date(NOW.getTime() - 2 * DAY).toISOString() }));
    await mountAt('/app');

    expect(pill()?.textContent).toContain('Starter trial ended');
  });

  it('keeps the shell\'s promises: one theme toggle, the skip link first, nothing else moved', async () => {
    stubFetch(billing());
    await mountAt('/app/calculator');

    expect(toggles()).toHaveLength(1);
    expect(container.querySelector<HTMLAnchorElement>('a[href]')?.textContent).toBe('Skip to main content');
    expect(container.querySelector('main')?.textContent).toContain('Calculator');
  });

  it('is absent for someone with nothing to report, and does not hide the page', async () => {
    stubFetch(billing({ plan: 'growth', status: 'active', trialActive: false, trialEligible: false, stripeSubscriptionId: 'sub_1' }));
    await mountAt('/app/calculator');

    expect(pill()).toBeNull();
    expect(container.querySelector('main')?.textContent).toContain('Calculator');
  });

  it('is not part of the public site: no billing request from a marketing page', async () => {
    stubFetch(billing());
    await mountAt('/pricing');

    expect(billingCalls()).toHaveLength(0);
  });

  it('asks for the billing state once on entering the app, not on every render', async () => {
    stubFetch(billing());
    await mountAt('/app/calculator');

    expect(billingCalls()).toHaveLength(1);
  });
});
