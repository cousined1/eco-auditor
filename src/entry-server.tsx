/**
 * Server entry — exports render(url) used by scripts/prerender.mjs.
 *
 * Pure-presentational render of the SAME providers + <App /> used by the
 * client (main.tsx). All browser-only access (window, localStorage,
 * document, GTM, matchMedia) is already guarded inside the providers with
 * `typeof window !== 'undefined'` checks, so renderToStaticMarkup is safe.
 *
 * IMPORTANT: do not import any code path that calls insforge.auth /
 * insforge.database at module top-level. Marketing components only touch
 * InsForge inside event handlers, so the static render never issues a
 * network call.
 */
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme';
import { ConsentProvider } from './lib/consent-context';
import App from './App';

export function render(url: string): string {
  return renderToString(
    <StaticRouter location={url}>
      <ThemeProvider>
        <ConsentProvider>
          <App />
        </ConsentProvider>
      </ThemeProvider>
    </StaticRouter>,
  );
}