// The real <App/> shell, with the network, auth and the heavy route bodies stubbed
// out, for the parts of F-C-16, F-C-26, F-C-23 and F-C-09 that live in App.tsx:
// the sidebar logo link has a name, <main> is the labelled landmark AND the
// scroller that gets reset on navigation, the shell has one theme toggle, and the
// contact/legal pages carry the site navigation.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/hooks/useTheme';
import { COMPANY_URL, companyOverview, jsonResponse, settleShell } from './helpers/company-overview';

vi.mock('../src/lib/insforge', () => ({
  insforge: {
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

// The authenticated routes are lazy chunks; stand-ins keep charts and data
// fetching out of a test about the shell.
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

let container: HTMLDivElement;
let root: Root;

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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  // The onboarding gate (K5) asks for the company before it shows a /app page.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === COMPANY_URL ? jsonResponse(companyOverview()) : new Response('{}', { status: 200 }))));
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const main = () => container.querySelector<HTMLElement>('main')!;
const toggles = () => container.querySelectorAll('button[aria-label^="Switch to"]');
const sidebar = () => container.querySelector<HTMLElement>('aside')!;
const sidebarLink = (name: string) =>
  [...sidebar().querySelectorAll<HTMLAnchorElement>('nav a')].find((anchor) => anchor.getAttribute('aria-label') === name)!;

describe('app shell (F-C-16, F-C-23, F-C-26)', () => {
  it('names the logo link in the sidebar and hides the decorative mark from assistive tech', async () => {
    await mountAt('/app/calculator');
    const logoLink = sidebar().querySelector<HTMLAnchorElement>('a[href="/"]')!;
    expect(logoLink.getAttribute('aria-label')).toBe('Eco-Auditor home');
    const mark = logoLink.querySelector('svg')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    // Every link in the sidebar has a name: no unnamed control heads the list.
    for (const anchor of sidebar().querySelectorAll('a')) {
      expect((anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').trim(), anchor.outerHTML).not.toBe('');
    }
  });

  it('starts with a skip link that targets the main landmark', async () => {
    await mountAt('/app/calculator');
    const first = container.querySelector<HTMLAnchorElement>('a[href]')!;
    expect(first.textContent).toBe('Skip to main content');
    expect(container.querySelector(first.getAttribute('href')!)).toBe(main());
  });

  it('makes <main> a focusable landmark and the element that scrolls', async () => {
    await mountAt('/app/calculator');
    expect(main().id).toBe('main-content');
    expect(main().getAttribute('tabindex')).toBe('-1');
    expect(main().className).toContain('overflow-y-auto');
    expect(main().textContent).toContain('Calculator');
  });

  it('has exactly one theme toggle', async () => {
    await mountAt('/app/calculator');
    expect(toggles()).toHaveLength(1);
  });

  it('opens the next page at the top with focus in <main>, not on the sidebar link', async () => {
    await mountAt('/app/calculator');
    await act(async () => {
      main().scrollTop = 600;
      sidebarLink('Settings').focus();
    });
    expect(document.activeElement).toBe(sidebarLink('Settings'));

    await act(async () => sidebarLink('Settings').click());
    await settle();

    expect(main().textContent).toContain('Settings');
    expect(main().scrollTop).toBe(0);
    expect(document.activeElement).toBe(main());
  });
});

describe('every public page has one theme toggle (F-C-23)', () => {
  // Landing, blog and the legal shell each used to bring their own toggle and
  // glyph; /pricing, /methodology, /sample-report, /security and /demo had none.
  it.each([
    '/',
    '/pricing',
    '/methodology',
    '/sample-report',
    '/security',
    '/demo',
    '/blog',
    '/blog/a-post',
    '/contact',
    '/privacy',
    '/terms',
    '/dpa',
  ])('%s renders exactly one, drawn as a crescent', async (path) => {
    await mountAt(path);

    expect(toggles()).toHaveLength(1);
    const paths = toggles()[0]!.querySelectorAll('svg path');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute('d')!.match(/[Mm]/g)).toHaveLength(1);
  });
});

describe('contact and legal pages (F-C-09, F-C-23)', () => {
  it.each(['/contact', '/privacy'])('%s carries the site navigation, a primary trial button and one theme toggle', async (path) => {
    await mountAt(path);

    const nav = container.querySelector('nav[aria-label="Main navigation"]')!;
    expect([...nav.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'))).toEqual([
      '/#features',
      '/pricing/',
      '/methodology/',
      '/sample-report/',
      '/security/',
    ]);
    const trial = [...container.querySelectorAll<HTMLAnchorElement>('header a')].find(
      (anchor) => anchor.textContent === 'Start Free Trial',
    )!;
    expect(trial.classList.contains('btn-primary')).toBe(true);
    expect(toggles()).toHaveLength(1);
    expect(main().id).toBe('main-content');
  });
});
