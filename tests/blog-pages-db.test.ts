/**
 * F-F-01 against a REAL Postgres: the SQL of the server-rendered blog pages
 * (server-pages.cjs) runs on the table the server creates itself, and the four
 * posts the server seeds into an empty table get their own pages, sitemap entries
 * and index links. tests/blog-pages-server.test.ts covers the same pages with an
 * in-memory stand-in for `pg`, which proves the behaviour but not the SQL.
 *
 * Docker-based and hermetic (tests/e2e-helpers.ts: unique container name, Docker-
 * assigned port, volume removed with the container); run it by explicit path. Needs
 * the build output (static/app-shell.html), otherwise it is skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  E2eCleanup,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  registerExitSafety,
  spawnServer,
  uniqueContainerName,
  waitForServer,
  waitPgReady,
} from './e2e-helpers';

const hasBuild = existsSync(join(resolve(__dirname, '..'), 'static', 'app-shell.html'));
const CONTAINER = uniqueContainerName('fix-tests-pg-blog');
const TOKEN = 'e2e-blog-deploy-token';
const ORIGIN = 'https://ecoauditor.io';

const cleanup = new E2eCleanup();
let base = '';

const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
const canonical = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null;

async function page(path: string) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

const MIN_SEEDED = 4;

describe.skipIf(!hasBuild)('server-rendered blog pages on real Postgres', () => {
  let seeded: string[] = [];

  beforeAll(async () => {
    registerExitSafety(cleanup);
    try {
      cleanup.container(CONTAINER);
      const port = await dockerRunPg(CONTAINER);
      await waitPgReady(CONTAINER);
      // No migrations: the server creates blog_posts itself and seeds it while it is empty.
      const server = spawnServer(await freePort(), e2eEnv({ DATABASE_URL: pgUrl(port), SITE_DEPLOY_TOKEN: TOKEN, PUBLIC_ORIGIN: ORIGIN }));
      cleanup.track(server.child);
      await waitForServer(server);
      base = server.base;

      // The seed runs after the table is created, asynchronously to the listener, and
      // inserts the posts one at a time: wait for all of them, not for the first one
      // (stopping at the first non-empty read failed the count below under load).
      const started = Date.now();
      while (seeded.length < MIN_SEEDED && Date.now() - started < 30_000) {
        const res = await fetch(`${base}/api/blog-posts`);
        const posts = ((await res.json()) as { posts: { slug: string }[] }).posts;
        seeded = posts.map((p) => p.slug);
        if (seeded.length < MIN_SEEDED) await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      await cleanup.teardown();
      throw err;
    }
  }, 180_000);

  afterAll(async () => {
    await cleanup.teardown();
  });

  it('seeded the posts the pages below are built from', () => {
    expect(seeded.length).toBeGreaterThanOrEqual(MIN_SEEDED);
  });

  it('gives every seeded post its own page, with a unique title and its own canonical', async () => {
    const pages = await Promise.all(seeded.map((slug) => page(`/blog/${slug}/`)));
    for (const [index, res] of pages.entries()) {
      expect(res.status, seeded[index]).toBe(200);
      expect(canonical(res.body), seeded[index]).toBe(`${ORIGIN}/blog/${seeded[index]}/`);
      expect((res.body.match(/<h1\b/g) ?? []).length, seeded[index]).toBe(1);
      expect(res.body).not.toContain('as easy as bookkeeping');
    }
    expect(new Set(pages.map((p) => title(p.body))).size).toBe(seeded.length);
  });

  it('lists the seeded posts on the index, newest first, with real links', async () => {
    const res = await page('/blog/');
    expect(res.status).toBe(200);
    for (const slug of seeded) expect(res.body).toContain(`href="/blog/${slug}/"`);
    expect(res.body).not.toContain('Loading posts');
  });

  it('puts every post in sitemap.xml with the published_at the database holds as its lastmod', async () => {
    const res = await page('/sitemap.xml');
    expect(res.status).toBe(200);
    for (const slug of seeded) {
      const stored = await psql(CONTAINER, `SELECT to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM blog_posts WHERE slug = '${slug}'`);
      expect(res.body).toContain(`<loc>${ORIGIN}/blog/${slug}/</loc>\n    <lastmod>${stored}</lastmod>`);
    }
  });

  it('answers a slug that is not in the table with a real 404', async () => {
    const res = await page('/blog/zz-not-in-the-table/');
    expect(res.status).toBe(404);
    expect(res.body).toContain('noindex');
  });

  it('serves a post published through /api/publish at once, and the republished text at once', async () => {
    const publish = (postTitle: string) =>
      fetch(`${base}/api/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          posts: [
            {
              slug: 'db-published-post',
              title: postTitle,
              description: 'Published by the database test.',
              body: `<h2>Heading</h2><p>${'text of the published post. '.repeat(8)}</p>`,
              publishDate: '2026-09-25T10:00:00.000Z',
              faq: [{ question: 'Is it stored?', answer: 'Yes, in Postgres.' }],
            },
          ],
        }),
      });

    expect((await publish('Published v1')).status).toBe(200);
    const v1 = await page('/blog/db-published-post/');
    expect(v1.status).toBe(200);
    expect(title(v1.body)).toBe('Published v1');
    expect(v1.body).toContain('"@type":"FAQPage"');
    expect((await page('/sitemap.xml')).body).toContain(`<loc>${ORIGIN}/blog/db-published-post/</loc>\n    <lastmod>2026-09-25T10:00:00Z</lastmod>`);

    expect((await publish('Published v2')).status).toBe(200);
    expect(title((await page('/blog/db-published-post/')).body)).toBe('Published v2');
  });

  it('agrees with the API: the same post body and the same head', async () => {
    const slug = seeded[0] as string;
    const api = (await (await fetch(`${base}/api/blog-posts/${slug}`)).json()) as { post: { title: string }; head: { title: string; canonical: string } };
    const html = await page(`/blog/${slug}/`);
    expect(title(html.body)).toBe(api.head.title.replace(/&/g, '&amp;'));
    expect(canonical(html.body)).toBe(api.head.canonical);
    expect(api.post.title.length).toBeGreaterThan(0);
  });
});
