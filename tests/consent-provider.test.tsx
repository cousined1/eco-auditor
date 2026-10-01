// F-F-05 / F-F-16: what ConsentProvider does with a choice, end to end in jsdom:
//   - Google gets everything denied until a choice exists, then the choice
//     (Analytics -> analytics_storage, Marketing -> the ad signals), before the
//     container script starts;
//   - a browser privacy signal overrides a stored "Accept" on a later load, and
//     writes one evidence record for that;
//   - every choice writes exactly one audit record (reset included), and
//   - withdrawing analytics stops Google Analytics.
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentProvider, useConsent, type ConsentContextType } from '../src/lib/consent-context';

const STORAGE_KEY = 'eco_consent';
const ACCEPT_ALL = {
  consent: { strictlyNecessary: true, analytics: true, preferences: true, marketing: true },
  timestamp: '2026-09-01T00:00:00.000Z',
  policyVersion: '1.0.0',
  hasConsented: true,
};

type Flags = Record<string, unknown>;
type AuditBody = { method: string; gpc: boolean; dnt: boolean; consent: { analytics: boolean; marketing: boolean } };

let captured: ConsentContextType | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let mounted: Array<{ root: Root; container: HTMLElement }> = [];

function Probe() {
  const api = useConsent();
  useEffect(() => {
    captured = api;
  }, [api]);
  return <span>probe</span>;
}

async function mount(tree: ReactNode = <Probe />) {
  captured = null;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<ConsentProvider>{tree}</ConsentProvider>);
  });
  await settleAudit();
  return { root, container };
}

async function unmountAll() {
  for (const { root, container } of mounted) {
    await act(async () => root.unmount());
    container.remove();
  }
  mounted = [];
}

// Audit records are delivered from a promise chain: give it a few turns.
async function settleAudit() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function auditBodies(): AuditBody[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/consent-audit')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as AuditBody);
}

function consentCommands(): Array<[string, Record<string, unknown>]> {
  const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return layer
    .filter((entry): entry is ArrayLike<unknown> => typeof entry === 'object' && entry !== null && 'length' in entry)
    .map((entry) => Array.from(entry))
    .filter((command) => command[0] === 'consent')
    .map((command) => [command[1] as string, command[2] as Record<string, unknown>]);
}

// Nothing may be left in the delivery outbox once the requests have completed.
const outbox = () => localStorage.getItem('eco_consent_outbox');

const lastUpdate = () => consentCommands().filter(([action]) => action === 'update').at(-1)?.[1];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as typeof ACCEPT_ALL | null;

function setSignal(name: 'globalPrivacyControl' | 'doNotTrack', value: boolean | string) {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  delete (window as unknown as Flags).dataLayer;
  delete (window as unknown as Flags).google_tag_manager;
});

afterEach(async () => {
  await unmountAll();
  delete (navigator as unknown as Flags).globalPrivacyControl;
  delete (navigator as unknown as Flags).doNotTrack;
  for (const key of Object.keys(window)) if (key.startsWith('ga-disable-')) delete (window as unknown as Flags)[key];
  delete (window as unknown as Flags).dataLayer;
  delete (window as unknown as Flags).google_tag_manager;
  document.head.querySelectorAll('script[id^="gtm-script-"]').forEach((script) => script.remove());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('Google Consent Mode follows the choice (F-F-05)', () => {
  it('has every signal denied, and no container, until the visitor chooses', async () => {
    await mount();

    expect(consentCommands()).toHaveLength(1);
    expect(consentCommands()[0]).toEqual(['default', expect.objectContaining({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })]);
    expect(document.querySelector('script[id^="gtm-script-"]')).toBeNull();
    expect(auditBodies()).toHaveLength(0); // nothing is recorded for a visitor who has not chosen
  });

  it('Accept All grants analytics and the ad signals and records the choice once', async () => {
    await mount();
    await act(async () => captured?.acceptAll());
    await settleAudit();

    expect(lastUpdate()).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
    expect(stored()?.consent).toMatchObject({ analytics: true, marketing: true });
    expect(auditBodies().map((body) => body.method)).toEqual(['accept_all']);
    expect(outbox()).toBeNull();
  });

  it('the Marketing toggle reaches Google: analytics on and marketing off grants only analytics', async () => {
    await mount();
    await act(async () => captured?.updateConsent({ analytics: true, marketing: false }));

    expect(lastUpdate()).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });

  it('Reject after Accept withdraws everything from Google again', async () => {
    await mount();
    await act(async () => captured?.acceptAll());
    await act(async () => captured?.rejectAll());
    await settleAudit();

    expect(lastUpdate()).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(auditBodies().map((body) => body.method)).toEqual(['accept_all', 'reject_all']);
  });

  it('a returning visitor who accepted gives Google the choice on load, before the container can start', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ACCEPT_ALL));
    await mount();

    const actions = consentCommands().map(([action]) => action);
    expect(actions).toEqual(['default', 'update']);
    expect(lastUpdate()).toMatchObject({ analytics_storage: 'granted', ad_storage: 'granted' });
    expect(auditBodies()).toHaveLength(0); // loading a page is not a new decision
  });
});

