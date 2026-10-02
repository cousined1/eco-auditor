import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createPublishHandler } = require('../server-publish.cjs');
const { sanitizeBlogHtml } = require('../server-publish.cjs');

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
    body: { deployUrl: string } & Record<string, unknown>;
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

describe('blog HTML trust boundary', () => {
  it('keeps supported formatting while removing executable markup and attributes', () => {
    const dirty = '<h2 onclick="alert(1)">Safe heading</h2><script>alert(1)</script><p>Body <strong>copy</strong></p><img src=x onerror=alert(2)>';
    const clean = sanitizeBlogHtml(dirty);

    expect(clean).toContain('<h2>Safe heading</h2>');
    expect(clean).toContain('<p>Body <strong>copy</strong></p>');
    expect(clean).not.toMatch(/script|onclick|onerror|<img/iu);
  });

  it('stores only sanitized HTML in the blog row', async () => {
    const { h, queries } = handler();
    const body = `<h2>Safe heading</h2><p>${'body text '.repeat(20)}</p><svg onload="alert(1)"></svg>`;

    await h(makeReq({ posts: [validPost({ body })] }), makeRes());

    const insert = queries.find((q) => q.text.includes('INSERT INTO blog_posts'))!;
    const values = insert.values as unknown[];
    expect(values[7]).toContain('<h2>Safe heading</h2>');
    expect(values[7]).not.toMatch(/svg|onload/iu);
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

// The FAQ feeds the FAQPage JSON-LD. The upsert used to rewrite title, meta and
// body but never `faq`, so a wrong FAQ on a live post could not be corrected
// through the normal publish pipeline (F-A-04 / F-R5-01).
describe('POST /api/publish — faq upsert', () => {
  const FAQ = [
    { question: 'How much does it cost?', answer: 'Starter is $149/month.' },
    { question: 'Is there a trial?', answer: 'Yes, 14 days.' },
  ];
  // Positions in the INSERT parameter list.
  const FAQ_VALUE = 9;
  const FAQ_PROVIDED = 14;

  async function publishOne(post: Record<string, unknown>) {
    const { h, queries } = handler();
    const res = makeRes();
    await h(makeReq({ posts: [post] }), res);
    const insert = queries.find((q) => q.text.includes('INSERT INTO blog_posts'));
    return { res, insert, values: (insert?.values ?? []) as unknown[], queries };
  }

  it('replaces the stored FAQ on conflict when the post carries one', async () => {
    const { res, insert, values } = await publishOne(validPost({ faq: FAQ }));

    expect(res.statusCode).toBe(200);
    expect(values[FAQ_VALUE]).toBe(JSON.stringify(FAQ));
    expect(values[FAQ_PROVIDED]).toBe(true);
    // The conflict branch assigns faq, and only when the flag is set.
    const update = insert!.text.slice(insert!.text.indexOf('DO UPDATE SET'));
    expect(update).toMatch(/faq\s*=\s*CASE WHEN \$15::boolean THEN EXCLUDED\.faq ELSE blog_posts\.faq END/);
  });

  it('leaves the stored FAQ alone when the post does not carry one', async () => {
    const { res, values } = await publishOne(validPost());

    expect(res.statusCode).toBe(200);
    // A new row still gets the column default; the flag keeps an existing FAQ.
    expect(values[FAQ_VALUE]).toBe('[]');
    expect(values[FAQ_PROVIDED]).toBe(false);
  });

  it('treats an explicit empty array as "clear the FAQ"', async () => {
    const { res, values } = await publishOne(validPost({ faq: [] }));

    expect(res.statusCode).toBe(200);
    expect(values[FAQ_VALUE]).toBe('[]');
    expect(values[FAQ_PROVIDED]).toBe(true);
  });

  it('stores only trimmed question and answer, never other keys', async () => {
    const { values } = await publishOne(
      validPost({ faq: [{ question: '  Q?  ', answer: '  A.  ', html: '<script>x</script>', extra: 1 }] }),
    );

    expect(JSON.parse(values[FAQ_VALUE] as string)).toEqual([{ question: 'Q?', answer: 'A.' }]);
  });

  const invalid: Array<[string, unknown]> = [
    ['a string instead of an array', 'Q? A.'],
    ['an object instead of an array', { question: 'Q?', answer: 'A.' }],
    ['an item that is not an object', ['Q? A.']],
    ['a null item', [null]],
    ['an item without a question', [{ answer: 'A.' }]],
    ['an item with a blank answer', [{ question: 'Q?', answer: '   ' }]],
    ['a non-string answer', [{ question: 'Q?', answer: 42 }]],
    ['a question over 300 characters', [{ question: 'q'.repeat(301), answer: 'A.' }]],
    ['an answer over 2000 characters', [{ question: 'Q?', answer: 'a'.repeat(2001) }]],
    ['more than 20 items', Array.from({ length: 21 }, (_, i) => ({ question: `Q${i}?`, answer: 'A.' }))],
  ];

  for (const [label, faq] of invalid) {
    it(`rejects ${label} with 400 before touching the database`, async () => {
      const { h, client } = handler();
      const res = makeRes();
      await h(makeReq({ posts: [validPost({ faq })] }), res);

      expect(res.statusCode).toBe(400);
      expect(String(res.body.error)).toMatch(/faq/);
      expect(client.query).not.toHaveBeenCalled();
    });
  }
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
    // server.cjs passes a pool that refuses every call when DATABASE_URL is unset (F-G-07).
    const h = createPublishHandler({
      pgPool: { connect: async () => { throw Object.assign(new Error('Data store unavailable: no database is configured'), { code: '08001' }); } },
      deployToken: TOKEN,
      canonicalOrigin: ORIGIN,
      log: () => {},
    });
    const res = makeRes();
    await h(makeReq({ posts: [validPost()] }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'database is unavailable' });
  });
});
