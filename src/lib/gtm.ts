import { useConsent } from './consent-context';
import { useCallback } from 'react';

const GTM_ID = import.meta.env.VITE_GTM_ID || 'GTM-PS2XR44V';

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

export function initializeGTM() {
  if (typeof window === 'undefined') return;

  if (!GTM_ID) {
    console.warn('[GTM] VITE_GTM_ID not configured');
    return;
  }

  const scriptId = `gtm-script-${GTM_ID}`;
  if (document.getElementById(scriptId)) return;

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
