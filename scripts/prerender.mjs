/**
 * scripts/prerender.mjs — build-time prerendering of marketing routes.
 *
 * Runs AFTER `vite build` has emitted the client bundle into ./static.
 * Compiles src/entry-server.tsx via Vite's SSR build, then for each
 * marketing route renders the React tree to a string and injects it into
 * the static/index.html template, writing the result to either
 * ./static/index.html (for "/") or ./static/<route>/index.html.
 *
 * It also writes two files the server reads at runtime: static/app-shell.html
 * (the untouched template, noindex, empty #root: the fallback for /app/*, /auth/*
 * and the base of the per-request blog pages) and static/sitemap-routes.json (the
 * indexable routes, for sitemap.xml).
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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { ROUTES, SITE_URL, loadRouteData, applyRouteHead, applyShellHead, sitemapPaths } from './prerender-head.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(ROOT, 'static');
const TEMPLATE_PATH = path.join(STATIC_DIR, 'index.html');
// Runtime renderer of the blog pages (they are not known at build time). It is
// exercised below against the shell this script writes.
const blogRender = createRequire(import.meta.url)('../server-blog-render.cjs');

// Per-route <head> (title, description, canonical, og/twitter, robots, JSON-LD)
// comes from scripts/prerender-head.mjs, fed by src/content/route-meta.json and
// src/content/faq.json — the same files the pages read at runtime, so server
// HTML and client mount agree (AF-4, audit F-A-12).

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

  const routeData = loadRouteData(ROOT);

  // The neutral, noindex shell with an empty #root (F-F-03). It is written BEFORE
  // the loop below, which overwrites static/index.html with the homepage render:
  // that render used to double as the fallback for /app/*, /auth/* and every blog
  // URL, so each hard load first painted the marketing hero.
  const shellHtml = applyShellHead(templateHtml);
  await fs.writeFile(path.join(STATIC_DIR, 'app-shell.html'), shellHtml, 'utf8');
  console.log('[prerender] ✓ app shell → static/app-shell.html');

  // The server turns the shell into the blog pages per request. Render a sample
  // now so a template change that breaks those rewrites fails the build, not the
  // first visitor.
  const sample = {
    id: 'build-check',
    slug: 'build-check',
    title: 'Build check',
    meta_title: 'Build check',
    meta_description: 'Build check.',
    body_html: '<p>Build check.</p>',
    primary_keyword: 'build check',
    faq: [{ question: 'Q?', answer: 'A.' }],
    cta: {},
    published_at: new Date(0),
  };
  blogRender.renderPostPage(shellHtml, sample, SITE_URL);
  blogRender.renderIndexPage(shellHtml, [], routeData.routeMeta['/blog'], SITE_URL);

  // The indexable routes, for the server's sitemap.xml (the blog posts are added per request).
  await fs.writeFile(path.join(STATIC_DIR, 'sitemap-routes.json'), `${JSON.stringify(sitemapPaths())}\n`, 'utf8');
  console.log('[prerender] ✓ sitemap routes → static/sitemap-routes.json');

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

      // Robots, title, description, canonical, og/twitter and JSON-LD for this
      // route. Throws if the template no longer has a tag it expects, so a
      // reformatted index.html fails the build instead of shipping the
      // homepage's head on every route.
      out = applyRouteHead(out, route, routeData);

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
