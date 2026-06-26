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
 * Why renderToStaticMarkup and not renderToString? We don't need the
 * data-react attributes — there is no hydration step on the marketing
 * surface (the client mount is `createRoot().render()`, which replaces
 * server HTML in place). Static markup is smaller and free of hydration
 * warnings.
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
// must NOT be prerendered (would snapshot a "loading…" shell).
const ROUTES = [
  '/',
  '/pricing',
  '/methodology',
  '/sample-report',
  '/security',
  '/contact',
  '/privacy',
  '/terms',
  '/dpa',
];

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
      const out = templateHtml.replace('<div id="root"></div>', `<div id="root">${html}</div>`);

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