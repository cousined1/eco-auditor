import { useState } from 'react';
import { useConsent } from '@/lib/consent-context';
import { useFocusTrap } from '../hooks/useFocusTrap';

export function CookieConsentBanner() {
  const { consentState, acceptAll, rejectAll } = useConsent();
  const [showPreferences, setShowPreferences] = useState(false);

  if (consentState.hasConsented) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Cookie consent"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-700 shadow-lg"
      >
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">
                We value your privacy
              </h2>
              <p className="text-sm text-surface-600 dark:text-surface-300">
                We use cookies to keep you signed in and to understand how the site is used. We do not use cookies for personalized advertising and we do not sell your data.{" "}
                <a href="/privacy" className="text-brand-600 hover:text-brand-700 underline">
                  Learn more
                </a>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={rejectAll}
                className="px-4 py-2 border-2 border-brand-600 text-brand-700 dark:text-brand-300 bg-white dark:bg-surface-900 rounded-lg hover:bg-brand-50 dark:hover:bg-surface-800 transition-colors text-sm font-semibold dark:border-brand-400"
              >
                Reject Non-Essential
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-semibold"
              >
                Accept All
              </button>
              <button
                type="button"
                onClick={() => setShowPreferences(true)}
                className="px-4 py-2 border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors text-sm font-medium dark:border-surface-600 dark:text-white dark:hover:bg-surface-800"
              >
                Manage Preferences
              </button>
            </div>
          </div>
        </div>
      </div>
      {showPreferences && (
        <CookiePreferencesModal onClose={() => setShowPreferences(false)} />
      )}
    </>
  );
}

function CookiePreferencesModal({ onClose }: { onClose: () => void }) {
  const { consentState, updateConsent } = useConsent();
  const [localConsent, setLocalConsent] = useState(consentState.consent);
  // aria-modal alone does not contain the keyboard — Tab used to walk straight
  // out of this dialog into the page behind it.
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);

  const handleSave = () => {
    updateConsent(localConsent);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-preferences-title"
        className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-md w-full p-6"
      >
        <h3 id="cookie-preferences-title" className="text-xl font-semibold text-surface-900 dark:text-white mb-4">
          Cookie Preferences
        </h3>
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="cookie-consent-necessary" className="block font-medium text-surface-900 dark:text-white">Strictly Necessary</label>
              <p className="text-sm text-surface-500">Required for the site to function</p>
            </div>
            <input
              id="cookie-consent-necessary"
              type="checkbox"
              checked={true}
              disabled
              className="h-5 w-5 rounded border-surface-300"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="cookie-consent-analytics" className="block font-medium text-surface-900 dark:text-white">Analytics</label>
              <p className="text-sm text-surface-500">Helps us improve our website</p>
            </div>
            <input
              id="cookie-consent-analytics"
              type="checkbox"
              checked={localConsent.analytics}
              onChange={(e) => setLocalConsent({ ...localConsent, analytics: e.target.checked })}
              className="h-5 w-5 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="cookie-consent-preferences" className="block font-medium text-surface-900 dark:text-white">Preferences</label>
              <p className="text-sm text-surface-500">Remember your settings</p>
            </div>
            <input
              id="cookie-consent-preferences"
              type="checkbox"
              checked={localConsent.preferences}
              onChange={(e) => setLocalConsent({ ...localConsent, preferences: e.target.checked })}
              className="h-5 w-5 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="cookie-consent-marketing" className="block font-medium text-surface-900 dark:text-white">Marketing</label>
              <p className="text-sm text-surface-500">Personalized advertisements</p>
            </div>
            <input
              id="cookie-consent-marketing"
              type="checkbox"
              checked={localConsent.marketing}
              onChange={(e) => setLocalConsent({ ...localConsent, marketing: e.target.checked })}
              className="h-5 w-5 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors font-medium"
          >
            Save Preferences
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors font-medium dark:border-surface-600 dark:text-white dark:hover:bg-surface-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
