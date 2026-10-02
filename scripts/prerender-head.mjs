/**
 * scripts/prerender-head.mjs — the per-route <head> of the prerendered pages.
 *
 * Pure string functions over the index.html template: no build output, no
 * network, so tests/prerender-head.test.ts can run them against the real
 * template on every test run.
 *
 * What lives where (audit F-A-01, F-A-12, F-F-09, F-F-10):
 *   - index.html            site-wide entities only (Organization, WebSite,
 *                           SoftwareApplication) and the homepage defaults.
 *   - src/content/route-meta.json   title + description per route. The pages'
 *                           runtime effects read the same file, so the HTML a
 *                           crawler fetches and the head after JS runs agree.
 *   - src/content/faq.json  FAQ text. The pages render it and this module
 *                           emits FAQPage JSON-LD from it, so structured data
 *                           never says more than the visible page.
 *   - here                  WebPage + BreadcrumbList per route, and FAQPage only
 *                           on the routes that render that FAQ.
 * Previously the homepage's JSON-LD (including an FAQPage) was copied verbatim
 * onto every route.
 *
 * Two further exports serve the server (audit F-F-01, F-F-03): applyShellHead
 * writes the neutral noindex shell (static/app-shell.html) that /app/*, /auth/*
 * and the per-request blog pages (server-blog-render.cjs) start from, and
 * sitemapPaths lists the indexable routes for sitemap.xml.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SITE_URL = 'https://ecoauditor.io';

// Routes mirrored from public/sitemap.xml — public marketing surface only.
// App routes (/app/*) are auth-gated and excluded by robots.txt, so they
// must NOT be prerendered (would snapshot a "loading…" shell). /login and
// /signup are prerendered (noindex) so non-JS clients and crawlers see
// route-appropriate content instead of the homepage SPA shell (P0-01).
export const ROUTES = [
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
  '/blog',
  '/login',
  '/signup',
  '/forgot-password',
];

// P0-01: noindex these routes so search engines don't index auth pages. They get
// no canonical, no og:url and no structured data.
export const NOINDEX_ROUTES = new Set(['/login', '/signup', '/forgot-password']);

// Routes that render an FAQ on the page, and the key of that FAQ in faq.json.
// FAQPage JSON-LD is emitted for these and for no other route.
export const FAQ_KEY_BY_ROUTE = { '/': 'home', '/methodology': 'methodology' };

export function loadRouteData(root = ROOT) {
  const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
  return { routeMeta: readJson('src/content/route-meta.json'), faq: readJson('src/content/faq.json') };
}

export function canonicalFor(route) {
  return `${SITE_URL}${route === '/' ? '' : route}/`;
}

/**
 * The indexable prerendered routes as canonical paths ("/", "/pricing/", ...).
 * prerender.mjs writes them to static/sitemap-routes.json and the server builds
 * sitemap.xml from that file plus the published blog posts, so there is no
 * hand-kept list of URLs (or of lastmod dates) to go stale (F-F-13).
 */
export function sitemapPaths() {
  return ROUTES.filter((route) => !NOINDEX_ROUTES.has(route)).map((route) => canonicalFor(route).slice(SITE_URL.length));
}

