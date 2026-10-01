'use strict';

/**
 * Express handlers for the pages the server renders per request (audit F-F-01,
 * F-F-03, F-C-25): /blog/, /blog/<slug>/, /sitemap.xml, the neutral app shell and
 * the 404 for every URL nothing else answers. server.cjs mounts the first three
 * BEFORE express.static and the last two as its SPA fallback;
 * server-blog-render.cjs builds the HTML.
 *
 *  - A post is read from blog_posts by slug and rendered into static/app-shell.html
 *    (scripts/prerender.mjs writes it). An unknown or malformed slug gets a real
 *    404 and the shell with `noindex`, never the homepage.
 *  - An unknown URL anywhere else gets the same: status 404, the shell, `noindex`.
 *    The client router has no route for it and renders its NotFound screen, the
 *    one page a dead end looks like, whichever side answered.
 *  - A database that cannot answer is 503 + Retry-After, not 404: a crawler keeps
 *    the URL it already has instead of dropping it after a blip.
 *  - Reads are cached in memory for a minute and dropped whenever /api/publish
 *    succeeds, so a published post is live at once and a crawler burst does not
 *    become a query per request.
 *  - HTML is `no-cache` as before: the shell names hashed assets that change per
 *    deploy. Express adds an ETag, so an unchanged page revalidates to a 304.
 */

const fs = require('node:fs');
const path = require('node:path');
const render = require('./server-blog-render.cjs');

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 100; // a post is tens of kB: a few MB at most
const INDEX_LIMIT = 50; // the same page size as GET /api/blog-posts
const SITEMAP_LIMIT = 5000;
const UNDEFINED_TABLE = '42P01';
const HTML_CACHE_CONTROL = 'no-cache, no-transform';
// The client's NotFound screen sets no <title>, so a 404 names itself in the shell.
const NOT_FOUND_TITLE = 'Page not found — Eco-Auditor';
const TITLE_TAG = /<title>[^<]*<\/title>/u;

const POST_SQL =
  'SELECT id, slug, title, meta_title, meta_description, body_html, primary_keyword, faq, internal_links, external_links, cta, content_score, geo_score, published_at FROM blog_posts WHERE slug = $1 LIMIT 1';
const INDEX_SQL = `SELECT id, slug, title, meta_description, body_html, primary_keyword, content_score, geo_score, published_at FROM blog_posts ORDER BY published_at DESC LIMIT ${INDEX_LIMIT}`;
const SITEMAP_SQL = `SELECT slug, published_at FROM blog_posts ORDER BY published_at DESC LIMIT ${SITEMAP_LIMIT}`;

/** Positive results only, so a flood of made-up slugs cannot grow it; bounded, oldest entry out first. */
function createCache(now) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > CACHE_TTL_MS) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      entries.delete(key);
      if (entries.size >= CACHE_MAX_ENTRIES) entries.delete(entries.keys().next().value);
      entries.set(key, { value, at: now() });
    },
    clear() {
      entries.clear();
    },
  };
}

function queryOf(req) {
  const at = req.originalUrl.indexOf('?');
  return at === -1 ? '' : req.originalUrl.slice(at);
}

/**
 * @param {object} deps
 * @param {object} deps.pgPool         pg Pool (with no database configured, server.cjs passes one
 *                                     that refuses every call: the pages then answer 503)
 * @param {string} deps.staticDir      the built client (Vite output + prerender)
 * @param {string} deps.origin         canonical origin, no trailing slash
 * @param {object} deps.routeMeta      src/content/route-meta.json
 * @param {function} [deps.log]
 * @param {function} [deps.now]
 */
