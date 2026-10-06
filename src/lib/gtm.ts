import { useConsent } from './consent-context';
import { useCallback } from 'react';

const GTM_ID = import.meta.env.VITE_GTM_ID || '';

/** The subset of consent GTM needs. Kept structural so gtm.ts has no import cycle. */
export type GTMConsent = { analytics: boolean; marketing: boolean };

type GTMWindow = Window & {
  dataLayer?: Array<Record<string, unknown> | unknown[]>;
};

function gtmWindow(): GTMWindow {
  return window as GTMWindow;
}

/**
 * Push a gtag-style command. GTM's container reads `dataLayer` arrays as if they
 * came from the gtag() library, so Consent Mode works without loading gtag.js.
 */
function gtag(...args: unknown[]): void {
  const w = gtmWindow();
  if (!w.dataLayer) return;
  w.dataLayer.push(args);
}

/**
 * Consent Mode v2 signal.
 *
 * Sent BEFORE gtm.js loads with everything denied, then updated on every change.
 * Without the default, the container's own tags (GA4 Configuration, and any
 * trigger the marketer configures) fire regardless of what this app's
 * trackEvent() gate does — that gate only stops our own dataLayer pushes.
 */
export function updateGTMConsent(consent: GTMConsent): void {
  const granted = (value: boolean) => (value ? 'granted' : 'denied');
  gtag('consent', 'update', {
    analytics_storage: granted(consent.analytics),
    ad_storage: granted(consent.marketing),
    ad_user_data: granted(consent.marketing),
    ad_personalization: granted(consent.marketing),
  });
}

function pushConsentDefaults(): void {
  // Consent Mode v2: deny everything until told otherwise. wait_for_update lets
  // the container hold its tags briefly for an explicit grant rather than
  // defaulting to denied and losing the hit.
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });
}

/**
 * Actually stop analytics after consent is withdrawn.
 *
 * Revoking consent previously did nothing at all: the banner and localStorage
 * updated, the Privacy Policy promised withdrawal "at any time", and the
 * already-injected gtm.js kept firing its tags and setting cookies until the
 * user reloaded or never. Consent Mode narrows what the container may do, but
 * only tags that have been configured to respect it; removing the script is
 * what makes the promise true regardless of how the container is configured.
 */
export function teardownGTM(): void {
  if (typeof document === 'undefined') return;

  const scriptId = GTM_ID ? `gtm-script-${GTM_ID}` : null;
  if (scriptId) document.getElementById(scriptId)?.remove();

  // The noscript iframe GTM injects alongside the script.
  document.querySelectorAll('iframe[src*="googletagmanager.com"]').forEach((el) => el.remove());

  try {
    delete (gtmWindow() as { dataLayer?: unknown }).dataLayer;
  } catch {
    /* non-configurable in some engines; the script removal is the load-bearing part */
  }

  // Clear the cookies the container has already set, on this host and its parent.
  try {
    const host = window.location.hostname;
    const parent = host.split('.').slice(1).join('.');
    const names = document.cookie ? document.cookie.split(';') : [];
    for (const raw of names) {
      const name = raw.split('=')[0]!.trim();
      if (!/^_ga/.test(name) && !/^_gid/.test(name)) continue;
      for (const domain of [host, parent, '']) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;${domain ? ` domain=${domain};` : ''}`;
      }
    }
  } catch {
    /* cookies unavailable (sandboxed / partitioned); script removal still applies */
  }
}

export function useGTM() {
  const { consentState } = useConsent();

  const trackEvent = useCallback((eventName: string, data?: Record<string, unknown>) => {
    if (!consentState.consent.analytics || !GTM_ID) return;

    const w = gtmWindow();
    if (typeof window !== 'undefined' && w.dataLayer) {
      w.dataLayer.push({
        event: eventName,
        ...data,
      });
    }
  }, [consentState.consent.analytics]);

  const trackPageView = useCallback((path: string) => {
    trackEvent('page_view', { page_path: path });
  }, [trackEvent]);

  return { trackEvent, trackPageView };
}

export function initializeGTM() {
  if (typeof window === 'undefined') return;

  if (!GTM_ID) {
    console.warn('[GTM] VITE_GTM_ID not configured');
    return;
  }

  const scriptId = `gtm-script-${GTM_ID}`;
  if (document.getElementById(scriptId)) return;

  // Initialize dataLayer
  const w = gtmWindow();
  w.dataLayer = w.dataLayer || [];

  // Deny-by-default must be queued BEFORE the gtm.js bootstrap event: the
  // container reads the queue as it initialises, so a consent default appended
  // after that event arrives too late to gate the tags it enables on startup.
  pushConsentDefaults();

  w.dataLayer.push({
    'gtm.start': new Date().getTime(),
    event: 'gtm.js',
  });

  // Load GTM script
  const script = document.createElement('script');
  script.id = scriptId;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(script);
}
