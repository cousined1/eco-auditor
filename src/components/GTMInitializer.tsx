import { useEffect } from 'react';
import { useConsent } from '../lib/consent-context';
import { initializeGTM } from '../lib/gtm';

export default function GTMInitializer() {
  const { consentState, privacySignals } = useConsent();
  const { consent } = consentState;

  // The container is loaded only after analytics consent. initializeGTM hands it
  // the whole choice (Consent Mode), so the Marketing toggle reaches the tags too.
  useEffect(() => {
    if (consentState.consent.analytics) {
      initializeGTM(consent, privacySignals);
    }
  }, [consentState.consent.analytics, consent, privacySignals]);

  return null;
}
