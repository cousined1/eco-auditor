// F-C-07 / F-F-04: the cookie banner must not hide what has keyboard focus, must
// not strand focus on <body> when it closes, must come first in the tab order, and
// must reserve the room it covers. jsdom has no layout, so the geometry is tested
// as the contract between the banner (which publishes its height) and index.css
// (which turns that height into padding and scroll-padding); the pixel budget
// itself (banner height, hero call to action, largest paint, focus never hidden)
// was measured in a real browser against the built site, see the report.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { CookieConsentBanner } from '../src/components/CookieConsentBanner';
import { ConsentProvider, useConsent } from '../src/lib/consent-context';
import { ThemeProvider } from '../src/hooks/useTheme';

// The real <App/> is rendered below with the network and auth stubbed out, the
// same way tests/app-shell.test.tsx does; the consent provider stays real.
vi.mock('../src/lib/insforge', () => ({
  insforge: {
    auth: {
      getCurrentUser: vi.fn(async () => ({ data: { user: null } })),
      signOut: vi.fn(async () => {}),
    },
  },
}));

vi.mock('../src/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/session')>()),
  isSessionValid: vi.fn(async () => true),
  installUnauthorizedInterceptor: vi.fn(() => () => {}),
}));

const ACCEPTED = {
  consent: { strictlyNecessary: true, analytics: false, preferences: false, marketing: false },
  timestamp: '2026-09-01T00:00:00.000Z',
  policyVersion: '1.0.0',
  hasConsented: true,
};

let container: HTMLDivElement;
let root: Root;

const banner = () => container.querySelector<HTMLElement>('[data-consent-banner]');
const main = () => container.querySelector<HTMLElement>('main#main-content')!;
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === name)!;
const rootStyle = () => document.documentElement.style;

// A page with a banner, a <main> that can take focus, and a link after it.
function Page() {
  return (
    <ConsentProvider>
      <CookieConsentBanner />
      <main id="main-content" tabIndex={-1}>
        <h1>Page</h1>
        <a href="/pricing">Pricing</a>
      </main>
      <footer>
        <a href="/privacy">Privacy</a>
      </footer>
    </ConsentProvider>
  );
}

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 202 })));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  localStorage.clear();
  document.documentElement.style.removeProperty('--consent-h');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.style.removeProperty('--consent-h');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('visibility', () => {
  it('shows for a first-time visitor and stays away once a choice is stored', async () => {
    await render(<Page />);
    expect(banner()).not.toBeNull();
    expect(banner()?.getAttribute('aria-label')).toBe('Cookie consent');

    await act(async () => root.unmount());
    root = createRoot(container);
    localStorage.setItem('eco_consent', JSON.stringify(ACCEPTED));
    await render(<Page />);
    expect(banner()).toBeNull();
  });
});

