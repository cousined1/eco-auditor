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
import { existsSync, readFileSync } from 'node:fs';
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
  '/blog',
  '/login',
  '/signup',
  '/forgot-password',
];

// P0-01: noindex these routes so search engines don't index auth pages.
// The static HTML gets a noindex,nofollow robots meta replacing the
// homepage's index,follow (verified single occurrence — I5 regex risk).
const NOINDEX_ROUTES = new Set(['/login', '/signup', '/forgot-password']);

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
    description: 'Eco-Auditor security and trust: AES-256 encryption, TLS 1.2+ in transit. SOC 2 is being pursued. GDPR-aligned DPA.',
  },
  '/pricing': {
    title: 'Pricing — Eco-Auditor | Carbon Accounting Plans for SMBs',
    // "no card required" removed — starting a trial from /pricing goes through
    // Stripe Checkout, which collects a card. Annual pricing added because the
    // page defaults to the annual toggle and displayed $124/$333/$833 while this
    // description advertised $149/$399/$999.
    // See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-7, L-2).
    description: 'Eco-Auditor pricing: Starter $149/mo or $1,490/year, Growth $399/mo or $3,990/year, Pro $999/mo or $9,990/year. 14-day trial on monthly Starter and Growth. Choosing a plan at checkout asks for a card.',
  },
  '/sample-report': {
    title: 'Sample Carbon Report — Eco-Auditor | See What You Get',
    description: 'See a sample Eco-Auditor carbon report. Scope totals, factor register, and evidence index for a fictional company. Some Scope 3 factors in the sample are provisional.',
  },
  '/login': {
    title: 'Sign In — Eco-Auditor',
    description: 'Sign in to Eco-Auditor to access your emissions dashboard, reports, and settings.',
  },
  '/signup': {
    title: 'Start Your Free Trial — Eco-Auditor',
    // "read-only" was wrong: at trial end without a paid plan the dashboard and
    // calculation APIs return 402 — access is paused, not read-only (claims.ts).
    // See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-6).
    description: 'Start your 14-day free Eco-Auditor trial. No card required when you sign up directly. Cancel anytime before the trial ends; access is paused until you select a paid plan.',
  },
  '/forgot-password': {
    title: 'Reset Your Password — Eco-Auditor',
    description: 'Reset your Eco-Auditor password and regain access to your emissions dashboard.',
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
    description: 'Eco-Auditor Terms of Service — the agreement governing your use of the Eco-Auditor platform.',
  },
  '/blog': {
    title: 'Blog — Eco-Auditor | Carbon Accounting for SMBs',
    description: 'Eco-Auditor blog: practical carbon accounting guidance for small and mid-size businesses — Scope 1-3 baselines, supplier data collection, and disclosure readiness.',
  },
  '/dpa': {
    title: 'Data Processing Addendum — Eco-Auditor',
    description: 'Eco-Auditor Data Processing Addendum — GDPR-aligned terms for EU customers.',
  },
};

/**
 * The four posts in server.cjs are the copy this build should publish.
 * A live database can still hold an older body because the first seed used
 * ON CONFLICT DO NOTHING. Seeded slugs therefore win. Database rows are used
 * for published_at and for any extra slug that is not in the seed.
 */
