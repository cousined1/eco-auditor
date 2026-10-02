/**
 * Google Consent Mode v2 for the GTM container, and the "stop Google Analytics"
 * half of withdrawing consent (F-F-05, F-F-16).
 *
 * The consent UI used to decide only WHETHER the container loaded. Once it had
 * loaded, every tag fired on its own triggers: the Marketing choice reached no
 * tag at all, and a visitor who withdrew analytics consent kept being measured
 * until the next page load. Google's tags read their consent from `consent`
 * commands in the dataLayer, so this module is the one place that turns a
 * ConsentCategories value into those commands. ConsentProvider calls it on every
 * change of the stored choice and initializeGTM() calls it before gtm.js starts,
 * so a new code path cannot load the container without the current choice.
 *
 * The dataLayer itself is the state: what has been declared is read back from
 * it, so there is no second copy to drift and no command is pushed twice.
 */
import type { ConsentCategories, PrivacySignals } from './consent-context';

export type GoogleConsentType = 'analytics_storage' | 'ad_storage' | 'ad_user_data' | 'ad_personalization';
export type GoogleConsentValue = 'granted' | 'denied';
export type GoogleConsentState = Record<GoogleConsentType, GoogleConsentValue>;

const CONSENT_TYPES: readonly GoogleConsentType[] = ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'];

// How long Google's tags hold back for a later `update` before they fall back to
// the default. The stored choice is read synchronously, so in practice the update
// is already queued when the container starts.
const WAIT_FOR_UPDATE_MS = 500;

type TagWindow = Window & {
  dataLayer?: unknown[];
  google_tag_manager?: Record<string, unknown>;
};

// A browser privacy signal is the visitor's own opt-out, set outside the page,
// so it outranks an in-page choice made before or after it: GPC is an opt-out of
// sale/sharing (marketing), Do Not Track is an opt-out of tracking in general
// (analytics and marketing). This is the single place that rule lives.
export function applyPrivacySignals(consent: ConsentCategories, signals: PrivacySignals): ConsentCategories {
  return {
    ...consent,
    strictlyNecessary: true,
    analytics: signals.dnt ? false : consent.analytics,
    marketing: signals.gpc || signals.dnt ? false : consent.marketing,
  };
}

export function toGoogleConsent(consent: ConsentCategories): GoogleConsentState {
  const analytics: GoogleConsentValue = consent.analytics ? 'granted' : 'denied';
  const marketing: GoogleConsentValue = consent.marketing ? 'granted' : 'denied';
  return {
    analytics_storage: analytics,
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
  };
}

function dataLayer(): unknown[] {
  const tagWindow = window as TagWindow;
  tagWindow.dataLayer ??= [];
  return tagWindow.dataLayer;
}

// Google's tags recognise a gtag command only when it is an `arguments` object (an
// array or a plain object is an ordinary dataLayer message), which is why the stock
// snippet is `function gtag(){dataLayer.push(arguments);}`.
const gtag: (...command: unknown[]) => void = function () {
  // eslint-disable-next-line prefer-rest-params
  dataLayer().push(arguments);
};

function isCommand(entry: unknown): entry is ArrayLike<unknown> {
  return typeof entry === 'object' && entry !== null && typeof (entry as { length?: unknown }).length === 'number';
}

// What the dataLayer has declared so far: `default` first, then every `update` in order.
function declaredConsent(): { hasDefault: boolean; state: Partial<GoogleConsentState> } {
  const declared: { hasDefault: boolean; state: Partial<GoogleConsentState> } = { hasDefault: false, state: {} };
  for (const entry of dataLayer()) {
    if (!isCommand(entry) || entry[0] !== 'consent') continue;
    const action = entry[1];
    const params = entry[2];
    if ((action !== 'default' && action !== 'update') || typeof params !== 'object' || params === null) continue;
    if (action === 'default') declared.hasDefault = true;
    for (const type of CONSENT_TYPES) {
      const value = (params as Record<string, unknown>)[type];
      if (value === 'granted' || value === 'denied') declared.state[type] = value;
    }
  }
  return declared;
}

/** Declares every Google consent type denied, once, before anything can read it. */
export function ensureConsentModeDefault(): void {
  if (typeof window === 'undefined' || declaredConsent().hasDefault) return;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: WAIT_FOR_UPDATE_MS,
  });
}

// GA4 measurement ids currently known to the page. The repo holds only the GTM
// container id (the GA4 tag and its id live inside the container), so the ids are
// read from the object the Google tag publishes once it has initialised.
function measurementIds(): string[] {
  const tags = (window as TagWindow).google_tag_manager;
  return tags ? Object.keys(tags).filter((key) => /^(?:G|UA)-[A-Z0-9-]+$/i.test(key)) : [];
}

const disabledMeasurementIds = new Set<string>();

// Best effort on top of Consent Mode: `ga-disable-<id>` makes the Google tag stop
// sending hits for that property (developers.google.com/tag-platform/security/guides/privacy).
// Google documents it for gtag.js; for a GTM-hosted tag the dependable control is the
// consent update above, so this only ever narrows what is sent.
function setGoogleAnalyticsDisabled(disabled: boolean): void {
  const flags = window as unknown as Record<string, unknown>;
  if (disabled) {
    for (const id of measurementIds()) {
      flags[`ga-disable-${id}`] = true;
      disabledMeasurementIds.add(id);
    }
    return;
  }
  for (const id of disabledMeasurementIds) flags[`ga-disable-${id}`] = false;
  disabledMeasurementIds.clear();
}

/**
 * Brings Google's view of consent in line with the visitor's choice: pushes a
 * `consent update` when (and only when) something changed, and switches Google
 * Analytics off or back on. Analytics -> analytics_storage; Marketing -> the three
 * ad signals. Privacy signals are applied here again so no caller can bypass them.
 */
export function syncConsentMode(consent: ConsentCategories, signals: PrivacySignals): void {
  if (typeof window === 'undefined') return;
  ensureConsentModeDefault();
  const effective = applyPrivacySignals(consent, signals);
  const next = toGoogleConsent(effective);
  const { state } = declaredConsent();
  if (CONSENT_TYPES.some((type) => state[type] !== next[type])) gtag('consent', 'update', next);
  setGoogleAnalyticsDisabled(!effective.analytics);
}
