import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme';
import { ConsentProvider } from './lib/consent-context';
import { initializeGTM } from './lib/gtm';
import App from './App';
import './index.css';

// Initialize GTM on app load
if (typeof window !== 'undefined') {
  initializeGTM();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ConsentProvider>
          <App />
        </ConsentProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);