'use strict';

/**
 * Test-only preload for a spawned `node server.cjs` (node --require <this file>):
 * replaces `pg` with an in-memory blog_posts table, so the server-rendered blog
 * pages, the sitemap and POST /api/publish can be exercised end to end without
 * Postgres or Docker. Like tests/helpers/fake-pg-preload.cjs it is NOT a SQL
 * engine: it recognises exactly the statements server.cjs, server-pages.cjs and
 * server-publish.cjs issue against blog_posts and answers them from memory.
 *
 *   FAKE_PG_POSTS   JSON array of rows to start with
 *   FAKE_PG_MODE    "ok" (default) or "down": every query rejects like an
 *                   unreachable database
 *   FAKE_PG_LOG     optional file; every blog_posts SELECT appends one line, so
 *                   a test can count database reads (the pages cache)
 */

const fs = require('node:fs');
const Module = require('node:module');

const mode = process.env.FAKE_PG_MODE || 'ok';
const logFile = process.env.FAKE_PG_LOG;
const posts = new Map(JSON.parse(process.env.FAKE_PG_POSTS || '[]').map((row) => [row.slug, row]));

function down() {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
}

function byNewest() {
  return [...posts.values()].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

function read(kind) {
  if (logFile) fs.appendFileSync(logFile, `${kind}\n`);
}

// Rows come back the way pg returns them: timestamps as Date objects, JSONB parsed.
function row(stored) {
  return { ...stored, published_at: new Date(stored.published_at) };
}

function answer(text, params) {
  const sql = String(text).replace(/\s+/gu, ' ').trim();
  if (/^SELECT count\(\*\) FROM blog_posts/u.test(sql)) return { rows: [{ count: String(posts.size || 1) }] };
  if (/FROM blog_posts WHERE slug = \$1/u.test(sql)) {
    read('post');
    const found = posts.get(params[0]);
    return { rows: found ? [row(found)] : [] };
  }
  if (/^SELECT slug, published_at FROM blog_posts/u.test(sql)) {
    read('sitemap');
    return { rows: byNewest().map((p) => ({ slug: p.slug, published_at: new Date(p.published_at) })) };
  }
  if (/FROM blog_posts ORDER BY published_at DESC/u.test(sql)) {
    read('list');
    return { rows: byNewest().map(row) };
  }
  return { rows: [] };
}

// The upsert of server-publish.cjs, by parameter position.
function publish(params) {
  const [id, slug, , , title, metaTitle, metaDescription, bodyHtml, primaryKeyword, faq, internalLinks, externalLinks, cta, publishedAt, faqProvided] = params;
  const previous = posts.get(slug);
  posts.set(slug, {
    id: previous ? previous.id : id,
    slug,
    title,
    meta_title: metaTitle,
    meta_description: metaDescription,
    body_html: bodyHtml,
    primary_keyword: primaryKeyword,
    faq: faqProvided || !previous ? JSON.parse(faq) : previous.faq,
    internal_links: JSON.parse(internalLinks),
    external_links: JSON.parse(externalLinks),
    cta: JSON.parse(cta),
    content_score: null,
    geo_score: null,
    published_at: publishedAt,
  });
  return { rows: [], rowCount: 1 };
}

class FakeClient {
  async query(text, params) {
    if (mode === 'down') throw down();
    if (/^INSERT INTO blog_posts/u.test(String(text).trim())) return publish(params);
    return { rows: [], rowCount: 0 };
  }

  release() {}
}

class FakePool {
  on() {
    return this;
  }

  async query(text, params) {
    if (mode === 'down') throw down();
    return answer(text, params);
  }

  async connect() {
    if (mode === 'down') throw down();
    return new FakeClient();
  }
}

const load = Module._load;
Module._load = function (request) {
  if (request === 'pg') return { Pool: FakePool };
  return load.apply(this, arguments);
};
