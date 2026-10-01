import { useTheme } from '../hooks/useTheme';

// The moon was a `M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 …` outline: two
// concentric circles, which renders as an empty ring and tells nobody what the
// button does. This is a crescent between two circles of equal radius.
function MoonIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

/**
 * The one light/dark switch. Header renders it on every public page and the app
 * shell renders it in its own top bar, so no page has to remember to pass one in
 * (three pages did and every other page shipped without a theme control).
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
