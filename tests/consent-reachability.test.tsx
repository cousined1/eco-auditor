/**
 * CONSENT-02 — withdrawing consent has to be reachable, and must not cost the
 * visitor their current choices just to look at them.
 *
 * CONSENT-01 (earlier this session) made revocation real: teardownGTM() now runs
 * when analytics is withdrawn. That capability is worthless if no visitor can
 * reach it, and two things stood in the way.
 *
 * 1. The /app shell renders no <Footer>, so the only "Cookie preferences"
 *    control lived on the marketing pages. A signed-in customer spends their
 *    whole working life in the app — the surfaces where analytics is actually
 *    collected — and could not change or withdraw consent without logging out
 *    and navigating to the marketing site. The Privacy Policy promises
 *    withdrawal "at any time through the cookie preferences settings on our
 *    site".
 *
 * 2. That footer control called resetConsent(), which does not open preferences
 *    at all: it wipes the stored choice back to the defaults and re-shows the
 *    whole banner. Combined with CONSENT-01 that is worse than before — asking
 *    to review your cookies now destroys them, tears down the analytics
 *    container and clears its cookies, even if the visitor then re-grants
 *    exactly what they had. A link labelled "preferences" must not have
 *    revocation as a side effect.
 *
 * Withdrawal must be as easy as granting (GDPR art. 7(3); ePrivacy rules
 * require opt-out to be as accessible as opt-in).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConsentProvider } from '../src/lib/consent-context';
import { CookiePreferencesButton } from '../src/components/CookieConsentBanner';

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(__dirname, '..', ...segments), 'utf8');

let root: Root | undefined;
let container: HTMLDivElement;

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ConsentProvider>{node}</ConsentProvider>));
}

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

async function waitFor(selector: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const el = container.querySelector(selector);
    if (el) return el;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

const stored = () => {
  const raw = localStorage.getItem('eco_consent');
  return raw ? (JSON.parse(raw) as { consent: Record<string, boolean>; hasConsented: boolean }) : null;
};

const saveButton = () =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save Preferences'))!;

/** Seed a prior choice so "reviewing" has something to preserve. */
function seedConsent(analytics: boolean, marketing = false) {
  localStorage.setItem(
    'eco_consent',
    JSON.stringify({
      consent: { essential: true, analytics, preferences: true, marketing },
      timestamp: '2026-10-01T00:00:00.000Z',
      policyVersion: '1.0.0',
      hasConsented: true,
    })
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  // /api/consent-audit is fire-and-forget with retries; keep it off the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }))
  );
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CONSENT-02 the preferences dialog opens on the current choices', () => {
  it('pre-fills each toggle from stored consent rather than starting blank', async () => {
    seedConsent(true, true);

    await mount(<CookiePreferencesButton />);
    click(container.querySelector('button')!);
    await waitFor('[role="dialog"]');

    const analytics = container.querySelector<HTMLInputElement>('#cookie-consent-analytics')!;
    const marketing = container.querySelector<HTMLInputElement>('#cookie-consent-marketing')!;
    expect(analytics.checked, 'analytics choice not pre-filled').toBe(true);
    expect(marketing.checked, 'marketing choice not pre-filled').toBe(true);
  });

  it('opening the dialog does not alter the stored consent', async () => {
    // The regression: resetConsent() on click wiped the choice, which under
    // CONSENT-01 now tears down analytics as a side effect of looking.
    seedConsent(true, true);

    await mount(<CookiePreferencesButton />);
    click(container.querySelector('button')!);
    await waitFor('[role="dialog"]');

    expect(stored()?.consent.analytics).toBe(true);
    expect(stored()?.consent.marketing).toBe(true);
    expect(stored()?.hasConsented).toBe(true);
  });

  it('saving without changes preserves the previous choice', async () => {
    seedConsent(true, false);

    await mount(<CookiePreferencesButton />);
    click(container.querySelector('button')!);
    await waitFor('[role="dialog"]');
    click(saveButton());
    await act(async () => {
      await Promise.resolve();
    });

    expect(stored()?.consent.analytics).toBe(true);
  });

  it('withdrawal is a deliberate act inside the dialog, not a side effect of opening it', async () => {
    seedConsent(true, false);

    await mount(<CookiePreferencesButton />);
    click(container.querySelector('button')!);
    await waitFor('[role="dialog"]');

    // Untick analytics explicitly, then save. A real click, not a synthetic
    // 'change' event: React's onChange for checkboxes is driven by the click,
    // and dispatching the raw event leaves the controlled state untouched.
    const analytics = container.querySelector<HTMLInputElement>('#cookie-consent-analytics')!;
    expect(analytics.checked).toBe(true);
    click(analytics);
    expect(analytics.checked, 'the toggle did not flip').toBe(false);
    const save = saveButton();
    click(save);
    await act(async () => {
      await Promise.resolve();
    });

    expect(stored()?.consent.analytics).toBe(false);
  });

  it('keeps the strictly-necessary toggle locked on', async () => {
    seedConsent(true);

    await mount(<CookiePreferencesButton />);
    click(container.querySelector('button')!);
    await waitFor('[role="dialog"]');

    const necessary = container.querySelector<HTMLInputElement>('#cookie-consent-necessary')!;
    expect(necessary.checked).toBe(true);
    expect(necessary.disabled).toBe(true);
  });
});

describe('CONSENT-02 the control is reachable from every shell', () => {
  const appSource = readRepoFile('src', 'App.tsx');
  const footerSource = readRepoFile('src', 'components', 'Footer.tsx');

  it('the authenticated /app shell offers cookie preferences', () => {
    // The gap: <Footer /> is rendered in the marketing and pricing layouts only,
    // so the app had no consent control at all.
    expect(appSource).toContain('CookiePreferencesButton');
    const importLine = appSource.match(/import \{[^}]*CookiePreferencesButton[^}]*\} from/)?.[0];
    expect(importLine, 'not imported into the app shell').toBeDefined();
  });

  it('the footer control no longer calls resetConsent', () => {
    // It now opens the dialog. Calling resetConsent from a link labelled
    // "preferences" discarded the visitor's choice every time it was used.
    expect(footerSource).toContain('CookiePreferencesButton');
    expect(footerSource).not.toContain('resetConsent');
    expect(footerSource).not.toMatch(/onClick=\{resetConsent\}/);
  });

  it('the dialog is focus-trapped and labelled', () => {
    const banner = readRepoFile('src', 'components', 'CookieConsentBanner.tsx');
    expect(banner).toContain('useFocusTrap');
    expect(banner).toContain('role="dialog"');
    expect(banner).toContain('aria-modal="true"');
    expect(banner).toContain('aria-labelledby="cookie-preferences-title"');
  });

  it('every toggle has an associated label', () => {
    const banner = readRepoFile('src', 'components', 'CookieConsentBanner.tsx');
    for (const id of ['necessary', 'analytics', 'preferences', 'marketing']) {
      expect(banner, `label missing for #cookie-consent-${id}`).toContain(
        `htmlFor="cookie-consent-${id}"`
      );
    }
  });
});