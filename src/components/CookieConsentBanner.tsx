import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useConsent } from '@/lib/consent-context';
import { useFocusTrap } from '../hooks/useFocusTrap';

// Client-only gate. The prerenderer has no localStorage, so it always rendered
// the banner into the static HTML — then createRoot() replaced the tree on the
// client and the banner repainted, which Lighthouse measured as the page's
// entire 0.212 CLS. useSyncExternalStore returns the server snapshot (false)
// during the static render and the client snapshot (true) in the browser, so
// the banner never reaches the prerendered markup and the first layout the
// user sees is the final one. Expressed this way rather than as a mount effect
// because setState-in-effect triggers a cascading render (react-hooks lint).
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

// Every control shows keyboard focus (WCAG 2.4.7). The global :focus-visible ring
// is teal and was the only thing doing it; the banner sits on white and on the
// brand-green button, so it states its own.
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:focus-visible:outline-brand-300';

// Choosing removes the button that has focus from the page, and focus would fall
// back to <body> (F-C-07). Hand it to the page content first, the same element a
// route change focuses (ScrollManager); preventScroll keeps the visitor where they
// are.
function focusMainContent(): void {
  const main = document.getElementById('main-content') ?? document.querySelector<HTMLElement>('main');
  main?.focus({ preventScroll: true });
}

export function CookieConsentBanner() {
  const { consentState, acceptAll, rejectAll } = useConsent();
  const [showPreferences, setShowPreferences] = useState(false);
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const barRef = useRef<HTMLDivElement>(null);
  const visible = isClient && !consentState.hasConsented;

  // The bar is fixed, so it is drawn over whatever scrolls underneath it. It
  // publishes its height as --consent-h and index.css turns that into bottom
  // padding for the page and scroll-padding for focus: the last links can be
  // scrolled clear of it, and a focused control is never left entirely behind it
  // (WCAG 2.4.11, F-C-07). A fixed element does not reflow anything, so the
  // banner appearing and leaving costs no layout shift.
  useEffect(() => {
    const bar = barRef.current;
    if (!visible || !bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--consent-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--consent-h');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      {/* Compact on purpose (F-C-07, F-F-04): three short lines of small text and
          one row of actions, about 110 px on a 390 px phone. That leaves the hero
          call to action visible, and on the marketing pages the text block is
          smaller than the first thing the page itself paints, so the banner is not
          the page's largest paint. (It was, at 3.8 s on /pricing, when it was
          taller and the page's own first paint was smaller than it.) The wording is
          the policy's: Privacy section 15 says analytics and marketing cookies are
          set only if you consent. */}
      <div
        ref={barRef}
        role="region"
        aria-label="Cookie consent"
        data-consent-banner=""
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-700 shadow-lg"
      >
        <div className="max-w-7xl mx-auto px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="flex-1 text-xs leading-snug text-surface-600 dark:text-surface-300">
              We use cookies to keep you signed in. Analytics and marketing cookies are used only if you consent. We do not sell your data.{' '}
              <a
                href="/privacy/"
                className={`rounded-sm text-brand-700 underline hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200 ${FOCUS_RING}`}
              >
                Learn more
              </a>
              <span aria-hidden="true"> · </span>
              <button
                type="button"
                onClick={() => setShowPreferences(true)}
                className={`rounded-sm font-medium text-brand-700 underline hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200 ${FOCUS_RING}`}
              >
                Manage Preferences
              </button>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  focusMainContent();
                  rejectAll();
                }}
                className={`flex-1 sm:flex-none px-3 py-1.5 border-2 border-brand-600 text-brand-700 dark:text-brand-300 bg-white dark:bg-surface-900 rounded-lg hover:bg-brand-50 dark:hover:bg-surface-800 transition-colors text-xs font-semibold dark:border-brand-400 ${FOCUS_RING}`}
              >
                Reject Non-Essential
              </button>
              <button
                type="button"
                onClick={() => {
                  focusMainContent();
                  acceptAll();
                }}
                className={`flex-1 sm:flex-none px-3 py-1.5 border-2 border-brand-600 bg-brand-600 text-white rounded-lg hover:bg-brand-700 hover:border-brand-700 transition-colors text-xs font-semibold ${FOCUS_RING}`}
              >
                Accept All
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
  const { consentState, updateConsent, privacySignals } = useConsent();
  const [localConsent, setLocalConsent] = useState(consentState.consent);
  // A browser privacy signal outranks this dialog (consent-mode.ts
  // applyPrivacySignals), so the toggle it switches off is shown off and locked
  // instead of accepting a click that would be ignored.
  const analyticsLocked = privacySignals.dnt;
  const marketingLocked = privacySignals.gpc || privacySignals.dnt;
  // aria-modal alone does not contain the keyboard — Tab used to walk straight
  // out of this dialog into the page behind it.
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);

  const handleSave = () => {
    // Saving closes the banner this dialog was opened from, so focus has to move
    // before the trap hands it back to a button that is about to disappear.
    focusMainContent();
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
              <p className="text-sm text-surface-500">{analyticsLocked ? 'Off: your browser sends a Do Not Track signal' : 'Helps us improve our website'}</p>
            </div>
            <input
              id="cookie-consent-analytics"
              type="checkbox"
              checked={localConsent.analytics && !analyticsLocked}
              disabled={analyticsLocked}
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
              <p className="text-sm text-surface-500">{marketingLocked ? 'Off: your browser sends a Global Privacy Control or Do Not Track signal' : 'Personalized advertisements'}</p>
            </div>
            <input
              id="cookie-consent-marketing"
              type="checkbox"
              checked={localConsent.marketing && !marketingLocked}
              disabled={marketingLocked}
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
