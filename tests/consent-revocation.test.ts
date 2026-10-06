/**
 * Withdrawing analytics consent must actually stop analytics (CONSENT-01).
 *
 * The Privacy Policy publishes a GDPR right the app did not honour:
 *
 *   "Withdrawal of consent: Withdraw consent you have previously provided,
 *    without affecting the lawfulness of processing based on consent before
 *    its withdrawal."
 *   "You can grant or withdraw consent at any time through the cookie
 *    preferences settings on our site."
 *   "Analytics cookies ... you can opt out at any time."
 *
 * The consent layer itself was sound — analytics and marketing both default to
 * false, GPC and DNT are honoured, and every change is audit-logged. But the
 * container was loaded once and never touched again. Revoking consent updated
 * localStorage and the banner and did nothing to the already-injected gtm.js,
 * which kept firing the container's own tags and setting cookies.
 *
 * The trackEvent() gate was never sufficient on its own: it stops this app's own
 * dataLayer pushes, not tags the marketer configured inside GTM. That gap was
 * already recorded in the 2026-09-08 audit as M16/C6 and marked partially fixed
 * — the load path was gated, the unload path never existed.
 *
 * Three fixes are pinned here:
 *   1. Consent Mode v2 defaults are queued before gtm.js loads, so a container
 *      that respects Consent Mode has nothing enabled by default.
 *   2. Revoking analytics removes the script, the dataLayer and the cookies the
 *      container already set.
 *   3. The `marketing` category — collected, stored and audit-logged but never
 *      previously forwarded — now drives ad_storage / ad_user_data /
 *      ad_personalization.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(__dirname, '..', ...segments), 'utf8');

let initializeGTM: typeof import('../src/lib/gtm').initializeGTM;
let teardownGTM: typeof import('../src/lib/gtm').teardownGTM;
let updateGTMConsent: typeof import('../src/lib/gtm').updateGTMConsent;

type DataLayerWindow = Window & { dataLayer?: Array<Record<string, unknown> | unknown[]> };

const dataLayer = (): DataLayerWindow['dataLayer'] => (window as DataLayerWindow).dataLayer;
const scriptEl = () => document.getElementById('gtm-script-G-TEST');

async function loadGtmModule() {
  vi.resetModules();
  // A non-empty id so the load path is exercised; initializeGTM warns and
  // returns early when VITE_GTM_ID is unset.
  vi.stubEnv('VITE_GTM_ID', 'G-TEST');
  const mod = await import('../src/lib/gtm');
  initializeGTM = mod.initializeGTM;
  teardownGTM = mod.teardownGTM;
  updateGTMConsent = mod.updateGTMConsent;
  return mod;
}

beforeEach(async () => {
  document.head.innerHTML = '';
  document.cookie.split(';').forEach((raw) => {
    const name = raw.split('=')[0]!.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
  delete (window as DataLayerWindow).dataLayer;
  await loadGtmModule();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('CONSENT-01 consent is withheld from GTM by default', () => {
  it('queues deny-all Consent Mode defaults before the container loads', () => {
    initializeGTM();

    const commands = (dataLayer() ?? []) as unknown[][];
    const defaults = commands.find(
      (c): c is [string, string, Record<string, string>] =>
        Array.isArray(c) && c[0] === 'consent' && c[1] === 'default'
    );

    expect(defaults, 'no Consent Mode default pushed').toBeDefined();
    const signals = defaults![2];
    expect(signals.analytics_storage).toBe('denied');
    expect(signals.ad_storage).toBe('denied');
    expect(signals.ad_user_data).toBe('denied');
    expect(signals.ad_personalization).toBe('denied');
  });

  it('queues the deny-all default before the gtm.js bootstrap event', () => {
    // Order matters: the container reads the queue when it initialises, so a
    // default appended after gtm.js has nothing to act on.
    initializeGTM();
    const flat = (dataLayer() ?? []) as Array<Record<string, unknown> | unknown[]>;
    const indexOfDefault = flat.findIndex(
      (c) => Array.isArray(c) && (c as unknown[])[1] === 'default'
    );
    const indexOfBootstrap = flat.findIndex(
      (c) => !Array.isArray(c) && (c as Record<string, unknown>).event === 'gtm.js'
    );

    expect(indexOfDefault).toBeGreaterThan(-1);
    expect(indexOfBootstrap).toBeGreaterThan(-1);
    expect(indexOfDefault).toBeLessThan(indexOfBootstrap);
  });
});

describe('CONSENT-01 consent changes are forwarded', () => {
  it('grants the analytics signal on consent', () => {
    initializeGTM();
    updateGTMConsent({ analytics: true, marketing: false });

    const update = ((dataLayer() ?? []) as unknown[][]).find(
      (c): c is [string, string, Record<string, string>] =>
        Array.isArray(c) && c[0] === 'consent' && c[1] === 'update'
    );
    expect(update).toBeDefined();
    expect(update![2].analytics_storage).toBe('granted');
    // Marketing was not granted, so ad signals stay denied — the two
    // categories are independent and must not be coupled.
    expect(update![2].ad_storage).toBe('denied');
  });

  it('forwards marketing independently of analytics', () => {
    // The category was collected and stored but never sent. A marketing-only
    // visitor had to keep it denied forever.
    initializeGTM();
    updateGTMConsent({ analytics: false, marketing: true });

    const update = ((dataLayer() ?? []) as unknown[][]).find(
      (c): c is [string, string, Record<string, string>] =>
        Array.isArray(c) && c[0] === 'consent' && c[1] === 'update'
    );
    expect(update![2].ad_storage).toBe('granted');
    expect(update![2].analytics_storage).toBe('denied');
  });

  it('denies again when consent is withdrawn', () => {
    initializeGTM();
    updateGTMConsent({ analytics: true, marketing: true });
    updateGTMConsent({ analytics: false, marketing: false });

    const updates = ((dataLayer() ?? []) as unknown[][]).filter(
      (c) => Array.isArray(c) && c[0] === 'consent' && c[1] === 'update'
    ) as Array<[string, string, Record<string, string>]>;
    const last = updates[updates.length - 1]!;
    expect(last[2].analytics_storage).toBe('denied');
    expect(last[2].ad_storage).toBe('denied');
  });
});

describe('CONSENT-01 withdrawing consent actually stops collection', () => {
  it('removes the container script', () => {
    initializeGTM();
    expect(scriptEl()).not.toBeNull();

    teardownGTM();
    expect(scriptEl()).toBeNull();
    // Re-granting after a withdrawal must be able to load it again rather than
    // being permanently blocked by the old guard.
    initializeGTM();
    expect(scriptEl()).not.toBeNull();
  });

  it('drops the dataLayer the container was writing into', () => {
    initializeGTM();
    expect(dataLayer()).toBeDefined();

    teardownGTM();
    expect(dataLayer()).toBeUndefined();
  });

  it('clears analytics cookies the container already set', () => {
    document.cookie = '_ga=GA1.2.1.2; path=/';
    document.cookie = '_gid=GA1.2.1.3; path=/';
    document.cookie = '_ga_GA1=GA1.2.1.4; path=/';
    expect(document.cookie).toContain('_ga');

    teardownGTM();

    const remaining = document.cookie;
    expect(remaining).not.toContain('_ga');
    expect(remaining).not.toContain('_gid');
  });

  it('leaves non-analytics cookies alone', () => {
    // Essential cookies carry the session; a teardown that swept them would log
    // every visitor out the moment they changed their mind about analytics.
    document.cookie = 'eco_consent=kept; path=/';
    document.cookie = '_ga=deleted; path=/';

    teardownGTM();

    expect(document.cookie).toContain('eco_consent');
    expect(document.cookie).not.toContain('_ga');
  });

  it('is safe to call when GTM never loaded', () => {
    expect(() => teardownGTM()).not.toThrow();
    expect(dataLayer()).toBeUndefined();
  });
});

describe('CONSENT-01 the initializer wires both directions', () => {
  const source = readRepoFile('src', 'components', 'GTMInitializer.tsx');

  it('has an explicit revocation branch, not only the grant branch', () => {
    // The whole defect in one line: this component had a positive branch only.
    expect(source).toContain('teardownGTM');
    // Generous span: the branch carries the explanation of why it was missing.
    expect(source).toMatch(/else\s*\{[\s\S]{0,800}teardownGTM\(\)/);
  });

  it('forwards both categories, not just analytics', () => {
    expect(source).toMatch(/updateGTMConsent\(\{\s*analytics,\s*marketing\s*\}\)/);
    expect(source).toMatch(/\[\s*analytics,\s*marketing\s*\]/);
  });

  it('still gates the load on analytics consent', () => {
    expect(source).toMatch(/if \(analytics\)\s*\{\s*initializeGTM\(\)/);
  });
});

describe('CONSENT-01 the policy text and the behaviour now agree', () => {
  const privacy = readRepoFile('src', 'pages', 'PrivacyPolicy.tsx');

  it('still promises withdrawal at any time', () => {
    // If a future change removes this promise, these tests should be revisited
    // rather than silently continuing to enforce an unstated behaviour.
    expect(privacy).toContain('withdraw consent at any time');
    expect(privacy).toContain('Withdrawal of consent');
  });
});