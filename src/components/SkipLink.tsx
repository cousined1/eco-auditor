/**
 * "Skip to main content", the first tab stop of a page (WCAG 2.4.1). Every shell
 * (marketing header, legal pages, the app shell with its dozen sidebar controls)
 * has a `main#main-content` landmark, but nothing let a keyboard user jump to
 * it, so the whole navigation had to be tabbed through on every page.
 *
 * Visually hidden until it takes focus.
 */
export default function SkipLink() {
  return (
    <a
      href="#main-content"
      onClick={(event) => {
        // Follow the anchor by hand: a real hash navigation would push
        // /page#main-content into history and reach the router as a page change.
        const main = document.getElementById('main-content');
        if (!main) return;
        event.preventDefault();
        main.focus();
        main.scrollIntoView();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg dark:focus:bg-surface-900 dark:focus:text-brand-300"
    >
      Skip to main content
    </a>
  );
}
