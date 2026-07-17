/**
 * scripts/prerender.mjs — build-time prerendering of marketing routes.
 *
 * Runs AFTER `vite build` has emitted the client bundle into ./static.
 * Compiles src/entry-server.tsx via Vite's SSR build, then for each
 * marketing route renders the React tree to a string and injects it into
 * the static/index.html template, writing the result to either
 * ./static/index.html (for "/") or ./static/<route>/index.html.
 *
 * No new runtime dependencies. The only node_modules used are already
 * present: vite, react, react-dom, react-router-dom.
 *
 * Why renderToString? entry-server.tsx:14 uses react-dom/server's
 * renderToString (not renderToStaticMarkup). We don't need the
 * data-react attributes — there is no hydration step on the marketing
 * surface (the client mount is `createRoot().render()`, which replaces
 * server HTML in place). renderToString output is smaller and free of
 * hydration warnings.
 *
 * Failure mode: if SSR render throws for any route, this script exits
 * non-zero and the Railway build fails loud — never silently ship an
 * empty body again.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(ROOT, 'static');
const TEMPLATE_PATH = path.join(STATIC_DIR, 'index.html');

// Routes mirrored from public/sitemap.xml — public marketing surface only.
// App routes (/app/*) are auth-gated and excluded by robots.txt, so they
// must NOT be prerendered (would snapshot a "loading…" shell). /login and
// /signup are prerendered (noindex) so non-JS clients and crawlers see
// route-appropriate content instead of the homepage SPA shell (P0-01).
const ROUTES = [
  '/',
  '/pricing',
  '/methodology',
  '/sample-report',
  '/security',
  '/demo',
  '/contact',
  '/privacy',
  '/terms',
  '/dpa',
  '/login',
  '/signup',
];

// P0-01: noindex these routes so search engines don't index auth pages.
// The static HTML gets a noindex,nofollow robots meta replacing the
// homepage's index,follow (verified single occurrence — I5 regex risk).
const NOINDEX_ROUTES = new Set(['/login', '/signup']);

// AF-4: per-route <title> and <meta name="description">. The template
// (static/index.html) has exactly one <title> and one description meta
// (I5 verified), so the regex replace hits the single homepage tag and
// swaps in the route-specific value. Titles mirror the document.title
// each page sets client-side so server HTML and client mount agree.
const HEAD = {
  '/methodology': {
    title: 'Carbon Accounting Methodology — Eco-Auditor | GHG Protocol Alignment',
    description: 'Eco-Auditor’s carbon accounting methodology — GHG Protocol aligned Scope 1, 2, 3 emission factors from EPA, eGRID, GLEC, and EXIOBASE.',
  },
  '/security': {
    title: 'Security & Trust — Eco-Auditor | Data Protection and Compliance',
    description: 'Eco-Auditor security and trust: AES-256 encryption, TLS 1.2+ in transit, SOC 2-aligned controls, GDPR-aligned DPA.',
  },
  '/pricing': {
    title: 'Pricing — Eco-Auditor | Carbon Accounting Plans for SMBs',
    description: 'Eco-Auditor pricing: Starter $149/mo, Growth $399/mo, Pro $999/mo. Reviewable Scope 1-3 emissions tracking. 14-day free trial on monthly plans, no card required.',
  },
  '/sample-report': {
    title: 'Sample Carbon Report — Eco-Auditor | See What You Get',
    description: 'See a sample Eco-Auditor carbon report — Scope 1, 2, 3 emissions breakdown, quality scores, and reviewable ledger entries.',
  },
  '/login': {
    title: 'Sign In — Eco-Auditor',
    description: 'Sign in to Eco-Auditor to access your emissions ledger, reports, and compliance dashboard.',
  },
  '/signup': {
    title: 'Start Your Free Trial — Eco-Auditor',
    description: 'Start your 14-day free Eco-Auditor trial. No card required. Cancel anytime before the trial ends; the workspace becomes read-only until you select a paid plan.',
  },
  '/demo': {
    title: 'Book a Demo — Eco-Auditor | 30-Minute Carbon Accounting Walkthrough',
    description: 'Book a 25–30 minute Eco-Auditor demo. Tell us your goal — Scope 1/2 baseline, Scope 3 supplier collection, SB 253 readiness, or customer carbon-data requests.',
  },
  '/contact': {
    title: 'Contact Us — Eco-Auditor',
    description: 'Contact Eco-Auditor for demos, enterprise pricing, and compliance questions.',
  },
  '/privacy': {
    title: 'Privacy Policy — Eco-Auditor',
    description: 'Eco-Auditor Privacy Policy — how we collect, use, and protect your data.',
  },
  '/terms': {
    title: 'Terms of Service — Eco-Auditor',
    description: 'Eco-Auditor Terms of Service — business draft for review.',
  },
  '/dpa': {
    title: 'Data Processing Addendum — Eco-Auditor',
    description: 'Eco-Auditor Data Processing Addendum — GDPR-aligned terms for EU customers.',
  },
};

async function main() {
  if (!existsSync(TEMPLATE_PATH)) {
    console.error('[prerender] static/index.html not found. Run `vite build` first.');
    process.exit(1);
  }

  console.log('[prerender] Building SSR bundle…');
  // Emit to .ssr/ — added to .gitignore. Single-file build so we can import
  // the render() export directly without a module map.
  await build({
    logLevel: 'warn',
    configFile: false,
    root: ROOT,
    resolve: {
      alias: { '@': path.resolve(ROOT, './src') },
    },
    build: {
      ssr: path.resolve(ROOT, 'src/entry-server.tsx'),
      outDir: path.resolve(ROOT, '.ssr'),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        output: { format: 'esm', entryFileNames: 'entry-server.mjs' },
      },
    },
  });

  const ssrModulePath = path.join(ROOT, '.ssr', 'entry-server.mjs');
  if (!existsSync(ssrModulePath)) {
    console.error('[prerender] SSR entry not emitted at', ssrModulePath);
    process.exit(1);
  }
  const { render } = await import(`file://${ssrModulePath.replace(/\\/g, '/')}`);

  const templateHtml = await fs.readFile(TEMPLATE_PATH, 'utf8');
  if (!templateHtml.includes('<div id="root"></div>')) {
    console.error('[prerender] index.html template missing <div id="root">');
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (const route of ROUTES) {
    try {
      const html = render(route);
      if (!html || html.length < 50) {
        // A near-empty render is a strong signal something blew up silently.
        throw new Error(`rendered output suspiciously short (${html.length} chars)`);
      }
      let out = templateHtml.replace('<div id="root"></div>', `<div id="root">${html}</div>`);

      // P0-01: noindex auth routes. The template has a single
      // <meta name="robots" content="index, follow" /> (I5 verified), so
      // replace it with noindex,nofollow for /login and /signup.
      if (NOINDEX_ROUTES.has(route)) {
        out = out.replace(
          /<meta name="robots" content="index, follow" \/>/,
          '<meta name="robots" content="noindex,nofollow" />',
        );
      }

      // AF-4: per-route <title> and <meta name="description">. Template has
      // exactly one of each (I5 verified), so the regex hits the single
      // homepage tag. '/' keeps the homepage title/description from the
      // template (no HEAD entry) — that's the canonical homepage meta.
      const head = HEAD[route];
      if (head) {
        if (head.title) {
          out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${head.title}</title>`);
        }
        if (head.description) {
          // Use a function replacement so `$` characters in head.description
          // (e.g. "$149/mo") are not interpreted as capture-group refs.
          out = out.replace(
            /(<meta name="description" content=")[^"]*(")/,
            (_, p1, p2) => `${p1}${head.description}${p2}`,
          );
        }

        // M33: per-route canonical URL and og:url. The template ships the
        // homepage canonical. Use trailing-slash canonicals to match the
        // URLs actually served by the Express static mapping.
        if (NOINDEX_ROUTES.has(route)) {
          // Canonical on noindex pages is contradictory; remove them.
          out = out.replace(/<link rel="canonical" href="[^"]*" \/?>\n? */, '');
          out = out.replace(/<meta property="og:url" content="[^"]*" \/?>\n? */, '');
        } else {
          const canonical = head.canonical || ('https://ecoauditor.io' + (route === '/' ? '' : route) + '/');
          out = out.replace(
            /(<link rel="canonical" href=")[^"]*(" \/>)/,
            (_, p1, p2) => `${p1}${canonical}${p2}`,
          );
          out = out.replace(
            /(<meta property="og:url" content=")[^"]*(" \/>)/,
            (_, p1, p2) => `${p1}${canonical}${p2}`,
          );
        }

        // Sync Open Graph and Twitter title/description to the page meta.
        if (head.title) {
          out = out.replace(
            /<meta property="og:title" content="[^"]*" \/>/,
            `<meta property="og:title" content="${head.title}" />`,
          );
          out = out.replace(
            /<meta name="twitter:title" content="[^"]*" \/>/,
            `<meta name="twitter:title" content="${head.title}" />`,
          );
        }
        if (head.description) {
          out = out.replace(
            /<meta property="og:description" content="[^"]*" \/>/,
            `<meta property="og:description" content="${head.description}" />`,
          );
          out = out.replace(
            /<meta name="twitter:description" content="[^"]*" \/>/,
            `<meta name="twitter:description" content="${head.description}" />`,
          );
        }
      }

      if (route === '/') {
        await fs.writeFile(TEMPLATE_PATH, out, 'utf8');
        console.log(`[prerender] ✓ /  → static/index.html  (${html.length} chars)`);
      } else {
        const routeDir = path.join(STATIC_DIR, route);
        await fs.mkdir(routeDir, { recursive: true });
        await fs.writeFile(path.join(routeDir, 'index.html'), out, 'utf8');
        console.log(`[prerender] ✓ ${route}  → static${route}/index.html  (${html.length} chars)`);
      }
      ok += 1;
    } catch (err) {
      console.error(`[prerender] ✗ ${route} failed:`, err && err.message ? err.message : err);
      fail += 1;
    }
  }

  // Best-effort cleanup of the SSR scratch dir. Keep it small; do not fail
  // the build if rm fails (CI disk will be discarded anyway).
  try { await fs.rm(path.join(ROOT, '.ssr'), { recursive: true, force: true }); } catch { /* noop */ }

  console.log(`[prerender] ${ok} ok, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[prerender] fatal:', err);
  process.exit(1);
});