function loadSeedPosts() {
  const src = readFileSync(path.join(ROOT, 'server.cjs'), 'utf8');
  const start = src.indexOf('async function seedBlogPosts');
  const postsAt = src.indexOf('const posts = [', start);
  if (postsAt < 0) throw new Error('seed posts array not found');
  const end = src.indexOf('\n  ];', postsAt);
  const arrayText = src.slice(postsAt + 'const posts = '.length, end + '\n  ];'.length);
  return new Function('JSON', 'return ' + arrayText)(JSON);
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toDetail(post, publishedAt) {
  const faq = parseJson(post.faq, []);
  const cta = parseJson(post.cta, null);
  const published = publishedAt ? new Date(publishedAt) : null;
  return {
    id: String(post.id),
    slug: post.slug,
    title: post.title || '',
    meta_title: post.meta_title || post.title || '',
    meta_description: post.meta_description || '',
    body_html: post.body_html || '',
    primary_keyword: post.primary_keyword || '',
    faq: Array.isArray(faq) ? faq : [],
    cta: cta && cta.href ? { label: cta.label || '', href: cta.href } : null,
    published_at: published && !Number.isNaN(published.getTime()) ? published.toISOString() : '',
  };
}

function toListCard(detail) {
  return {
    id: detail.id,
    slug: detail.slug,
    title: detail.title,
    meta_description: detail.meta_description,
    excerpt: excerptFor(detail),
    read_minutes: readMinutesFor(detail.body_html),
    primary_keyword: detail.primary_keyword || null,
    published_at: detail.published_at,
  };
}

/**
 * Blog posts for the prerendered /blog index and for each /blog/<slug> page.
 *
 * renderToString never runs effects, so the index used to ship with zero
 * /blog/<slug> links. The seeded posts are in server.cjs and are prerendered
 * even when DATABASE_URL is absent. DATABASE_URL adds published_at and any
 * extra slug that is not one of the four seeded posts.
 */
async function loadBlogDetails() {
  let seed = [];
  try {
    seed = loadSeedPosts();
  } catch (err) {
    console.warn(`[prerender] could not read seeded posts (${String(err)})`);
  }

  const url = process.env.DATABASE_URL;
  let dbRows = [];
  if (!url) {
    console.warn(
      '[prerender] DATABASE_URL not set — database-only posts are omitted.\n' +
      '            Seeded posts in server.cjs are still prerendered.'
    );
  } else {
    let Pool;
    try {
      ({ Pool } = (await import('pg')).default ?? (await import('pg')));
    } catch {
      console.warn('[prerender] pg module unavailable — database-only posts are omitted.');
    }
    if (Pool) {
      const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000 });
      try {
        // Same projection family as server.cjs /api/blog-posts.
        const { rows } = await pool.query(
          'SELECT id, slug, title, meta_title, meta_description, body_html, primary_keyword, faq, cta, published_at FROM blog_posts ORDER BY published_at DESC LIMIT 50'
        );
        dbRows = rows;
      } catch (err) {
        console.warn(`[prerender] blog post query failed (${String(err)}) — database-only posts are omitted.`);
      } finally {
        await pool.end().catch(() => {});
      }
    }
  }

  const dbBySlug = new Map(dbRows.map((row) => [row.slug, row]));
  const details = [];
  for (const post of seed) {
    const db = dbBySlug.get(post.slug);
    details.push(toDetail(post, db ? db.published_at : ''));
    dbBySlug.delete(post.slug);
  }
  for (const row of dbBySlug.values()) {
    details.push(toDetail(row, row.published_at));
  }
  if (details.length === 0) {
    console.warn('[prerender] no blog posts to prerender — the index will ship WITHOUT post links.');
  }
  return details;
}

