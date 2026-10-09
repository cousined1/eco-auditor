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
import { setPrerenderBlogDetail, setPrerenderBlogPosts, type PrerenderBlogDetail, type PrerenderBlogPost } from './lib/ssrData';
import App from './App';

export interface RenderOptions {
  /** Build-time blog posts, so /blog prerenders with real links. */
  blogPosts?: PrerenderBlogPost[] | null;
  /** The one post /blog/:slug should render into static HTML. */
  blogDetail?: PrerenderBlogDetail | null;
}

export function render(url: string, options: RenderOptions = {}): string {
  // Must be set before renderToString: renderToString never runs effects, so
  // BlogList's fetch could not populate the static HTML by itself.
  setPrerenderBlogPosts(options.blogPosts ?? null);
  setPrerenderBlogDetail(options.blogDetail ?? null);
  try {
    return renderToString(
      <StaticRouter location={url}>
        <ThemeProvider>
          <ConsentProvider>
            <App />
          </ConsentProvider>
        </ThemeProvider>
      </StaticRouter>,
    );
  } finally {
    // Leave the module clean so a later render() cannot inherit stale posts.
    setPrerenderBlogPosts(null);
    setPrerenderBlogDetail(null);
  }
}