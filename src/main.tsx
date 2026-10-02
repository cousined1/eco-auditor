import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme';
import { ConsentProvider } from './lib/consent-context';
import GTMInitializer from './components/GTMInitializer';
import App from './App';
import { installClientErrorReporting } from './lib/client-error-report';
import './index.css';

// Before the first render, so an error while mounting is reported too (F-G-08).
installClientErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ConsentProvider>
          <GTMInitializer />
          <App />
        </ConsentProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
