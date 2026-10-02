// K5 (F-B-03) in the real <App/> shell: which /app routes an auto-provisioned company
// is sent through onboarding for, and which stay open. The gate wraps the routes that
// would otherwise be the first screen (dashboard, data intake, calculator, reports);
// Settings (where the company is renamed and facilities are added) and Pricing must
// stay reachable without it, and the shell's header shows the company's own name
// instead of "Your organization". Page bodies and auth are stubbed, as in
// tests/app-shell.test.tsx.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/hooks/useTheme';
import { COMPANY_URL, companyOverview, jsonResponse, placeholderOverview, settleShell } from './helpers/company-overview';
import { publishCompanyName } from '../src/lib/companyName';

vi.mock('../src/lib/insforge', () => ({
  insforge: {
    auth: {
      getCurrentUser: vi.fn(async () => ({ data: { user: { email: 'ada@example.test', profile: { name: 'Ada Lovelace' } } } })),
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
    consentState: { hasConsented: true, consent: { strictlyNecessary: true, analytics: false, preferences: false, marketing: false }, timestamp: null, policyVersion: '1.0.0' },
    privacySignals: { gpc: false, dnt: false },
    updateConsent: () => {}, acceptAll: () => {}, rejectAll: () => {}, resetConsent: () => {},
  }),
}));

const { stub } = vi.hoisted(() => ({
  stub: (title: string) => async () => {
    const { createElement } = await import('react');
    return { default: () => createElement('div', null, createElement('h1', null, title)) };
  },
}));
vi.mock('../src/pages/Dashboard', stub('Dashboard page'));
vi.mock('../src/pages/DataIntake', stub('Data Intake page'));
vi.mock('../src/pages/AIAssistant', stub('AI Assistant page'));
vi.mock('../src/pages/Ledger', stub('Ledger page'));
vi.mock('../src/pages/Reports', stub('Reports page'));
vi.mock('../src/pages/Suppliers', stub('Suppliers page'));
vi.mock('../src/pages/Methodology', stub('Methodology page'));
vi.mock('../src/pages/Settings', stub('Settings page'));
vi.mock('../src/pages/Pricing', stub('Pricing page'));
vi.mock('../src/components/carbon-calculator', stub('Calculator page'));

// The gate is a real (lazy) chunk in front of the stubbed pages: transform it here, not inside
// the first test's timeout, where a loaded machine makes it the slowest thing in the file.
await import('../src/components/onboarding/OnboardingGate');

let container: HTMLDivElement;
let root: Root;
let overview: unknown;

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
  await settleShell(container);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === COMPANY_URL ? jsonResponse(overview) : new Response('{}', { status: 200 }))));
  localStorage.clear();
  publishCompanyName(null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const main = () => container.querySelector<HTMLElement>('main')!.textContent ?? '';
const header = () => container.querySelector('main')!.parentElement!.querySelector('header')!.textContent ?? '';

describe('the routes an auto-provisioned company is sent through onboarding for', () => {
  it.each([
    ['/app', 'Dashboard page'],
    ['/app/intake', 'Data Intake page'],
    ['/app/calculator', 'Calculator page'],
    ['/app/reports', 'Reports page'],
  ])('%s shows onboarding, not %s', async (path, page) => {
    overview = placeholderOverview();
    await mountAt(path);

    expect(main()).toContain('Welcome to Eco-Auditor');
    expect(main()).not.toContain(page);
  });

  it.each([
    ['/app/settings', 'Settings page'],
    ['/app/pricing', 'Pricing page'],
    ['/app/methodology', 'Methodology page'],
  ])('%s stays open: Settings is where the company is named later, Pricing is where a plan is chosen', async (path, page) => {
    overview = placeholderOverview();
    await mountAt(path);

    expect(main()).toContain(page);
    expect(main()).not.toContain('Welcome to Eco-Auditor');
  });

  it('a company that is not a placeholder reaches every page directly', async () => {
    overview = companyOverview();
    await mountAt('/app/calculator');
    expect(main()).toContain('Calculator page');
    expect(main()).not.toContain('Welcome to Eco-Auditor');
  });
});

describe('the shell\'s header', () => {
  it('names the company once a screen has loaded it (it used to say "Your organization" for everyone)', async () => {
    overview = companyOverview({ company: { name: 'Northstar Foods' } });
    await mountAt('/app');

    expect(header()).toContain('Northstar Foods');
    expect(header()).not.toContain('Your organization');
  });

  it('falls back to "Your organization" until a name is known', async () => {
    overview = companyOverview();
    await mountAt('/app/settings');
    expect(header()).toContain('Your organization');
  });
});
