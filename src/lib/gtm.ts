import { useConsent } from './consent-context';

const GTM_ID = import.meta.env.VITE_GTM_ID;

export function useGTM() {
  const { consentState } = useConsent();

  const trackEvent = (eventName: string, data?: Record<string, unknown>) => {
    if (!consentState.consent.analytics || !GTM_ID) return;

    if (typeof window !== 'undefined' && (window as any).dataLayer) {
      (window as any).dataLayer.push({
        event: eventName,
        ...data,
      });
    }
  };

  const trackPageView = (path: string) => {
    trackEvent('page_view', { page_path: path });
  };

  return { trackEvent, trackPageView };
}

export function initializeGTM() {
  if (!GTM_ID) {
    console.warn('[GTM] VITE_GTM_ID not configured');
    return;
  }

  // Initialize dataLayer
  (window as any).dataLayer = (window as any).dataLayer || [];
  (window as any).dataLayer.push({
    'gtm.start': new Date().getTime(),
    event: 'gtm.js',
  });

  // Load GTM script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(script);
}
