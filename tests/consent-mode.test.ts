// F-F-05: the visitor's consent choice has to reach Google's tags as Consent Mode
// v2 commands, with everything denied until a choice is made, and a browser
// privacy signal has to win over an in-page choice. These tests read the
// dataLayer the way the Google tag does: a `consent` command only counts when it
// is an `arguments` object.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPrivacySignals,
  ensureConsentModeDefault,
  syncConsentMode,
  toGoogleConsent,
} from '../src/lib/consent-mode';
import type { ConsentCategories, PrivacySignals } from '../src/lib/consent-context';

const none: PrivacySignals = { gpc: false, dnt: false };
const everything: ConsentCategories = { strictlyNecessary: true, analytics: true, preferences: true, marketing: true };
const nothing: ConsentCategories = { strictlyNecessary: true, analytics: false, preferences: false, marketing: false };

type Flags = Record<string, unknown>;

// Every consent command in the dataLayer, as [action, params] pairs.
function consentCommands(): Array<[string, Record<string, unknown>]> {
  const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
  return layer
    .filter((entry): entry is ArrayLike<unknown> => typeof entry === 'object' && entry !== null && 'length' in entry)
    .map((entry) => Array.from(entry))
    .filter((command) => command[0] === 'consent')
    .map((command) => [command[1] as string, command[2] as Record<string, unknown>]);
}

beforeEach(() => {
  delete (window as unknown as Flags).dataLayer;
  delete (window as unknown as Flags).google_tag_manager;
});

afterEach(() => {
  // Leave the module's record of disabled properties clean for the next test.
  syncConsentMode(everything, none);
  for (const key of Object.keys(window)) if (key.startsWith('ga-disable-')) delete (window as unknown as Flags)[key];
  delete (window as unknown as Flags).dataLayer;
  delete (window as unknown as Flags).google_tag_manager;
});

describe('applyPrivacySignals', () => {
  it('leaves the choice alone when the browser sends no signal', () => {
    expect(applyPrivacySignals(everything, none)).toEqual(everything);
  });

  it('Global Privacy Control switches marketing off and leaves analytics alone', () => {
    expect(applyPrivacySignals(everything, { gpc: true, dnt: false })).toEqual({ ...everything, marketing: false });
  });

  it('Do Not Track switches analytics and marketing off (F-F-16: DNT applies to marketing too)', () => {
    expect(applyPrivacySignals(everything, { gpc: false, dnt: true })).toEqual({ ...everything, analytics: false, marketing: false });
  });

  it('strictly necessary storage is always on', () => {
    expect(applyPrivacySignals({ ...nothing, strictlyNecessary: false }, none).strictlyNecessary).toBe(true);
  });
});

describe('toGoogleConsent', () => {
  it('maps Analytics to analytics_storage and Marketing to the three ad signals', () => {
    expect(toGoogleConsent({ ...nothing, analytics: true })).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(toGoogleConsent({ ...nothing, marketing: true })).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });
});

describe('the default state', () => {
  it('denies every signal and lets tags wait 500 ms for an update', () => {
    ensureConsentModeDefault();
    expect(consentCommands()).toEqual([
      ['default', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
        wait_for_update: 500,
      }],
    ]);
  });

  it('is declared as gtag `arguments` objects, which is the only form Google tags read as commands', () => {
    ensureConsentModeDefault();
    const layer = (window as unknown as { dataLayer: unknown[] }).dataLayer;
    expect(Object.prototype.toString.call(layer[0])).toBe('[object Arguments]');
  });

  it('is declared once, however often it is asked for', () => {
    ensureConsentModeDefault();
    ensureConsentModeDefault();
    syncConsentMode(nothing, none);
    expect(consentCommands().filter(([action]) => action === 'default')).toHaveLength(1);
  });
});

describe('syncConsentMode', () => {
  it('declares the default before any update, and an update only when the choice differs from it', () => {
    syncConsentMode(nothing, none);
    expect(consentCommands().map(([action]) => action)).toEqual(['default']);

    syncConsentMode(everything, none);
    const commands = consentCommands();
    expect(commands.map(([action]) => action)).toEqual(['default', 'update']);
    expect(commands[1]?.[1]).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('does not repeat an update the dataLayer already holds', () => {
    syncConsentMode(everything, none);
    syncConsentMode(everything, none);
    syncConsentMode({ ...everything, preferences: false }, none); // Preferences is not a Google signal
    expect(consentCommands().filter(([action]) => action === 'update')).toHaveLength(1);
  });

  it('pushes a denied update when consent is withdrawn after it was granted', () => {
    syncConsentMode(everything, none);
    syncConsentMode(nothing, none);
    const updates = consentCommands().filter(([action]) => action === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1]?.[1]).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });

  it('keeps the Marketing toggle separate from Analytics', () => {
    syncConsentMode({ ...nothing, analytics: true }, none);
    const update = consentCommands().find(([action]) => action === 'update')?.[1];
    expect(update).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  });

  it('never grants marketing to a browser that sends Global Privacy Control, whatever the caller passes', () => {
    syncConsentMode(everything, { gpc: true, dnt: false });
    const update = consentCommands().find(([action]) => action === 'update')?.[1];
    expect(update).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  });

  it('never grants analytics or marketing to a browser that sends Do Not Track', () => {
    syncConsentMode(everything, { gpc: false, dnt: true });
    expect(consentCommands().filter(([action]) => action === 'update')).toHaveLength(0);
    expect(consentCommands()[0]?.[1]).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied' });
  });
});

describe('stopping Google Analytics on withdrawal', () => {
  const flags = window as unknown as Flags;

  it('sets ga-disable for every GA4 property the Google tag has initialised, and only for those', () => {
    flags.google_tag_manager = { 'GTM-TEST123': {}, 'G-ABC123XYZ': {}, dataLayer: {} };
    syncConsentMode(everything, none);
    expect(flags['ga-disable-G-ABC123XYZ']).toBeUndefined();

    syncConsentMode(nothing, none);
    expect(flags['ga-disable-G-ABC123XYZ']).toBe(true);
    expect(flags['ga-disable-GTM-TEST123']).toBeUndefined();
  });

  it('switches Google Analytics back on when the visitor accepts again', () => {
    flags.google_tag_manager = { 'G-ABC123XYZ': {} };
    syncConsentMode(nothing, none);
    expect(flags['ga-disable-G-ABC123XYZ']).toBe(true);

    syncConsentMode(everything, none);
    expect(flags['ga-disable-G-ABC123XYZ']).toBe(false);
  });

  it('does nothing when no Google tag has loaded (the normal case for a visitor who never accepted)', () => {
    expect(() => syncConsentMode(nothing, none)).not.toThrow();
    expect(Object.keys(window).filter((key) => key.startsWith('ga-disable-'))).toEqual([]);
  });

  it('a Do Not Track browser has analytics switched off even if the stored choice was Accept', () => {
    flags.google_tag_manager = { 'G-ABC123XYZ': {} };
    syncConsentMode(everything, { gpc: false, dnt: true });
    expect(flags['ga-disable-G-ABC123XYZ']).toBe(true);
  });
});