const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (value) => escapeText(value).replace(/"/g, '&quot;');

// Fail loud when the template stops matching: a silent no-op is how a
// prerendered page ends up with the homepage's title again.
function swap(html, pattern, replacement, what) {
  if (!pattern.test(html)) throw new Error(`prerender-head: template has no ${what}`);
  return html.replace(pattern, replacement);
}

/** JSON-LD graph for one route, or null on noindex routes. */
export function buildRouteJsonLd(route, { title, description, faqItems }) {
  if (NOINDEX_ROUTES.has(route)) return null;
  const url = canonicalFor(route);
  const crumbs = [{ name: 'Home', item: `${SITE_URL}/` }];
  if (route !== '/') crumbs.push({ name: title.split(' — ')[0], item: url });

  const graph = [
    {
      '@type': route === '/contact' ? 'ContactPage' : 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: title,
      description,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      ...(route === '/' ? { about: { '@id': `${SITE_URL}/#software` } } : {}),
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.item,
      })),
    },
  ];

  if (faqItems && faqItems.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faqItems.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Applies one route's head to an HTML document derived from the index.html
 * template: robots, title, description, canonical, og:* / twitter:* and the
 * route's JSON-LD.
 */
export function applyRouteHead(html, route, { routeMeta, faq }) {
  const meta = routeMeta[route];
  if (!meta) throw new Error(`prerender-head: no entry for ${route} in src/content/route-meta.json`);
  const noindex = NOINDEX_ROUTES.has(route);
  let out = html;

  if (noindex) {
    out = swap(
      out,
      /<meta name="robots" content="index, follow" \/>/,
      '<meta name="robots" content="noindex,nofollow" />',
      'robots meta',
    );
  }

  // Function replacements throughout: "$149/mo" must not be read as a
  // capture-group reference.
  out = swap(out, /<title>[^<]*<\/title>/, () => `<title>${escapeText(meta.title)}</title>`, '<title>');
  out = swap(
    out,
    /(<meta name="description" content=")[^"]*(")/,
    (_, open, close) => `${open}${escapeAttr(meta.description)}${close}`,
    'description meta',
  );

  if (noindex) {
    // A canonical on a noindex page is contradictory; remove it and og:url.
    out = swap(out, /<link rel="canonical" href="[^"]*" \/?>\n? */, '', 'canonical link');
    out = swap(out, /<meta property="og:url" content="[^"]*" \/?>\n? */, '', 'og:url meta');
    out = swap(out, /<meta name="twitter:url" content="[^"]*" \/?>\n? */, '', 'twitter:url meta');
  } else {
    const canonical = canonicalFor(route);
    out = swap(out, /(<link rel="canonical" href=")[^"]*(" \/>)/, (_, open, close) => `${open}${canonical}${close}`, 'canonical link');
    out = swap(out, /(<meta property="og:url" content=")[^"]*(" \/>)/, (_, open, close) => `${open}${canonical}${close}`, 'og:url meta');
    // twitter:url used to keep the homepage URL on every route.
    out = swap(out, /(<meta name="twitter:url" content=")[^"]*(" \/>)/, (_, open, close) => `${open}${canonical}${close}`, 'twitter:url meta');
  }

  // Sync Open Graph and Twitter title/description to the page meta.
  out = swap(out, /<meta property="og:title" content="[^"]*" \/>/, () => `<meta property="og:title" content="${escapeAttr(meta.title)}" />`, 'og:title meta');
  out = swap(out, /<meta name="twitter:title" content="[^"]*" \/>/, () => `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`, 'twitter:title meta');
  out = swap(out, /<meta property="og:description" content="[^"]*" \/>/, () => `<meta property="og:description" content="${escapeAttr(meta.description)}" />`, 'og:description meta');
  out = swap(out, /<meta name="twitter:description" content="[^"]*" \/>/, () => `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`, 'twitter:description meta');

  const faqKey = FAQ_KEY_BY_ROUTE[route];
  const jsonLd = buildRouteJsonLd(route, {
    title: meta.title,
    description: meta.description,
    faqItems: faqKey ? faq[faqKey] : undefined,
  });
  if (jsonLd) {
    // "<" is escaped so no FAQ text can close the script element early.
    const script = `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;
    out = swap(out, /<\/head>/, () => `${script}\n  </head>`, '</head>');
  }
  return out;
}

// What the shell says about itself. Deliberately not the homepage's tagline: the
// shell is served for routes the client renders (/app/*, /auth/*) and must not
// read like, or carry the copy of, any marketing page.
export const SHELL_TITLE = 'Eco-Auditor';
export const SHELL_DESCRIPTION = 'Carbon accounting software for small and mid-size businesses.';

/**
 * The neutral, non-indexable shell: the index.html template with an EMPTY #root
 * and no route's head. static/app-shell.html is this. The server sends it for
 * /app/*, /auth/* and as the body of the blog's 404 and 503 responses, and it is
 * the base that server-blog-render.cjs turns into a blog page, so every tag
 * that module rewrites must exist here (prerender.mjs checks that at build time).
 * Before this the homepage's prerender doubled as the fallback, so every hard
 * load of /app/* or a blog post first painted the marketing hero (F-F-03).
 */
export function applyShellHead(html) {
  let out = swap(
    html,
    /<meta name="robots" content="index, follow" \/>/,
    '<meta name="robots" content="noindex,nofollow" />',
    'robots meta',
  );
  out = swap(out, /<title>[^<]*<\/title>/, () => `<title>${SHELL_TITLE}</title>`, '<title>');
  out = swap(
    out,
    /(<meta name="description" content=")[^"]*(")/,
    (_, open, close) => `${open}${escapeAttr(SHELL_DESCRIPTION)}${close}`,
    'description meta',
  );
  out = swap(out, /<link rel="canonical" href="[^"]*" \/?>\n? */, '', 'canonical link');
  out = swap(out, /<meta property="og:url" content="[^"]*" \/?>\n? */, '', 'og:url meta');
  out = swap(out, /<meta name="twitter:url" content="[^"]*" \/?>\n? */, '', 'twitter:url meta');
  out = swap(out, /<meta property="og:title" content="[^"]*" \/>/, () => `<meta property="og:title" content="${SHELL_TITLE}" />`, 'og:title meta');
  out = swap(out, /<meta name="twitter:title" content="[^"]*" \/>/, () => `<meta name="twitter:title" content="${SHELL_TITLE}" />`, 'twitter:title meta');
  out = swap(out, /<meta property="og:description" content="[^"]*" \/>/, () => `<meta property="og:description" content="${escapeAttr(SHELL_DESCRIPTION)}" />`, 'og:description meta');
  out = swap(out, /<meta name="twitter:description" content="[^"]*" \/>/, () => `<meta name="twitter:description" content="${escapeAttr(SHELL_DESCRIPTION)}" />`, 'twitter:description meta');
  out = swap(out, /<meta property="og:image:alt" content="[^"]*" \/>/, () => `<meta property="og:image:alt" content="${SHELL_TITLE}" />`, 'og:image:alt meta');
  out = swap(out, /<meta name="twitter:image:alt" content="[^"]*" \/>/, () => `<meta name="twitter:image:alt" content="${SHELL_TITLE}" />`, 'twitter:image:alt meta');
  return out;
}
