/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  // localStorage access throws (SecurityError) when the browser blocks storage
  // ("Block all cookies", some private modes). ThemeProvider mounts above the
  // app's ErrorBoundary (main.tsx), so an unguarded throw here would unmount
  // the React root and blank the whole site. Guard both calls — the FOUC
  // bootstrap in index.html and consent-context.tsx already do the same.
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem('eco-theme');
      } catch {
        /* storage unavailable — default theme applies */
      }
      if (stored === 'dark' || stored === 'light') return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('eco-theme', theme);
    } catch {
      /* storage unavailable — theme just won't persist */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
