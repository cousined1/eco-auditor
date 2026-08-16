import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createPublishHandler } = require('../server-publish.cjs');

const TOKEN = 'deploy-token-value';
const ORIGIN = 'https://ecoauditor.io';
const SLUG = 'scope-3-emissions-reporting';

function makeRes() {
  const res: Record<string, unknown> = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
  };
  res.setHeader = (k: string, v: string) => {
    (res.headers as Record<string, string>)[k] = v;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res as {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
    setHeader: (k: string, v: string) => void;
    status: (c: number) => unknown;
    json: (p: unknown) => unknown;
  };
}

function makePool() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client }, client, queries };
}

function validPost(overrides: Record<string, unknown> = {}) {
  return {
    slug: SLUG,
    title: 'Scope 3 Emissions Reporting',
    description: 'A practical guide to defensible Scope 3 numbers.',
    category: 'Sustainability',
    tags: ['Scope 3 emissions reporting'],
    author: 'EcoAuditor Editorial',
    publishDate: '2026-08-13T07:00:00.000Z',
    canonicalUrl: `${ORIGIN}/blog/${SLUG}`,
    structuredData: {},
    body: `<h1>Scope 3</h1><p>${'body text '.repeat(20)}</p>`,
    bodyFormat: 'html',
    ...overrides,
  };
}

function makeReq(body: unknown, token: string | null = TOKEN) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

function handler(overrides: Record<string, unknown> = {}) {
  const { pool, client, queries } = makePool();
  const h = createPublishHandler({
    pgPool: pool,
    deployToken: TOKEN,
    canonicalOrigin: ORIGIN,
    log: () => {},
    ...overrides,
  });
  return { h, client, queries };
}

describe('POST /api/publish — auth', () => {
  it('rejects a missing token with 401', async () => {
    const { h } = handler();
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }, null), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong token with 401', async () => {
    const { h } = handler();
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }, 'not-the-token'), res);
    expect(res.statusCode).toBe(401);
  });

  it('reports an unconfigured token as 503, not 401', async () => {
    // The caller maps 401 to PUBLISH_AUTH and stops retrying, so a deploy that
    // simply has no token set must not look like a bad credential.
    const { h } = handler({ deployToken: undefined });
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('POST /api/publish — validation', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['a slug with spaces', { slug: 'not a slug' }],
    ['an empty title', { title: '' }],
    ['a body under the minimum length', { body: 'too short' }],
    ['a non-ISO publishDate', { publishDate: 'last tuesday' }],
    ['markdown, which would render as literal text', { bodyFormat: 'markdown' }],
  ];

  for (const [label, override] of cases) {
    it(`rejects ${label} with 400`, async () => {
      const { h, client } = handler();
      const res = makeRes();
      await h(makeReq({ posts: [validPost(override)] }), res);
      expect(res.statusCode).toBe(400);
      expect(client.query).not.toHaveBeenCalled();
    });
  }

  it('rejects an empty posts array with 400', async () => {
    const { h } = handler();
    const res = makeRes();
    await h(makeReq({ posts: [] }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/publish — success contract', () => {
  it('returns exactly the response shape the caller validates', async () => {
    const { h } = handler();
    const res = makeRes();
    await h(makeReq({ requestId: 'run_abc', posts: [validPost()] }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 'published',
      deployed: [SLUG],
      deployUrl: `${ORIGIN}/blog/${SLUG}`,
    });
  });

  it('returns a deployUrl matching the canonical URL the caller sent', async () => {
    // The caller compares origin + normalised path and rejects any query or
    // fragment, marking the run failed even though the row was written.
    const post = validPost();
    const { h } = handler();
    const res = makeRes();
    await h(makeReq({ posts: [post] }), res);

    const sent = new URL(post.canonicalUrl as string);
    const returned = new URL(res.body.deployUrl);
    expect(returned.origin).toBe(sent.origin);
    expect(returned.pathname).toBe(sent.pathname);
    expect(returned.search).toBe('');
    expect(returned.hash).toBe('');
  });

  it('never answers 202 — the caller treats async acceptance as failure', async () => {
    const { h } = handler();
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }), res);
    expect(res.statusCode).not.toBe(202);
  });

  it('upserts on slug so a retried publish succeeds instead of colliding', async () => {
    const { h, queries } = handler();
    await h(makeReq({ posts: [validPost()] }), makeRes());

    const insert = queries.find((q) => q.text.includes('INSERT INTO blog_posts'));
    expect(insert).toBeDefined();
    expect(insert!.text).toContain('ON CONFLICT (slug) DO UPDATE');
    expect(queries.some((q) => q.text === 'BEGIN')).toBe(true);
    expect(queries.some((q) => q.text === 'COMMIT')).toBe(true);
  });

  it('writes the columns the blog UI reads', async () => {
    const { h, queries } = handler();
    await h(makeReq({ requestId: 'run_abc', posts: [validPost()] }), makeRes());

    const insert = queries.find((q) => q.text.includes('INSERT INTO blog_posts'))!;
    const values = insert.values as unknown[];
    expect(values).toContain(SLUG);
    expect(values).toContain('Scope 3 Emissions Reporting');
    // primary_keyword comes from the first tag, falling back to the title.
    expect(values).toContain('Scope 3 emissions reporting');
    // cta is JSONB NOT NULL; BlogPost.tsx renders it only when cta.href is set,
    // so an empty object is the correct "no CTA" value.
    expect(values).toContain('{}');
  });
});

describe('POST /api/publish — failure handling', () => {
  it('rolls back and reports 503 when blog_posts is missing', async () => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO blog_posts')) {
          const err: Error & { code?: string } = new Error('relation does not exist');
          err.code = '42P01';
          throw err;
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const h = createPublishHandler({
      pgPool: { connect: async () => client },
      deployToken: TOKEN,
      canonicalOrigin: ORIGIN,
      log: () => {},
    });
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }), res);

    expect(res.statusCode).toBe(503);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('reports 503 when the database is not configured', async () => {
    const h = createPublishHandler({
      pgPool: null,
      deployToken: TOKEN,
      canonicalOrigin: ORIGIN,
      log: () => {},
    });
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }), res);
    expect(res.statusCode).toBe(503);
  });
});
