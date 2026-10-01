// F-F-01 and F-F-03 over real HTTP: a spawned `node server.cjs` whose `pg` is an
// in-memory blog_posts table (tests/helpers/fake-pg-blog-preload.cjs), serving the
// built client. No Docker, no database, an OS-assigned port. Needs the build output
// (`npm run build`): without static/app-shell.html the suite is skipped (but for the
// API slug block at the end).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const PRELOAD = resolve(__dirname, 'helpers', 'fake-pg-blog-preload.cjs');
const hasBuild = existsSync(join(ROOT, 'static', 'app-shell.html')) && existsSync(join(ROOT, 'static', 'index.html'));
const ORIGIN = 'https://ecoauditor.io';
const TOKEN = 'deploy-token-for-tests';

const POSTS = [
  { slug: 'first-post', title: 'First post: Scope 1 basics', meta_title: 'First post | Eco-Auditor', meta_description: 'The first description.', published_at: '2026-09-01T10:00:00.000Z', faq: [{ question: 'What is Scope 1?', answer: 'Direct emissions.' }] },
  { slug: 'second-post', title: 'Second post: Scope 2', meta_title: 'Second post | Eco-Auditor', meta_description: 'The second description.', published_at: '2026-09-05T12:30:00.000Z', faq: [] },
  { slug: 'third-post', title: 'Third post: Scope 3 <data> & "claims"', meta_title: 'Third post | Eco-Auditor', meta_description: 'The third description.', published_at: '2026-09-09T08:00:00.000Z', faq: [{ question: 'Why </script> matters?', answer: 'It would close the JSON-LD block.' }] },
].map((p, i) => ({
  id: `id-${i}`,
  ...p,
  body_html: `<h1>${p.title}</h1><h2>Section ${i}</h2><p>Body of ${p.slug}.</p>`,
  primary_keyword: 'carbon accounting',
  internal_links: [],
  external_links: [],
  cta: {},
  content_score: null,
  geo_score: null,
}));

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

interface Running {
  base: string;
  child: ChildProcess;
  dbReads: (kind: string) => number;
  stop: () => void;
}