describe('reserved space (F-C-07)', () => {
  type Observer = { callback: () => void; target: Element | null; disconnected: boolean };
  let observers: Observer[];
  let bannerHeight: number;

  beforeEach(() => {
    observers = [];
    bannerHeight = 96;
    vi.stubGlobal('ResizeObserver', class {
      private readonly entry: Observer;
      constructor(callback: () => void) {
        this.entry = { callback, target: null, disconnected: false };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.hasAttribute('data-consent-banner') ? bannerHeight : 0;
      return { height, width: 390, top: 0, left: 0, right: 390, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
    });
  });

  it('publishes its height as --consent-h while it is open, and follows it when it resizes', async () => {
    await render(<Page />);
    expect(rootStyle().getPropertyValue('--consent-h')).toBe('96px');

    bannerHeight = 132.4; // the text wrapped onto another line
    await act(async () => observers[0]?.callback());
    expect(rootStyle().getPropertyValue('--consent-h')).toBe('133px');
    expect(observers[0]?.target).toBe(banner());
  });

  it('gives the room back, and stops observing, when the visitor chooses', async () => {
    await render(<Page />);
    await act(async () => button('Accept All').click());

    expect(banner()).toBeNull();
    expect(rootStyle().getPropertyValue('--consent-h')).toBe('');
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('index.css turns --consent-h into scroll-padding and end-of-page padding, so a focused control is never left behind the bar', () => {
    const css = readFileSync(resolve('src/index.css'), 'utf8');
    // The page scrolls the document; the signed-in app scrolls <main>.
    expect(css).toMatch(/html,\s*main#main-content\s*\{[^}]*scroll-padding-bottom:\s*var\(--consent-h,\s*0px\)/);
    expect(css).toMatch(/body:not\(:has\(#root > \.h-screen\)\)\s*\{[^}]*padding-bottom:\s*var\(--consent-h,\s*0px\)/);
    expect(css).toMatch(/main#main-content\.overflow-y-auto\s*\{[^}]*padding-bottom:\s*var\(--consent-h,\s*0px\)/);
  });
});

describe('focus (F-C-07)', () => {
  it.each([['Accept All'], ['Reject Non-Essential']])('%s hands focus to the page content, not <body>', async (label) => {
    await render(<Page />);
    button(label).focus();
    expect(document.activeElement).toBe(button(label));

    await act(async () => button(label).click());

    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(main());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('Save Preferences in the dialog hands focus to the page content too', async () => {
    await render(<Page />);
    button('Manage Preferences').focus();
    await act(async () => button('Manage Preferences').click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => button('Save Preferences').click());

    expect(banner()).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(main());
  });

  it('Cancel in the dialog returns focus to the button that opened it, and the banner stays', async () => {
    await render(<Page />);
    const manage = button('Manage Preferences');
    manage.focus();
    await act(async () => manage.click());
    await act(async () => button('Cancel').click());

    expect(banner()).not.toBeNull();
    expect(document.activeElement).toBe(manage);
  });

  it('every control in the banner states its own keyboard focus ring (WCAG 2.4.7)', async () => {
    await render(<Page />);
    const controls = [...banner()!.querySelectorAll<HTMLElement>('button, a[href]')];
    expect(controls.map((control) => control.textContent?.trim())).toEqual([
      'Learn more',
      'Manage Preferences',
      'Reject Non-Essential',
      'Accept All',
    ]);
    for (const control of controls) {
      expect(control.className, `${control.textContent} has no focus-visible style`).toMatch(/focus-visible:outline-2/);
    }
  });
});

describe('a privacy signal shows in the preferences dialog instead of being ignored', () => {
  const checkbox = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

  // With a signal and nothing stored the provider decides for the visitor and the
  // banner never appears; "Cookie preferences" in the footer (resetConsent) is the
  // way back to the dialog.
  function ReopenablePage() {
    const { resetConsent } = useConsent();
    return (
      <>
        <CookieConsentBanner />
        <main id="main-content" tabIndex={-1}>
          <button type="button" onClick={resetConsent}>Cookie preferences</button>
        </main>
      </>
    );
  }

  async function openPreferences() {
    await render(<ConsentProvider><ReopenablePage /></ConsentProvider>);
    expect(banner()).toBeNull();
    await act(async () => button('Cookie preferences').click());
    await act(async () => button('Manage Preferences').click());
  }

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl;
    delete (navigator as unknown as Record<string, unknown>).doNotTrack;
  });

  it('Global Privacy Control: Marketing is off and locked, Analytics stays available and is honoured on save', async () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    await openPreferences();

    expect(checkbox('cookie-consent-marketing').disabled).toBe(true);
    expect(checkbox('cookie-consent-marketing').checked).toBe(false);
    expect(container.textContent).toContain('your browser sends a Global Privacy Control or Do Not Track signal');
    expect(checkbox('cookie-consent-analytics').disabled).toBe(false);

    await act(async () => checkbox('cookie-consent-analytics').click());
    await act(async () => button('Save Preferences').click());

    expect(JSON.parse(localStorage.getItem('eco_consent') ?? '{}').consent).toMatchObject({ analytics: true, marketing: false });
  });

  it('Do Not Track: Analytics and Marketing are both off and locked', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    await openPreferences();

    expect(checkbox('cookie-consent-analytics').disabled).toBe(true);
    expect(checkbox('cookie-consent-marketing').disabled).toBe(true);
  });

  it('with no signal both toggles are free', async () => {
    await render(<Page />);
    await act(async () => button('Manage Preferences').click());

    expect(checkbox('cookie-consent-analytics').disabled).toBe(false);
    expect(checkbox('cookie-consent-marketing').disabled).toBe(false);
  });
});

describe('tab order in the real app shell (F-C-07)', () => {
  const focusables = () =>
    [...container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')];

  async function mountApp() {
    await render(
      <MemoryRouter initialEntries={['/privacy']}>
        <ThemeProvider>
          <ConsentProvider>
            <App />
          </ConsentProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  it('the open banner comes before the page in the tab order, not after every link on it', async () => {
    await mountApp();

    expect(banner()).not.toBeNull();
    expect(focusables()[0]?.closest('[data-consent-banner]')).not.toBeNull();
  });

  it('once the banner is answered it leaves the tab order, and "Skip to main content" is first again', async () => {
    localStorage.setItem('eco_consent', JSON.stringify(ACCEPTED));
    await mountApp();

    expect(banner()).toBeNull();
    expect(focusables()[0]?.textContent).toBe('Skip to main content');
  });

  // D-6. Document order is only the first tab stop if nothing has moved focus. The
  // route manager used to focus <main> on the first render, so on a real hard load
  // the first Tab skipped the banner and the skip link. jsdom has no Tab key: with
  // nothing focused the browser starts at the top of the document, so these pin
  // both halves, where focus is after load and what comes first in document order.
  it('on a first visit nothing has focus after load, so the first Tab reaches the cookie banner', async () => {
    await mountApp();

    expect(document.activeElement).toBe(document.body);
    expect(focusables()[0]?.closest('[data-consent-banner]')).not.toBeNull();
  });

  it('after a consent choice nothing has focus after load, so the first Tab reaches "Skip to main content"', async () => {
    localStorage.setItem('eco_consent', JSON.stringify(ACCEPTED));
    await mountApp();

    expect(document.activeElement).toBe(document.body);
    expect(focusables()[0]?.textContent).toBe('Skip to main content');
  });
});
