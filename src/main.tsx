import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme';
import { initializeGTM, useGTM } from './lib/gtm';
import App from './App';
import './index.css';

// Initialize GTM on app load
if (typeof window !== 'undefined') {
  initializeGTM();
}

function TrackPageViews() {
  const location = useLocation();
  const { trackPageView } = useGTM();

  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
        <TrackPageViews />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);