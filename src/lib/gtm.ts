import { useConsent, type ConsentCategories, type PrivacySignals } from './consent-context';
import { syncConsentMode } from './consent-mode';
import { useCallback } from 'react';

const GTM_ID = import.meta.env.VITE_GTM_ID || '';

type GTMWindow = Window & {
  dataLayer?: Array<Record<string, unknown>>;
};

export function useGTM() {
  const { consentState } = useConsent();

  const trackEvent = useCallback((eventName: string, data?: Record<string, unknown>) => {
    if (!consentState.consent.analytics || !GTM_ID) return;

    const gtmWindow = window as GTMWindow;
    if (typeof window !== 'undefined' && gtmWindow.dataLayer) {
      gtmWindow.dataLayer.push({
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

export function initializeGTM(consent: ConsentCategories, signals: PrivacySignals) {
  if (typeof window === 'undefined') return;

  if (!GTM_ID) {
    console.warn('[GTM] VITE_GTM_ID not configured');
    return;
  }

  const scriptId = `gtm-script-${GTM_ID}`;
  if (document.getElementById(scriptId)) return;

  // Consent Mode first (F-F-05): the container reads its consent state when
  // gtm.js starts, so the default (everything denied) and the visitor's current
  // choice have to be queued ahead of the 'gtm.js' event below. A container that
  // starts without them fires every tag on its own triggers, whatever the
  // Marketing toggle says.
  syncConsentMode(consent, signals);

  // Initialize dataLayer
  const gtmWindow = window as GTMWindow;
  gtmWindow.dataLayer = gtmWindow.dataLayer || [];
  gtmWindow.dataLayer.push({
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