describe('the container is loaded after Consent Mode (F-F-05)', () => {
  it('queues the default and the choice ahead of the gtm.js event, and only for a visitor who accepted analytics', async () => {
    vi.stubEnv('VITE_GTM_ID', 'GTM-TEST123');
    vi.resetModules();
    const { ConsentProvider: FreshProvider } = await import('../src/lib/consent-context');
    const { default: GTMInitializer } = await import('../src/components/GTMInitializer');

    // Nobody has chosen: no container.
    const first = document.createElement('div');
    document.body.append(first);
    const firstRoot = createRoot(first);
    await act(async () => firstRoot.render(<FreshProvider><GTMInitializer /></FreshProvider>));
    expect(document.getElementById('gtm-script-GTM-TEST123')).toBeNull();
    await act(async () => firstRoot.unmount());
    first.remove();
    delete (window as unknown as Flags).dataLayer;

    // A stored Accept plus Global Privacy Control: the container starts, but its
    // consent state already says marketing is denied.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ACCEPT_ALL));
    setSignal('globalPrivacyControl', true);
    const second = document.createElement('div');
    document.body.append(second);
    const secondRoot = createRoot(second);
    await act(async () => secondRoot.render(<FreshProvider><GTMInitializer /></FreshProvider>));

    const script = document.getElementById('gtm-script-GTM-TEST123') as HTMLScriptElement | null;
    expect(script?.src).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-TEST123');

    const layer = (window as unknown as { dataLayer: unknown[] }).dataLayer;
    const order = layer.map((entry) => {
      const command = Array.from(entry as ArrayLike<unknown>);
      if (Object.prototype.toString.call(entry) === '[object Arguments]') return `${String(command[0])}:${String(command[1])}`;
      return (entry as { event?: string }).event ?? 'other';
    });
    expect(order).toEqual(['consent:default', 'consent:update', 'gtm.js']);
    const update = Array.from(layer[1] as ArrayLike<unknown>)[2];
    expect(update).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });

    await act(async () => secondRoot.unmount());
    second.remove();
  });
});

describe('a browser privacy signal overrides a stored choice (F-F-05)', () => {
  it('Global Privacy Control switches a stored Accept to marketing off, stores that, and writes one record', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ACCEPT_ALL));
    setSignal('globalPrivacyControl', true);

    await mount();

    expect(captured?.consentState.consent).toMatchObject({ analytics: true, marketing: false });
    expect(stored()?.consent).toMatchObject({ analytics: true, marketing: false });
    expect(lastUpdate()).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });

    const records = auditBodies();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ method: 'privacy_signal', gpc: true, consent: { analytics: true, marketing: false } });
  });

  it('writes that record once: the next load finds nothing to override', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ACCEPT_ALL));
    setSignal('globalPrivacyControl', true);
    await mount();
    await unmountAll();
    fetchMock.mockClear();

    await mount();

    expect(auditBodies()).toHaveLength(0);
    expect(captured?.consentState.consent.marketing).toBe(false);
  });

  it('with no stored decision, a signal rejects the non-essential categories without a banner, and records it', async () => {
    setSignal('globalPrivacyControl', true);
    await mount();

    expect(captured?.consentState.hasConsented).toBe(true);
    expect(captured?.consentState.consent).toMatchObject({ analytics: false, marketing: false });
    expect(auditBodies().map((body) => body.method)).toEqual(['privacy_signal']);
  });

  it('Do Not Track turns marketing off as well as analytics, even through Accept All (F-F-16)', async () => {
    setSignal('doNotTrack', '1');
    await mount();
    fetchMock.mockClear();

    await act(async () => captured?.acceptAll());
    await settleAudit();

    expect(stored()?.consent).toMatchObject({ analytics: false, marketing: false });
    expect(auditBodies()).toEqual([expect.objectContaining({ method: 'accept_all', dnt: true, consent: expect.objectContaining({ analytics: false, marketing: false }) })]);
  });

  it('Global Privacy Control alone leaves analytics available to accept', async () => {
    setSignal('globalPrivacyControl', true);
    await mount();
    await act(async () => captured?.acceptAll());

    expect(stored()?.consent).toMatchObject({ analytics: true, marketing: false });
  });
});

describe('one audit record per choice (F-F-16)', () => {
  it('"Cookie preferences" writes exactly one record, the reset, and not a second privacy_signal one', async () => {
    setSignal('globalPrivacyControl', true);
    await mount();
    expect(auditBodies().map((body) => body.method)).toEqual(['privacy_signal']);
    fetchMock.mockClear();

    await act(async () => captured?.resetConsent());
    await settleAudit();

    expect(auditBodies().map((body) => body.method)).toEqual(['reset']);
    expect(outbox()).toBeNull();
  });

  it('a reset without any signal writes one record too', async () => {
    await mount();
    await act(async () => captured?.acceptAll());
    await settleAudit();
    fetchMock.mockClear();

    await act(async () => captured?.resetConsent());
    await settleAudit();

    expect(auditBodies().map((body) => body.method)).toEqual(['reset']);
    expect(outbox()).toBeNull();
    expect(stored()).toBeNull();
    expect(lastUpdate()).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied' });
  });
});

describe('withdrawing analytics stops Google Analytics (F-F-16)', () => {
  it('sets ga-disable on the loaded property when the visitor rejects, and lifts it when they accept again', async () => {
    await mount();
    await act(async () => captured?.acceptAll());
    // The Google tag has initialised a GA4 property by now.
    (window as unknown as Flags).google_tag_manager = { 'GTM-TEST123': {}, 'G-ABC123XYZ': {} };
    const flags = window as unknown as Flags;
    expect(flags['ga-disable-G-ABC123XYZ']).toBeUndefined();

    await act(async () => captured?.rejectAll());
    expect(flags['ga-disable-G-ABC123XYZ']).toBe(true);

    await act(async () => captured?.acceptAll());
    expect(flags['ga-disable-G-ABC123XYZ']).toBe(false);
  });
});
