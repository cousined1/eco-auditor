'use strict';

/**
 * POST /api/publish — the write side of the blog.
 *
 * SEO AI Regent's SitePublishEndpointAdapter posts scored articles here with a
 * Bearer SITE_DEPLOY_TOKEN. Rows land in the same `blog_posts` table that
 * GET /api/blog-posts and /api/blog-posts/:slug already read, so a published
 * post is live on /blog with no rebuild.
 *
 * The response shape is not free-form — the caller validates it and treats a
 * mismatch as a failed publish. It requires, exactly:
 *
 *   { success: true, status: "published", deployed: ["<slug>", ...],
 *     deployUrl: "<canonical url of the first post>" }
 *
 * `deployed` must contain the slug that was sent and `deployUrl` must match the
 * canonical URL the caller built (same origin + path, no query or fragment),
 * otherwise the publish is recorded as failed even though the row was written.
 *
 * 202 is deliberately never returned: the caller treats "accepted
 * asynchronously" as a failure because it cannot confirm the article landed.
 * Everything here is synchronous and terminal by the time we respond.
 *
 * A post may carry an optional `faq` ([{ question, answer }]). When present it
 * replaces the stored FAQ, which feeds the FAQPage JSON-LD; when absent the
 * stored FAQ is left as it is.
 */

const crypto = require('crypto');

const MAX_POSTS = 10;
const MIN_BODY_LENGTH = 100;
// FAQ bounds. The FAQ renders as plain text and feeds the FAQPage JSON-LD, so
// it is bounded, not sanitised: markup is just text there.
const MAX_FAQ_ITEMS = 20;
const MAX_FAQ_QUESTION_LENGTH = 300;
const MAX_FAQ_ANSWER_LENGTH = 2000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UNDEFINED_TABLE = '42P01';
const SAFE_HTML_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 'strong', 'table',
  'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]);
const VOID_HTML_TAGS = new Set(['br', 'hr']);

// Columns the caller does not send. `cta` is JSONB NOT NULL with no default,
// and BlogPost.tsx renders the CTA only when `cta.href` is set, so an empty
// object is the correct "no CTA" value — inventing a destination here would
// ship a link that may 404.
const EMPTY_JSON = '[]';
const EMPTY_CTA = '{}';

/**
 * Rebuild publisher HTML from an intentionally small formatting allowlist.
 * Attributes are discarded, including URLs, styles, and event handlers. This
 * keeps the blog renderer useful without letting a compromised publisher token
 * persist executable markup that BlogPost.tsx later renders as HTML.
 */