async function start(options: { posts?: unknown[]; mode?: 'ok' | 'down'; database?: boolean }): Promise<Running> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'eco-blog-pages-'));
  const readLog = join(dir, 'reads.log');
  const child = spawn(process.execPath, ['--require', PRELOAD, 'server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      GIT_SHA: 'blog-pages-test',
      DATABASE_URL: options.database === false ? '' : 'postgres://fake:fake@127.0.0.1:1/fake',
      FAKE_PG_POSTS: JSON.stringify(options.posts ?? POSTS),
      FAKE_PG_MODE: options.mode ?? 'ok',
      FAKE_PG_LOG: readLog,
      SITE_DEPLOY_TOKEN: TOKEN,
      PUBLIC_ORIGIN: ORIGIN,
      INSFORGE_URL: '',
      NEXT_PUBLIC_INSFORGE_URL: '',
      INSFORGE_BASE_URL: '',
      VITE_INSFORGE_BASE_URL: '',
      ALLOW_DEV_AUTH: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      CONSENT_IP_PEPPER: 'test-pepper',
      LEAD_NOTIFY_WEBHOOK_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (d) => { log += String(d); });
  child.stderr?.on('data', (d) => { log += String(d); });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  };
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200 || res.status === 503) break;
    } catch { /* not listening yet */ }
    if (child.exitCode !== null || Date.now() - started > 20_000) {
      stop();
      throw new Error(`server did not start:\n${log.slice(-1500)}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const dbReads = (kind: string) => (existsSync(readLog) ? readFileSync(readLog, 'utf8').split('\n').filter((line) => line === kind).length : 0);
  return { base, child, dbReads, stop };
}

interface Page {
  status: number;
  headers: Headers;
  body: string;
}

async function get(app: Running, path: string): Promise<Page> {
  const res = await fetch(`${app.base}${path}`, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const first = (html: string, re: RegExp) => {
  const m = re.exec(html);
  return m ? decode(m[1] ?? '') : null;
};
const title = (html: string) => first(html, /<title>([^<]*)<\/title>/);
const canonical = (html: string) => first(html, /<link rel="canonical" href="([^"]*)"/);
const ogUrl = (html: string) => first(html, /<meta property="og:url" content="([^"]*)"/);
const robots = (html: string) => first(html, /<meta name="robots" content="([^"]*)"/);
const h1s = (html: string) => new DOMParser().parseFromString(html, 'text/html').querySelectorAll('h1');
const jsonLd = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => (JSON.parse(s.textContent ?? '{}') as { '@graph': { '@type': string }[] })['@graph']);
};

describe.skipIf(!hasBuild)('server-rendered blog pages, over HTTP', () => {
  let app: Running;
  beforeAll(async () => { app = await start({}); }, 30_000);
  afterAll(() => app?.stop());

  it.each(POSTS)('serves $slug as its own page: 200, unique title, canonical and og:url', async (post) => {
    const res = await get(app, `/blog/${post.slug}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(title(res.body)).toBe(post.meta_title);
    expect(canonical(res.body)).toBe(`${ORIGIN}/blog/${post.slug}/`);
    expect(ogUrl(res.body)).toBe(`${ORIGIN}/blog/${post.slug}/`);
    expect(robots(res.body)).toBe('index, follow');
    expect(h1s(res.body)).toHaveLength(1);
    expect(h1s(res.body)[0]?.textContent).toBe(post.title);
    expect(res.body).toContain(`Body of ${post.slug}.`);
    // Nothing of the homepage.
    expect(res.body).not.toContain('as easy as bookkeeping');
    expect(res.body).not.toContain('Loading');
  });

  it('gives no two posts the same title, canonical or og:url, and none of them the homepage\'s', async () => {
    const pages = await Promise.all(POSTS.map((p) => get(app, `/blog/${p.slug}/`)));
    for (const pick of [title, canonical, ogUrl]) {
      const values = pages.map((p) => pick(p.body));
      expect(new Set(values).size).toBe(POSTS.length);
    }
    expect(pages.map((p) => canonical(p.body))).not.toContain(`${ORIGIN}/`);
  });

  it('emits valid JSON-LD per post: Article and breadcrumb always, FAQPage only when the post has an FAQ', async () => {
    for (const post of POSTS) {
      const types = jsonLd((await get(app, `/blog/${post.slug}/`)).body).map((n) => n['@type']);
      expect(types).toContain('Article');
      expect(types).toContain('BreadcrumbList');
      expect(types.filter((t) => t === 'FAQPage')).toHaveLength(post.faq.length > 0 ? 1 : 0);
      // The site-wide entities come from the template, once.
      expect(types.filter((t) => t === 'Organization')).toHaveLength(1);
    }
  });

  it('survives a post whose text tries to break out of the page', async () => {
    const third = POSTS[2]!;
    const res = await get(app, `/blog/${third.slug}/`);
    expect(h1s(res.body)[0]?.textContent).toBe(third.title);
    const faq = jsonLd(res.body).find((n) => n['@type'] === 'FAQPage') as unknown as { mainEntity: { name: string }[] };
    expect(faq.mainEntity[0]?.name).toBe('Why </script> matters?');
    const doc = new DOMParser().parseFromString(res.body, 'text/html');
    expect([...doc.querySelectorAll('script')].filter((s) => !s.hasAttribute('type'))).toHaveLength(1);
  });

  it('answers an unknown or malformed slug with a real 404, noindex, and never the homepage', async () => {
    for (const path of ['/blog/zz-no-such-post/', '/blog/zz-no-such-post', '/blog/Not_A_Slug/', '/blog/has%20space/', '/blog/a/b/']) {
      const res = await get(app, path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain('as easy as bookkeeping');
      expect(res.body, path).not.toContain('Start Free Trial');
      expect(res.body.includes('noindex'), path).toBe(true);
    }
    const unknown = await get(app, '/blog/zz-no-such-post/');
    expect(robots(unknown.body)).toBe('noindex,nofollow');
    expect(unknown.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(canonical(unknown.body)).toBeNull();
  });

  it('redirects the bare form of a post to the slash form (one URL per post), keeping the query', async () => {
    const bare = await get(app, '/blog/first-post');
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/blog/first-post/');
    const withQuery = await get(app, '/blog/first-post?utm_source=newsletter');
    expect(withQuery.status).toBe(301);
    expect(withQuery.headers.get('location')).toBe('/blog/first-post/?utm_source=newsletter');
    expect((await get(app, '/blog/first-post/?utm_source=newsletter')).status).toBe(200);
    const index = await get(app, '/blog');
    expect(index.status).toBe(301);
    expect(index.headers.get('location')).toBe('/blog/');
  });

  it('renders the /blog index with every post as a real link, not "Loading posts…"', async () => {
    const res = await get(app, '/blog/');
    expect(res.status).toBe(200);
    for (const post of POSTS) expect(res.body).toContain(`href="/blog/${post.slug}/"`);
    expect(res.body).not.toContain('Loading posts');
    expect(h1s(res.body)).toHaveLength(1);
    expect(canonical(res.body)).toBe(`${ORIGIN}/blog/`);
    // Newest first.
    const order = POSTS.map((p) => res.body.indexOf(`href="/blog/${p.slug}/"`));
    expect(order[2]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[0]!);
  });

  it('lists every published post in sitemap.xml with its lastmod, and no hand-kept dates', async () => {
    const res = await get(app, '/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
    const entries = [...res.body.matchAll(/<url>\s*<loc>([^<]*)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?\s*<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] }));
    const byLoc = new Map(entries.map((e) => [e.loc, e.lastmod]));
    for (const post of POSTS) {
      expect(byLoc.get(`${ORIGIN}/blog/${post.slug}/`), post.slug).toBe(post.published_at.replace(/\.\d{3}Z$/, 'Z'));
    }
    for (const route of ['/', '/pricing/', '/methodology/', '/sample-report/', '/security/', '/demo/', '/contact/', '/privacy/', '/terms/', '/dpa/', '/blog/']) {
      expect(byLoc.has(`${ORIGIN}${route}`), route).toBe(true);
    }
    for (const auth of ['/login/', '/signup/', '/forgot-password/']) expect(byLoc.has(`${ORIGIN}${auth}`), auth).toBe(false);
    expect(byLoc.get(`${ORIGIN}/pricing/`)).toBeUndefined();
  });

  it.each(['/app/x', '/app/dashboard', '/app', '/auth/x', '/auth/callback', '/auth/verify-email'])('does not first-paint the homepage on a hard load of %s', async (path) => {
    const res = await get(app, path);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(h1s(res.body)).toHaveLength(0);
    expect(res.body).not.toContain('as easy as bookkeeping');
    expect(res.body).not.toContain('eco-auditor-intro');
    expect(res.body).not.toMatch(/<video\b/);
    expect(res.body).toContain('<div id="root"></div>');
    expect(robots(res.body)).toBe('noindex,nofollow');
    expect(canonical(res.body)).toBeNull();
    expect(title(res.body)).toBe('Eco-Auditor');
  });

  // F-C-25: the server's own 404 page used to be a bare inline page unlike the app's.
  it('answers any other unknown URL with the same neutral shell and a 404, so the client shows its NotFound screen', async () => {
    const shell = await get(app, '/app/x');
    for (const path of ['/nope', '/nope/', '/nope/deeper/still', '/login/extra']) {
      const res = await get(app, path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('cache-control'), path).toBe('no-cache, no-transform');
      expect(res.headers.get('x-robots-tag'), path).toBe('noindex, nofollow');
      expect(robots(res.body), path).toBe('noindex,nofollow');
      expect(canonical(res.body), path).toBeNull();
      expect(title(res.body), path).toBe('Page not found — Eco-Auditor');
      expect(h1s(res.body), path).toHaveLength(0);
      expect(res.body, path).not.toContain('as easy as bookkeeping');
      // The shell /app/* gets, byte for byte, apart from the title: the page the visitor
      // sees is the client router's catch-all route, not anything this response draws.
      expect(res.body.replace(/<title>[^<]*<\/title>/, '<title>Eco-Auditor</title>'), path).toBe(shell.body);
    }
  });

  it('leaves the prerendered marketing pages as they were', async () => {
    const pricing = await get(app, '/pricing/');
    expect(pricing.status).toBe(200);
    expect(canonical(pricing.body)).toBe(`${ORIGIN}/pricing/`);
    const bare = await get(app, '/pricing');
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/pricing/');
    expect((await get(app, '/definitely-not-a-page')).status).toBe(404);
  });

  const publish = (body: Record<string, unknown>) =>
    fetch(`${app.base}/api/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ posts: [{ slug: 'fresh-post', description: 'Fresh description.', publishDate: '2026-09-20T09:00:00.000Z', body: `<p>${'fresh text '.repeat(20)}</p>`, ...body }] }),
    });

  it('serves a post the moment it is published, and the new text the moment it is republished', async () => {
    expect((await get(app, '/blog/fresh-post/')).status).toBe(404);

    expect((await publish({ title: 'Fresh post v1' })).status).toBe(200);
    const v1 = await get(app, '/blog/fresh-post/');
    expect(v1.status).toBe(200);
    expect(title(v1.body)).toBe('Fresh post v1');
    expect((await get(app, '/sitemap.xml')).body).toContain(`${ORIGIN}/blog/fresh-post/`);
    expect((await get(app, '/blog/')).body).toContain('href="/blog/fresh-post/"');

    expect((await publish({ title: 'Fresh post v2' })).status).toBe(200);
    expect(title((await get(app, '/blog/fresh-post/')).body)).toBe('Fresh post v2');
  });

  it('reads the database once for repeated requests of one post, and again after a publish', async () => {
    await get(app, '/blog/second-post/'); // warm: whatever an earlier test left in the cache
    const before = app.dbReads('post');
    for (let i = 0; i < 3; i += 1) await get(app, '/blog/second-post/');
    expect(app.dbReads('post') - before).toBe(0);

    expect((await publish({ title: 'Fresh post v3' })).status).toBe(200);
    await get(app, '/blog/second-post/');
    expect(app.dbReads('post') - before).toBe(1);
  });

  it('serves the post text through the API with the same head the page was rendered with', async () => {
    const res = await fetch(`${app.base}/api/blog-posts/first-post`);
    const json = (await res.json()) as { post: { slug: string; body_html: string }; head: { title: string; canonical: string } };
    expect(json.post.slug).toBe('first-post');
    expect(json.head.canonical).toBe(`${ORIGIN}/blog/first-post/`);
    expect(json.head.title).toBe(title((await get(app, '/blog/first-post/')).body));
    expect((await fetch(`${app.base}/api/blog-posts/zz-no-such-post`)).status).toBe(404);
  });
});

describe.skipIf(!hasBuild)('server-rendered blog pages when the database is unreachable', () => {
  let app: Running;
  beforeAll(async () => { app = await start({ mode: 'down' }); }, 30_000);
  afterAll(() => app?.stop());

  it('answers 503 with Retry-After, never 404, so a crawler keeps the URL it has', async () => {
    for (const path of ['/blog/first-post/', '/blog/', '/sitemap.xml']) {
      const res = await get(app, path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get('retry-after'), path).toBe('30');
      expect(res.headers.get('cache-control'), path).toBe('no-store');
    }
    expect(robots((await get(app, '/blog/first-post/')).body)).toBe('noindex,nofollow');
  });

  it('keeps serving everything that needs no database', async () => {
    expect((await get(app, '/pricing/')).status).toBe(200);
    expect((await get(app, '/app/x')).status).toBe(200);
  });
});

describe.skipIf(!hasBuild)('server-rendered blog pages with no database configured', () => {
  let app: Running;
  beforeAll(async () => { app = await start({ database: false }); }, 30_000);
  afterAll(() => app?.stop());

  // It used to answer "no posts" (a 404 for every slug, a sitemap without the blog):
  // a missing database is an outage like an unreachable one (F-G-07).
  it('answers 503 with Retry-After like an unreachable database, and serves what needs none', async () => {
    for (const path of ['/blog/first-post/', '/blog/', '/sitemap.xml']) {
      const res = await get(app, path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get('retry-after'), path).toBe('30');
    }
    expect((await get(app, '/pricing/')).status).toBe(200);
  });
});

// D-S4: the page route refuses a malformed slug before it reads (server-pages.cjs), the
// API route handed any slug to the query. Postgres rejects a NUL byte (22021), so
// /api/blog-posts/a%00b answered 503 and an error log line to anyone, at the API's rate.
// An API route needs no build output, so this one is not skipped without it.
describe('GET /api/blog-posts/:slug with a malformed slug', () => {
  let app: Running;
  beforeAll(async () => { app = await start({}); }, 30_000);
  afterAll(() => app?.stop());

  it.each(['a%00b', 'Not_A_Slug', 'has%20space', 'x'.repeat(201)])('answers 404 for %s without reading the database', async (slug) => {
    const before = app.dbReads('post');
    const res = await fetch(`${app.base}/api/blog-posts/${slug}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Post not found' });
    expect(app.dbReads('post')).toBe(before);
  });

  it('still reads the database for a well-formed slug nobody published (so the read counter counts)', async () => {
    const before = app.dbReads('post');
    expect((await fetch(`${app.base}/api/blog-posts/zz-no-such-post`)).status).toBe(404);
    expect(app.dbReads('post')).toBe(before + 1);
  });
});