function createPages({ pgPool, staticDir, origin, routeMeta, log = () => {}, now = Date.now }) {
  const cache = createCache(now);

  function readStatic(name) {
    try {
      return fs.readFileSync(path.join(staticDir, name), 'utf8');
    } catch {
      return null;
    }
  }

  // Only successful reads are kept, so a server started before the build finished recovers.
  let shellHtml = null;
  function shell() {
    if (!shellHtml) shellHtml = readStatic('app-shell.html');
    return shellHtml;
  }

  let routePaths = null;
  function staticPaths() {
    if (!routePaths) {
      try {
        const parsed = JSON.parse(readStatic('sitemap-routes.json') || 'null');
        if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string' && p.startsWith('/'))) routePaths = parsed;
      } catch {
        /* falls back below */
      }
    }
    return routePaths || ['/', '/blog/'];
  }

  // ─── Reads: the one path every consumer uses (pages, API, sitemap) ───

  async function query(text, params) {
    try {
      const { rows } = await pgPool.query(text, params);
      return rows;
    } catch (err) {
      if (err && err.code === UNDEFINED_TABLE) return []; // table not created yet: no posts
      throw err;
    }
  }

  /** A published post as GET /api/blog-posts/:slug returns it (body sanitised at read), or null. */
  async function loadPost(slug) {
    const key = `post:${slug}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const rows = await query(POST_SQL, [slug]);
    if (rows.length === 0) return null;
    const post = render.toPublicPost(rows[0]);
    cache.set(key, post);
    return post;
  }

  async function loadIndex() {
    const cached = cache.get('index');
    if (cached) return cached;
    const items = (await query(INDEX_SQL, [])).filter((row) => render.isValidSlug(row.slug)).map(render.toListItem);
    cache.set('index', items);
    return items;
  }

  async function loadSitemapPosts() {
    const cached = cache.get('sitemap');
    if (cached) return cached;
    const posts = await query(SITEMAP_SQL, []);
    cache.set('sitemap', posts);
    return posts;
  }

  // ─── Responses ───

  function sendHtml(res, status, html, options = {}) {
    res.status(status);
    res.setHeader('Cache-Control', options.cacheControl || HTML_CACHE_CONTROL);
    if (options.noindex) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html');
    res.send(html);
  }

  // The neutral shell is what every non-page answer uses: the client router then
  // shows its own "not found" or error UI, and the status code is the truth.
  // Without a build there is no shell; the status still is.
  function sendShell(res, status, options = {}) {
    const html = shell();
    if (!html) {
      const code = status === 200 ? 404 : status;
      res.status(code);
      res.setHeader('Cache-Control', 'no-store');
      res.type('text/plain');
      return res.send(code === 404 ? 'Not found' : code === 503 ? 'Service unavailable' : 'Server error');
    }
    const body = status === 404 ? html.replace(TITLE_TAG, () => `<title>${NOT_FOUND_TITLE}</title>`) : html;
    sendHtml(res, status, body, { noindex: true, ...options });
  }

  // A failure to RENDER is our bug (500); a failure to READ is the database (503, retryable).
  function renderFailure(cause) {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    err.renderFailure = true;
    return err;
  }

  function requireShell() {
    const html = shell();
    if (!html) throw renderFailure('static/app-shell.html is missing: run the build');
    return html;
  }

  function renderOrThrow(build) {
    try {
      return build();
    } catch (err) {
      throw renderFailure(err);
    }
  }

  function unavailable(res, err, what) {
    const dbDown = !(err && err.renderFailure);
    log('error', `${what}: ${dbDown ? 'database read failed' : 'page render failed'}`, { error: err });
    if (dbDown) res.setHeader('Retry-After', '30');
    sendShell(res, dbDown ? 503 : 500, { cacheControl: 'no-store' });
  }

  /** Express 4 does not catch a rejected async handler, and the process exits on an unhandled rejection. */
  function safe(what, handler) {
    return async function pageHandler(req, res) {
      try {
        await handler(req, res);
      } catch (err) {
        if (res.headersSent) {
          log('error', `${what}: failed after the response started`, { error: err });
          return;
        }
        unavailable(res, err, what);
      }
    };
  }

  // ─── Handlers ───

  const blogIndex = safe('GET /blog/', async (req, res) => {
    // The slash form is the canonical one, as for every other route.
    if (!req.path.endsWith('/')) return res.redirect(301, `/blog/${queryOf(req)}`);
    const items = await loadIndex();
    const base = requireShell();
    const html = renderOrThrow(() => render.renderIndexPage(base, items, routeMeta['/blog'], origin));
    return sendHtml(res, 200, html);
  });

  const blogPost = safe('GET /blog/:slug', async (req, res) => {
    const slug = req.params.slug;
    if (!render.isValidSlug(slug)) return sendShell(res, 404);
    const post = await loadPost(slug);
    if (!post) return sendShell(res, 404);
    if (!req.path.endsWith('/')) return res.redirect(301, `/blog/${slug}/${queryOf(req)}`);
    const base = requireShell();
    const html = renderOrThrow(() => render.renderPostPage(base, post, origin));
    return sendHtml(res, 200, html);
  });

  const sitemap = safe('GET /sitemap.xml', async (_req, res) => {
    const posts = await loadSitemapPosts();
    const xml = render.renderSitemapXml({ origin, paths: staticPaths(), posts, now: now() });
    res.status(200);
    res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
    res.type('application/xml');
    return res.send(xml);
  });

  /** /app/* and /auth/*: the client renders them, so the page is an empty, noindex shell. */
  function appShell(_req, res) {
    return sendShell(res, 200);
  }

  /** server.cjs's last handler: a URL no route answers is a 404 that shows the client's NotFound screen. */
  function notFound(_req, res) {
    return sendShell(res, 404);
  }

  return {
    blogIndex,
    blogPost,
    sitemap,
    appShell,
    notFound,
    loadPost,
    headOf: (post) => render.postHead(post, origin),
    /** Called after /api/publish succeeds: the next read sees the new row. */
    invalidate: () => cache.clear(),
  };
}

module.exports = { createPages };