function sanitizeBlogHtml(input) {
  return String(input).replace(/<\/?[^>]+>/gu, (token) => {
    const match = token.match(/^<\s*(\/?)\s*([a-z][a-z0-9]*)/iu);
    if (!match) return '';
    const tag = match[2].toLowerCase();
    if (!SAFE_HTML_TAGS.has(tag)) return '';
    if (VOID_HTML_TAGS.has(tag)) return `<${tag}>`;
    return match[1] ? `</${tag}>` : `<${tag}>`;
  });
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function bearerToken(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Returns an error string, or null when `faq` is a storable FAQ list. */
function validateFaq(faq, at) {
  if (!Array.isArray(faq)) return `${at}.faq must be an array of { question, answer }`;
  if (faq.length > MAX_FAQ_ITEMS) return `${at}.faq may contain at most ${MAX_FAQ_ITEMS} items`;
  for (let i = 0; i < faq.length; i += 1) {
    const item = faq[i];
    const where = `${at}.faq[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return `${where} must be an object`;
    for (const [field, max] of [['question', MAX_FAQ_QUESTION_LENGTH], ['answer', MAX_FAQ_ANSWER_LENGTH]]) {
      if (typeof item[field] !== 'string' || item[field].trim() === '') return `${where}.${field} is required`;
      if (item[field].trim().length > max) return `${where}.${field} is too long (over ${max} characters)`;
    }
  }
  return null;
}

/** Only the two stored keys, trimmed: unknown keys never reach the row. */
function normalizeFaq(faq) {
  return faq.map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }));
}

/** Returns an error string, or null when the post is publishable. */
function validatePost(post, index) {
  const at = `posts[${index}]`;
  if (!post || typeof post !== 'object') return `${at} must be an object`;

  for (const field of ['slug', 'title', 'description', 'body']) {
    if (typeof post[field] !== 'string' || post[field].trim() === '') {
      return `${at}.${field} is required`;
    }
  }
  if (!SLUG_PATTERN.test(post.slug)) {
    return `${at}.slug must be lowercase alphanumeric words separated by single hyphens`;
  }
  if (post.body.length < MIN_BODY_LENGTH) {
    return `${at}.body is too short (${post.body.length} < ${MIN_BODY_LENGTH} characters)`;
  }
  if (/<(?:[^\n>]|$){200,}/.test(post.body)) {
    return `${at}.body contains an unterminated tag run; refusing to store it`;
  }
  // body_html is rendered with dangerouslySetInnerHTML, so markdown would be
  // shown as literal text. Reject rather than store something that renders wrong.
  if (post.bodyFormat != null && post.bodyFormat !== 'html') {
    return `${at}.bodyFormat must be "html" (received "${post.bodyFormat}")`;
  }
  if (typeof post.publishDate !== 'string' || Number.isNaN(Date.parse(post.publishDate))) {
    return `${at}.publishDate must be an ISO 8601 datetime`;
  }
  if (post.faq !== undefined && post.faq !== null) {
    const faqProblem = validateFaq(post.faq, at);
    if (faqProblem) return faqProblem;
  }
  return null;
}

function primaryKeywordOf(post) {
  if (Array.isArray(post.tags)) {
    const first = post.tags.find((t) => typeof t === 'string' && t.trim() !== '');
    if (first) return first.trim();
  }
  return post.title;
}

/**
 * @param {object} deps
 * @param {object} deps.pgPool            pg Pool (with no database configured, server.cjs passes one
 *                                        that refuses every call: publishing then answers 503)
 * @param {string} deps.deployToken       SITE_DEPLOY_TOKEN
 * @param {string} deps.canonicalOrigin   e.g. https://ecoauditor.io
 * @param {string} [deps.target]          autoblog target name stored on each row
 * @param {function} [deps.log]
 */
function createPublishHandler({ pgPool, deployToken, canonicalOrigin, target = 'ecoauditor', log = () => {} }) {
  return async function publishHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    // Misconfiguration is 503, never 401 — otherwise "token not set on this
    // deploy" is indistinguishable from "caller sent the wrong token", and the
    // caller maps 401 to PUBLISH_AUTH and stops retrying.
    if (!deployToken) {
      log('error', 'POST /api/publish: SITE_DEPLOY_TOKEN is not configured');
      return res.status(503).json({ error: 'publish endpoint is not configured' });
    }

    const token = bearerToken(req.headers && req.headers.authorization);
    if (!token || !timingSafeEqualString(token, deployToken)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body;
    const posts = body && Array.isArray(body.posts) ? body.posts : null;
    if (!posts || posts.length === 0) {
      return res.status(400).json({ error: 'posts must be a non-empty array' });
    }
    if (posts.length > MAX_POSTS) {
      return res.status(400).json({ error: `posts may contain at most ${MAX_POSTS} entries` });
    }
    // A slug repeated inside one batch makes the single-transaction upsert fail
    // with "ON CONFLICT DO UPDATE command cannot affect row a second time",
    // which surfaced as an opaque 500 that the caller would retry forever.
    // Reject it up front as the client error it is.
    const seenSlugs = new Set();
    for (let i = 0; i < posts.length; i += 1) {
      const problem = validatePost(posts[i], i);
      if (problem) {
        return res.status(400).json({ error: problem });
      }
      const slug = posts[i].slug;
      if (seenSlugs.has(slug)) {
        return res.status(400).json({ error: `posts[${i}].slug "${slug}" duplicates an earlier post in this request` });
      }
      seenSlugs.add(slug);
    }

    const requestId = typeof body.requestId === 'string' && body.requestId.trim() !== ''
      ? body.requestId.trim()
      : crypto.randomUUID();

    // The connect() acquisition sits INSIDE the try (SVR-R1): a rejected
    // connect() used to escape the async handler at the Express 4 boundary as
    // an unhandled rejection and exit the whole process. The catch below maps
    // that case to 503 before the query-phase handling runs.
    let client;
    try {
      client = await pgPool.connect();
      await client.query('BEGIN');
      for (let i = 0; i < posts.length; i += 1) {
        const post = posts[i];
        // A post that carries `faq` replaces the stored FAQ (an empty array
        // clears it). One that omits it leaves the stored FAQ alone: the
        // publisher does not send one today, and a republish of a post whose
        // FAQ was corrected by hand must not wipe it. Before this, the FAQ was
        // never updated after the first insert, so a wrong FAQ (which feeds the
        // FAQPage JSON-LD) could not be fixed through the normal pipeline.
        const faqProvided = Array.isArray(post.faq);
        // Upsert on slug: the caller retries a failed publish with the same
        // idempotency key and the same content, so a second attempt must
        // succeed rather than collide on the unique index. Slugs are unique
        // per target upstream, so a conflict is always the same article.
        await client.query(
          `INSERT INTO blog_posts (
             id, slug, target, topic_id, title, meta_title, meta_description,
             body_html, primary_keyword, faq, internal_links, external_links,
             cta, content_score, geo_score, published_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,NULL,NULL,$14)
           ON CONFLICT (slug) DO UPDATE SET
             title            = EXCLUDED.title,
             meta_title       = EXCLUDED.meta_title,
             meta_description = EXCLUDED.meta_description,
             body_html        = EXCLUDED.body_html,
             primary_keyword  = EXCLUDED.primary_keyword,
             faq              = CASE WHEN $15::boolean THEN EXCLUDED.faq ELSE blog_posts.faq END,
             published_at     = EXCLUDED.published_at`,
          [
            `${requestId}-${i}`,
            post.slug,
            target,
            post.slug, // the upstream slug is derived from the topic id
            post.title,
            post.title,
            post.description,
            sanitizeBlogHtml(post.body),
            primaryKeywordOf(post),
            faqProvided ? JSON.stringify(normalizeFaq(post.faq)) : EMPTY_JSON,
            EMPTY_JSON,
            EMPTY_JSON,
            EMPTY_CTA,
            new Date(post.publishDate).toISOString(),
            faqProvided,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      if (!client) {
        // Connect failed before any client existed: nothing to roll back or
        // release. Same 503 contract as the other database-unavailable paths.
        log('error', 'POST /api/publish: failed to acquire a database client', { error: err });
        return res.status(503).json({ error: 'database is unavailable' });
      }
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the original error below is the useful one */
      }
      if (err && err.code === UNDEFINED_TABLE) {
        log('error', 'POST /api/publish: blog_posts table is missing');
        return res.status(503).json({ error: 'blog storage is not initialised' });
      }
      log('error', 'POST /api/publish:', { error: err });
      return res.status(500).json({ error: 'failed to publish' });
    } finally {
      // Release only what was actually acquired (SVR-R1).
      if (client) client.release();
    }

    const deployed = posts.map((p) => p.slug);
    const deployUrl = new URL(
      `/blog/${encodeURIComponent(deployed[0])}`,
      canonicalOrigin,
    ).toString();

    log('info', `POST /api/publish: published ${deployed.length} post(s): ${deployed.join(', ')}`);
    return res.status(200).json({
      success: true,
      status: 'published',
      deployed,
      deployUrl,
    });
  };
}

module.exports = {
  createPublishHandler,
  sanitizeBlogHtml,
  __testing: { validatePost, validateFaq, normalizeFaq, bearerToken, timingSafeEqualString, primaryKeywordOf },
};