/** Mirrors blogListExcerpt() in server.cjs so the two lists read identically. */
function excerptFor(row) {
  const meta = row.meta_description && String(row.meta_description).trim();
  if (meta) return meta;
  // `<[^\n>]*>` — not `<[\n>]*>`. The negated class is what stops a tag from
  // being swallowed across line breaks.
  const text = String(row.body_html || '').slice(0, 100000).replace(/<[^\n>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const sliced = text.slice(0, 160);
  const lastSpace = sliced.lastIndexOf(' ');
  return sliced.slice(0, lastSpace > 80 ? lastSpace : 160) + '\u2026';
}

/** Mirrors blogListReadMinutes() in server.cjs. */
function readMinutesFor(html) {
  const text = String(html || '').slice(0, 100000).replace(/<[^\n>]*>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

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

  const blogDetails = await loadBlogDetails();
  const blogPosts = blogDetails.length > 0 ? blogDetails.map(toListCard) : null;
  if (blogPosts) {
    console.log(`[prerender] blog index: ${blogPosts.length} posts available for /blog`);
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  async function writeRoute(route, html, head) {
    let out = templateHtml.replace('<div id="root"></div>', `<div id="root">${html}</div>`);

    if (NOINDEX_ROUTES.has(route)) {
      out = out.replace(
        /<meta name="robots" content="index, follow" \/>/,
        '<meta name="robots" content="noindex,nofollow" />',
      );
    }

    if (head) {
      if (head.title) {
        const title = escapeAttr(head.title);
        out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`);
        out = out.replace(
          /<meta property="og:title" content="[^"]*" \/>/,
          `<meta property="og:title" content="${title}" />`,
        );
        out = out.replace(
          /<meta name="twitter:title" content="[^"]*" \/>/,
          `<meta name="twitter:title" content="${title}" />`,
        );
      }
      if (head.description) {
        const description = escapeAttr(head.description);
        out = out.replace(
          /(<meta name="description" content=")[^"]*(")/,
          (_, p1, p2) => `${p1}${description}${p2}`,
        );
        out = out.replace(
          /<meta property="og:description" content="[^"]*" \/>/,
          `<meta property="og:description" content="${description}" />`,
        );
        out = out.replace(
          /<meta name="twitter:description" content="[^"]*" \/>/,
          `<meta name="twitter:description" content="${description}" />`,
        );
      }

      if (NOINDEX_ROUTES.has(route)) {
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
        out = out.replace(
          /(<meta name="twitter:url" content=")[^"]*(" \/>)/,
          (_, p1, p2) => `${p1}${canonical}${p2}`,
        );
      }

      if (head.jsonLd) {
        const jsonLd = JSON.stringify(head.jsonLd, null, 2)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/&/g, '\\u0026');
        out = out.replace(
          /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
          `<script type="application/ld+json">\n    ${jsonLd}\n    </script>`,
        );
      }
    }

    if (route === '/') {
      await fs.writeFile(TEMPLATE_PATH, out, 'utf8');
    } else {
      const routeDir = path.join(STATIC_DIR, route);
      await fs.mkdir(routeDir, { recursive: true });
      await fs.writeFile(path.join(routeDir, 'index.html'), out, 'utf8');
    }
  }

  let ok = 0;
  let fail = 0;
  for (const route of ROUTES) {
    try {
      const html = render(route, { blogPosts });
      if (!html || html.length < 50) {
        throw new Error(`rendered output suspiciously short (${html.length} chars)`);
      }
      await writeRoute(route, html, HEAD[route]);
      console.log(`[prerender] ✓ ${route}  (${html.length} chars)`);
      ok += 1;
    } catch (err) {
      console.error(`[prerender] ✗ ${route} failed:`, err && err.message ? err.message : err);
      fail += 1;
    }
  }

  for (const detail of blogDetails) {
    const route = `/blog/${detail.slug}`;
    try {
      const html = render(route, { blogPosts, blogDetail: detail });
      if (!html || !html.includes(detail.title)) {
        throw new Error('rendered post is missing its title');
      }
      const canonical = `https://ecoauditor.io/blog/${detail.slug}/`;
      const title = detail.meta_title || detail.title;
      await writeRoute(route, html, {
        title: title.includes('Eco-Auditor') ? title : `${title} | Eco-Auditor`,
        description: detail.meta_description,
        canonical,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: detail.title,
          description: detail.meta_description || undefined,
          url: canonical,
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          datePublished: detail.published_at || undefined,
          dateModified: detail.published_at || undefined,
          publisher: { '@type': 'Organization', name: 'Eco-Auditor', url: 'https://ecoauditor.io' },
          isPartOf: { '@type': 'Blog', name: 'Eco-Auditor Blog', url: 'https://ecoauditor.io/blog/' },
        },
      });
      console.log(`[prerender] ✓ ${route}  (${html.length} chars)`);
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
