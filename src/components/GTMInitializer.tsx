import { useEffect } from 'react';
import { useConsent } from '../lib/consent-context';
import { initializeGTM } from '../lib/gtm';

export default function GTMInitializer() {
  const { consentState } = useConsent();

  useEffect(() => {
    if (consentState.consent.analytics) {
      initializeGTM();
    }
  }, [consentState.consent.analytics]);

  return null;
}
