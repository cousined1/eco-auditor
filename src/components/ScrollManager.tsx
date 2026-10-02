import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Gives every client-side page change the "new page" behaviour a full load has:
 * the view starts at the top and focus lands in the main landmark instead of
 * staying on the link that was just followed.
 *
 * The scroll reset has to hit the element that actually scrolls. On the
 * marketing pages that is the window. In the app shell it is <main>
 * (`overflow-y-auto` inside an `h-screen overflow-hidden` frame), so
 * `window.scrollTo` did nothing there: opening Pricing from the bottom of the
 * Calculator landed mid-page with no heading, and keyboard and screen-reader
 * users stayed on the sidebar link with no sign the page had changed.
 *
 * Only a change of pathname moves focus. A query-only change (the checkout
 * banner cleaning its own params) does not re-run this at all, and a hash change
 * scrolls its anchor into view without stealing focus. Neither does the first
 * render: that is a page load, where the browser has already put focus at the top
 * of the document, and the first Tab should reach the first control in document
 * order (the cookie banner on a first visit, the skip link after it). Moving
 * focus into <main> there made the first Tab skip both (D-6).
 */
export default function ScrollManager() {
  const { pathname, hash } = useLocation();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    const initialLoad = lastPathname.current === null;
    const pathnameChanged = lastPathname.current !== pathname;
    lastPathname.current = pathname;

    if (hash) {
      // In-page anchor: honour the target rather than jumping to the top.
      document.getElementById(hash.slice(1))?.scrollIntoView();
      return;
    }

    const main = document.getElementById('main-content') ?? document.querySelector<HTMLElement>('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
    if (pathnameChanged && !initialLoad) main?.focus({ preventScroll: true });
  }, [pathname, hash]);

  return null;
}
