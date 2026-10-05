import { useEffect } from 'react';
import { useConsent } from '../lib/consent-context';
import { initializeGTM, teardownGTM, updateGTMConsent } from '../lib/gtm';

export default function GTMInitializer() {
  const { consentState } = useConsent();
  const { analytics, marketing } = consentState.consent;

  useEffect(() => {
    if (analytics) {
      initializeGTM();
    } else {
      // Revocation has to actually stop collection. This branch did not exist,
      // so withdrawing consent left the injected gtm.js running — it kept firing
      // the container's own tags and setting cookies long after the UI and
      // localStorage said analytics was off. The Privacy Policy promises
      // withdrawal "at any time"; that promise was not being kept.
      teardownGTM();
    }
  }, [analytics]);

  useEffect(() => {
    // Forward the signal even when analytics stays off, so a marketing-only
    // grant reaches the container. The `marketing` category was collected,
    // stored and audit-logged but never told GTM, so ad_storage and friends
    // were left at their default with no way to update them.
    updateGTMConsent({ analytics, marketing });
  }, [analytics, marketing]);

  return null;
}
