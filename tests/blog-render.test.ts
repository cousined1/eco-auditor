// F-F-01: the HTML the server renders for /blog/ and /blog/<slug>/, and sitemap.xml.
// The renderers are pure string functions, so this runs them against the REAL
// index.html template (through the same applyShellHead the build uses) on every
// test run. tests/blog-pages-server.test.ts covers the same pages over HTTP.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- importing a Node ESM .mjs module with no type declarations
import { applyShellHead, loadRouteData, sitemapPaths, SITE_URL } from '../scripts/prerender-head.mjs';
import { safeHref as clientSafeHref, singleH1Body as clientSingleH1Body } from '../src/lib/blog-html';

const require = createRequire(import.meta.url);

interface Row {
  id: string;
  slug: string;
  title: string;
  meta_title: string;
  meta_description: string;
  body_html: string;
  primary_keyword: string;
  faq: unknown;
  internal_links: unknown[];
  external_links: unknown[];
  cta: unknown;
  content_score: number | null;
  geo_score: number | null;
  published_at: Date | string;
}
interface ListItem { slug: string; title: string; excerpt: string; read_minutes: number; published_at: string | null }
interface PublicPost extends Omit<Row, 'cta' | 'internal_links' | 'external_links'> {
  cta: { label?: string; href?: string };
  internal_links: Array<{ url?: string; href?: string; anchor: string }>;
  external_links: Array<{ url?: string; href?: string; anchor: string }>;
}
interface Render {
  isValidSlug: (slug: unknown) => boolean;
  singleH1Body: (html: string, title: string) => string;
  toPublicPost: (row: Row) => PublicPost;
  postHead: (post: Row, origin: string) => { title: string; description: string; canonical: string };
  toListItem: (row: Row) => ListItem;
  renderPostPage: (shell: string, row: Row, origin: string) => string;
  renderIndexPage: (shell: string, items: ListItem[], meta: { title: string; description: string }, origin: string) => string;
  renderSitemapXml: (input: { origin: string; paths: string[]; posts: { slug: string; published_at: Date | string }[]; now?: number }) => string;
  __testing: { safeHref: (href: unknown) => string | null; CHROME_HEADER: string; CHROME_FOOTER: string; INDEX_HEADING: string; INDEX_LEAD: string };
}
const render = require('../server-blog-render.cjs') as Render;
const { validatePost } = (require('../server-publish.cjs') as { __testing: { validatePost: (post: unknown, index: number) => string | null } }).__testing;

const routeMeta = (loadRouteData() as { routeMeta: Record<string, { title: string; description: string }> }).routeMeta;
const shell = applyShellHead(readFileSync(resolve('index.html'), 'utf8')) as string;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'id-1',
    slug: 'carbon-guide',
    title: 'A carbon guide',
    meta_title: 'A carbon guide | Eco-Auditor',
    meta_description: 'How a small business starts a Scope 1 and 2 inventory.',
    body_html: '<h1>A carbon guide</h1><h2>Start</h2><p>First paragraph.</p>',
    primary_keyword: 'carbon accounting',
    faq: [{ question: 'What is Scope 3?', answer: 'Emissions in the value chain.' }],
    internal_links: [],
    external_links: [],
    cta: {},
    content_score: null,
    geo_score: null,
    published_at: new Date('2026-09-05T07:00:00Z'),
    ...overrides,
  };
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (html: string, tag: RegExp) => {
  const m = tag.exec(html);
  return m ? decode(m[1] ?? '') : null;
};
type LdNode = { '@type': string; '@id'?: string; url?: string; headline?: string; datePublished?: string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[]; itemListElement?: { position: number; name: string; item: string }[] };
const ldNodes = (html: string): LdNode[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => (JSON.parse(m[1] ?? '{}') as { '@graph': LdNode[] })['@graph']);
const embedded = (html: string, id: string) => {
  for (const m of html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)) {
    if (m[1] === id) return JSON.parse(m[2] ?? 'null') as Record<string, unknown>;
  }
  return null;
};
const rootOf = (html: string) => html.slice(html.indexOf('<div id="root">'), html.indexOf('<script type="application/json"'));

describe('a post page (renderPostPage)', () => {
  const html = render.renderPostPage(shell, row(), SITE_URL);

  it('has its own title, description, canonical, og:url and twitter:url, and is indexable', () => {
    expect((html.match(/<title>/g) ?? []).length).toBe(1);
    expect((html.match(/<meta name="description"/g) ?? []).length).toBe(1);
    expect(attr(html, /<title>([^<]*)<\/title>/)).toBe('A carbon guide | Eco-Auditor');
    expect(attr(html, /<meta name="description" content="([^"]*)"/)).toBe('How a small business starts a Scope 1 and 2 inventory.');
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(`${SITE_URL}/blog/carbon-guide/`);
    expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe(`${SITE_URL}/blog/carbon-guide/`);
    expect(attr(html, /<meta name="twitter:url" content="([^"]*)"/)).toBe(`${SITE_URL}/blog/carbon-guide/`);
    expect(attr(html, /<meta property="og:title" content="([^"]*)"/)).toBe('A carbon guide | Eco-Auditor');
    expect(attr(html, /<meta property="og:type" content="([^"]*)"/)).toBe('article');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).not.toContain('noindex');
    // One canonical, and never the homepage's.
    expect((html.match(/rel="canonical"/g) ?? []).length).toBe(1);
  });

  it('falls back to "<title> — Eco-Auditor Blog" when the post has no meta_title', () => {
    const page = render.renderPostPage(shell, row({ meta_title: '' }), SITE_URL);
    expect(attr(page, /<title>([^<]*)<\/title>/)).toBe('A carbon guide — Eco-Auditor Blog');
  });

  it('carries the site-wide entities once, plus an Article, a breadcrumb and the post FAQ as valid JSON-LD', () => {
    const nodes = ldNodes(html);
    const count = (type: string) => nodes.filter((n) => n['@type'] === type).length;
    expect(count('Organization')).toBe(1);
    expect(count('WebSite')).toBe(1);
    expect(count('SoftwareApplication')).toBe(1);
    expect(count('Article')).toBe(1);
    expect(count('BreadcrumbList')).toBe(1);
    expect(count('FAQPage')).toBe(1);

    const article = nodes.find((n) => n['@type'] === 'Article');
    expect(article?.headline).toBe('A carbon guide');
    expect(article?.url).toBe(`${SITE_URL}/blog/carbon-guide/`);
    expect(article?.datePublished).toBe('2026-09-05T07:00:00.000Z');

    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList')?.itemListElement ?? [];
    expect(crumbs.map((c) => c.item)).toEqual([`${SITE_URL}/`, `${SITE_URL}/blog/`, `${SITE_URL}/blog/carbon-guide/`]);

    const faq = nodes.find((n) => n['@type'] === 'FAQPage');
    expect(faq?.mainEntity?.map((q) => [q.name, q.acceptedAnswer.text])).toEqual([['What is Scope 3?', 'Emissions in the value chain.']]);
  });

  it('emits FAQPage only when the post has an FAQ, and only what the page shows', () => {
    const none = render.renderPostPage(shell, row({ faq: [] }), SITE_URL);
    expect(ldNodes(none).some((n) => n['@type'] === 'FAQPage')).toBe(false);
    expect(none).not.toContain('Frequently Asked Questions');
    // A malformed stored FAQ never reaches the markup or the JSON-LD.
    const broken = render.renderPostPage(shell, row({ faq: [{ question: 'Only a question' }, null, 'text', { question: 'Q', answer: 'A' }] }), SITE_URL);
    expect(ldNodes(broken).find((n) => n['@type'] === 'FAQPage')?.mainEntity?.map((q) => q.name)).toEqual(['Q']);
    expect(rootOf(broken)).toContain('>Q</h3>');
    expect(rootOf(broken)).not.toContain('Only a question');
  });

  it('renders exactly one H1, the post title, whatever the stored body contains', () => {
    const cases = [
      '<h1>A carbon guide</h1><p>Body</p>', // repeats the title
      '<h1>Something else</h1><p>Body</p>', // differs: demoted, never a second H1
      '<p>Intro</p><h1>Middle</h1><p>Body</p>',
    ];
    for (const body_html of cases) {
      const root = rootOf(render.renderPostPage(shell, row({ body_html }), SITE_URL));
      expect((root.match(/<h1\b/g) ?? []).length, body_html).toBe(1);
      expect(root).toMatch(/<h1 [^>]*>A carbon guide<\/h1>/);
    }
  });

  it('embeds the post the client starts from, with the head the page was rendered with', () => {
    const data = embedded(html, 'blog-post-data') as { post: Row; head: { title: string; description: string; canonical: string } };
    expect(data.post.slug).toBe('carbon-guide');
    expect(data.post.published_at).toBe('2026-09-05T07:00:00.000Z');
    expect(data.head).toEqual({
      title: 'A carbon guide | Eco-Auditor',
      description: 'How a small business starts a Scope 1 and 2 inventory.',
      canonical: `${SITE_URL}/blog/carbon-guide/`,
    });
  });

  it('points every internal link at the canonical slash form', () => {
    const hrefs = [...rootOf(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
    const internal = hrefs.filter((h) => h.startsWith('/') && !h.startsWith('/#'));
    expect(internal.length).toBeGreaterThan(5);
    for (const href of internal) expect(href, href).toMatch(/\/$/);
  });
});

describe('escaping (every value that comes from a stored post)', () => {
  const evil = '</script><script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  const hostile = row({
    slug: 'evil-post',
    title: evil,
    meta_title: evil,
    meta_description: evil,
    primary_keyword: evil,
    faq: [{ question: evil, answer: evil }],
    cta: { label: evil, href: '/pricing/?a="b"&c=<d>' },
    body_html: `<p>ok</p><script>alert(3)</script><a href="javascript:alert(4)" onclick="alert(5)">link</a><img src=x onerror=alert(6)><iframe src="//evil"></iframe>`,
  });
  const html = render.renderPostPage(shell, hostile, SITE_URL);

  it('never lets a value close a script element or open a tag (as a browser parses the page)', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('img, iframe, object, embed, link[rel="stylesheet"][href*="evil"]')).toHaveLength(0);
    const handlers = [...doc.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name)).filter((name) => name.startsWith('on'));
    expect(handlers).toEqual([]);
    expect([...doc.querySelectorAll('a[href]')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') ?? ''))).toHaveLength(0);
    // Every <script> is one of ours: the template's single inline theme bootstrap,
    // the module entry point, JSON-LD and embedded JSON. A value that closed a
    // JSON-LD block early would add an attribute-less one.
    const scripts = [...doc.querySelectorAll('script')];
    expect(scripts.filter((s) => !s.hasAttribute('type'))).toHaveLength(1);
    for (const script of scripts.filter((s) => s.hasAttribute('type'))) {
      expect(['module', 'application/ld+json', 'application/json']).toContain(script.getAttribute('type'));
    }
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelector('h1')?.textContent).toBe(evil);
  });

  it('keeps the JSON-LD and the embedded JSON parseable and faithful', () => {
    const faq = ldNodes(html).find((n) => n['@type'] === 'FAQPage');
    expect(faq?.mainEntity?.[0]?.name).toBe(evil);
    const data = embedded(html, 'blog-post-data') as { post: { title: string; body_html: string } };
    expect(data.post.title).toBe(evil);
    // The embedded body is the sanitised one: the client renders it as HTML.
    expect(data.post.body_html).not.toMatch(/<script|onerror|onclick|javascript:|<iframe/i);
  });

  it('escapes the head as text and as attribute values', () => {
    expect(html).toContain(`<title>${evil.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>`);
    expect(attr(html, /<meta name="description" content="([^"]*)"/)).toBe(evil);
    expect(attr(html, /<meta property="og:title" content="([^"]*)"/)).toBe(evil);
  });

  it('keeps the post body as its sanitised formatting, without attributes', () => {
    const root = rootOf(html);
    expect(root).toContain('<p>ok</p>');
    expect(root).toContain('<a>link</a>');
  });

  it('drops a CTA target that is not a root-relative path or an https URL', () => {
    const { safeHref } = render.__testing;
    expect(safeHref('/signup/')).toBe('/signup/');
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    for (const bad of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'http://example.com', 'data:text/html,x', '', null, 42]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
    const withBadCta = render.renderPostPage(shell, row({ cta: { label: 'Go', href: 'javascript:alert(1)' } }), SITE_URL);
    expect(rootOf(withBadCta)).not.toContain('Go</a>');
  });
});

// D-W2A-3: 3 of the 4 seeded posts had a meta description of 163, 180 and 167
// characters, which search results cut wherever they like. The head (title tag
// aside) is what a crawler reads first, so the description in the <meta>, og and
// twitter tags is cut here, at a word boundary, with an ellipsis. The page itself
// and the JSON-LD keep what the author wrote.
describe('the description in the head (D-W2A-3)', () => {
  // `length` characters of 5-letter words: a cut that falls inside a word is visible.
  const words = (length: number) => Array.from({ length: Math.ceil(length / 6) }, () => 'abcde').join(' ').slice(0, length);
  const meta = (html: string) => ({
    meta: attr(html, /<meta name="description" content="([^"]*)"/),
    og: attr(html, /<meta property="og:description" content="([^"]*)"/),
    twitter: attr(html, /<meta name="twitter:description" content="([^"]*)"/),
  });

  it.each([163, 167, 180, 400])('cuts a %i character description to 160 or fewer, in the meta, og and twitter tags alike', (length) => {
    const html = render.renderPostPage(shell, row({ meta_description: words(length) }), SITE_URL);

    const { meta: m, og, twitter } = meta(html);
    expect(m).toBe(og);
    expect(m).toBe(twitter);
    expect(m?.length).toBeLessThanOrEqual(160);
    expect(m?.endsWith('…')).toBe(true);
  });

  it('cuts at a word boundary: what is kept is whole words from the start, never a word cut in half', () => {
    const text = 'Scope 1 and 2 reporting for small businesses, explained step by step with the records an auditor asks for first, and what to do when a supplier cannot give you a factor';
    expect(text.length).toBeGreaterThan(160);

    const description = render.postHead(row({ meta_description: text }), SITE_URL).description;
    const kept = description.slice(0, -1);

    expect(description.length).toBeLessThanOrEqual(160);
    expect(text.startsWith(kept)).toBe(true);
    // What follows the kept text in the original is a space, possibly after a comma or a dash that was dropped: no word was cut.
    expect(text.slice(kept.length)).toMatch(/^[,;:.\-–—]*\s/);
    expect(kept).not.toMatch(/[\s,;:.\-–—]$/); // and nothing dangles before the ellipsis
    expect(kept.length).toBeGreaterThan(120); // it kept as much as fit
  });

  it('leaves a description of 160 characters or fewer exactly as it is', () => {
    for (const length of [1, 80, 159, 160]) {
      const text = words(length);
      expect(render.postHead(row({ meta_description: text }), SITE_URL).description, String(length)).toBe(text);
    }
    expect(render.postHead(row({ meta_description: '  trimmed  ' }), SITE_URL).description).toBe('trimmed');
    expect(render.postHead(row({ meta_description: '' }), SITE_URL).description).toBe('');
  });

  it('cuts 161 characters, the smallest case that needs it', () => {
    const description = render.postHead(row({ meta_description: words(161) }), SITE_URL).description;
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith('…')).toBe(true);
  });

  it('cuts inside a single very long word rather than keeping a few letters', () => {
    const description = render.postHead(row({ meta_description: `Intro ${'x'.repeat(300)}` }), SITE_URL).description;
    expect(description.length).toBe(160);
    expect(description.startsWith('Intro xxxx')).toBe(true);
  });

  it('never ends on half of a character that takes two code units', () => {
    // No space to back up to, so the cut is hard, and it would land between the two halves of an emoji.
    const text = `${'a'.repeat(158)}${'😀'.repeat(5)}`;
    const description = render.postHead(row({ meta_description: text }), SITE_URL).description;
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).not.toMatch(/[\uD800-\uDBFF]…$/); // no lone high surrogate before the ellipsis
    expect(() => encodeURIComponent(description)).not.toThrow(); // throws on a lone surrogate
    expect(description.startsWith('a'.repeat(158))).toBe(true);
  });

  it('puts the same description in the head the client applies after navigation', () => {
    const text = words(180);
    const html = render.renderPostPage(shell, row({ meta_description: text }), SITE_URL);
    const data = embedded(html, 'blog-post-data') as { head: { description: string } };

    expect(data.head.description).toBe(render.postHead(row({ meta_description: text }), SITE_URL).description);
    expect(data.head.description).toBe(meta(html).meta);
  });

  it('keeps the author\'s full text in the page and in the structured data', () => {
    const text = words(180);
    const html = render.renderPostPage(shell, row({ meta_description: text }), SITE_URL);

    expect(rootOf(html)).toContain(`>${text}</p>`);
    expect(ldNodes(html).find((n) => n['@type'] === 'Article')).toMatchObject({ description: text });
  });
});

// D-W2A-5: the server already dropped a CTA whose target is not a root-relative path
// or an https URL, but only where it renders the CTA itself. The post the API returns
// and the one embedded for the client carried the stored value as it was, so a later
// <a href> in the client, or a publish API that accepts a CTA, would have rendered it.
// The allowlist is applied once, where a stored post becomes a public one.
describe('stored links and CTA in the public post (D-W2A-5)', () => {
  const hostile = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/\\evil.example',
    'http://example.com/plain',
    'ftp://example.com/x',
    '/\t/evil.example', // a browser drops the tab and reads //evil.example
    '/\n/evil.example',
    '/\r/evil.example',
    '\t//evil.example',
    'https://exa mple.com',
    'https://',
    'https://ecoauditor.io@evil.example/login', // the host is what follows the @
    'https://user:secret@example.com/',
    '',
  ];

  it('keeps a CTA that is a root-relative path or an https URL, with its label', () => {
    expect(render.toPublicPost(row({ cta: { label: 'Start free', href: '/signup/' } })).cta).toEqual({ label: 'Start free', href: '/signup/' });
    expect(render.toPublicPost(row({ cta: { label: 'Read', href: 'https://example.com/x?y=1' } })).cta).toEqual({ label: 'Read', href: 'https://example.com/x?y=1' });
  });

  it.each(hostile)('empties a CTA whose target is %j, leaving what a post without one has', (href) => {
    expect(render.toPublicPost(row({ cta: { label: 'Go', href } })).cta).toEqual({});
  });

  it.each([[null], [undefined], ['a string'], [42], [[]], [['/x/']], [{ label: 'no target' }], [{ href: 42 }]])('reads a stored CTA of %j as no CTA', (cta) => {
    expect(render.toPublicPost(row({ cta })).cta).toEqual({});
  });

  it('carries only the label and the target of a CTA, and a label that is not text falls back to none', () => {
    expect(render.toPublicPost(row({ cta: { label: 'Go', href: '/x/', onClick: 'alert(1)', html: '<b>' } })).cta).toEqual({ label: 'Go', href: '/x/' });
    expect(render.toPublicPost(row({ cta: { label: { toString: 'x' }, href: '/x/' } })).cta).toEqual({ href: '/x/' });
  });

  // The seeded posts store their links as { href, anchor }; the client's type says { url, anchor }.
  // Either key is a link target, so either is checked, and each entry keeps its own key.
  it.each(['href', 'url'])('keeps internal and external links that are allowed, under their own key (%s), with their anchors, and drops the rest', (key) => {
    const link = (target: string, anchor?: string) => ({ [key]: target, ...(anchor === undefined ? {} : { anchor }) });
    const links = [
      link('/pricing/', 'Pricing'),
      link('https://ghgprotocol.org/', 'GHG Protocol'),
      ...hostile.map((target) => link(target, 'bad')),
      link('/ok/'), // no anchor: kept, anchor empty
      null,
      'text',
      42,
    ];
    const post = render.toPublicPost(row({ internal_links: links, external_links: links }));

    for (const list of [post.internal_links, post.external_links]) {
      expect(list).toEqual([
        { [key]: '/pricing/', anchor: 'Pricing' },
        { [key]: 'https://ghgprotocol.org/', anchor: 'GHG Protocol' },
        { [key]: '/ok/', anchor: '' },
      ]);
    }
  });

  it('keeps the links the seeded posts carry: absolute https URLs under href', () => {
    const seeded = [
      { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
      { href: 'https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk', anchor: 'CARB SB 253 program page' },
    ];
    expect(render.toPublicPost(row({ internal_links: seeded })).internal_links).toEqual(seeded);
  });

  it('drops an entry with no target, and an entry with two targets when either one is unsafe', () => {
    const post = render.toPublicPost(
      row({
        internal_links: [
          { anchor: 'nowhere' },
          { url: '/fine/', href: 'javascript:alert(1)', anchor: 'one bad target' },
          { url: 'javascript:alert(1)', href: '/fine/', anchor: 'the other bad target' },
          { url: '/fine/', href: '/also-fine/', anchor: 'both good' },
        ],
      }),
    );
    expect(post.internal_links).toEqual([{ url: '/fine/', href: '/also-fine/', anchor: 'both good' }]);
  });

  it.each([[null], [undefined], ['a string'], [{}], [42]])('reads stored link lists of %j as none', (value) => {
    const post = render.toPublicPost(row({ internal_links: value as unknown[], external_links: value as unknown[] }));
    expect(post.internal_links).toEqual([]);
    expect(post.external_links).toEqual([]);
  });

  it('is the same post for the API and for the embedded JSON, and stays put when made public twice', () => {
    const stored = row({ cta: { label: 'Go', href: 'javascript:alert(1)' }, internal_links: [{ href: '//evil.example', anchor: 'x' }] });
    const once = render.toPublicPost(stored);
    const html = render.renderPostPage(shell, stored, SITE_URL);
    const data = embedded(html, 'blog-post-data') as { post: PublicPost };

    expect(data.post.cta).toEqual({});
    expect(data.post.internal_links).toEqual([]);
    expect(data.post.cta).toEqual(once.cta);
    expect(render.toPublicPost(once as unknown as Row)).toEqual(once);
  });

  it('refuses a slash that a browser would read as the start of another host once it drops tabs and newlines', () => {
    const { safeHref } = render.__testing;
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ /evil.example', '/ /evil.example', '/\u0000/evil.example']) {
      expect(safeHref(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeHref('/pricing/?plan=growth#compare')).toBe('/pricing/?plan=growth#compare');
    expect(safeHref('  /signup/  ')).toBe('/signup/');
  });
});

describe('the /blog index (renderIndexPage)', () => {
  const rows = [
    row({ slug: 'newer-post', title: 'Newer post', published_at: new Date('2026-09-10T00:00:00Z') }),
    row({ slug: 'older-post', title: 'Older post', published_at: new Date('2026-09-01T00:00:00Z') }),
  ];
  const meta = routeMeta['/blog'] as { title: string; description: string };
  const html = render.renderIndexPage(shell, rows.map(render.toListItem), meta, SITE_URL);

  it('lists every post with a real link, not "Loading posts…"', () => {
    const hrefs = [...rootOf(html).matchAll(/href="(\/blog\/[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain('/blog/newer-post/');
    expect(hrefs).toContain('/blog/older-post/');
    expect(html).not.toContain('Loading posts');
    expect((rootOf(html).match(/<h1\b/g) ?? []).length).toBe(1);
  });

  it('takes its head from route-meta.json (the prerender step reads the same file) and is indexable', () => {
    expect(attr(html, /<title>([^<]*)<\/title>/)).toBe(meta.title);
    expect(attr(html, /<meta name="description" content="([^"]*)"/)).toBe(meta.description);
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(`${SITE_URL}/blog/`);
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    const nodes = ldNodes(html);
    expect(nodes.filter((n) => n['@type'] === 'WebPage')).toHaveLength(1);
    expect(nodes.filter((n) => n['@type'] === 'BreadcrumbList')).toHaveLength(1);
  });

  it('embeds the list for the client and says so plainly when there are no posts', () => {
    expect((embedded(html, 'blog-list-data') as { posts: ListItem[] }).posts.map((p) => p.slug)).toEqual(['newer-post', 'older-post']);
    const empty = render.renderIndexPage(shell, [], meta, SITE_URL);
    expect(rootOf(empty)).toContain('No posts yet');
  });

  it('keeps the hero copy of BlogList.tsx', () => {
    const source = readFileSync(resolve('src/pages/BlogList.tsx'), 'utf8');
    expect(source).toContain(render.__testing.INDEX_HEADING);
    expect(source).toContain(render.__testing.INDEX_LEAD);
  });
});

describe('sitemap.xml (renderSitemapXml)', () => {
  const origin = SITE_URL;
  const paths = sitemapPaths() as string[];
  const now = Date.parse('2026-09-30T12:00:00Z');
  const posts = [
    { slug: 'newer-post', published_at: new Date('2026-09-10T08:30:00Z') },
    { slug: 'older-post', published_at: '2026-09-01T00:00:00.000Z' },
  ];
  const xml = render.renderSitemapXml({ origin, paths, posts, now });
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]*)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?\s*<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] }));

  it('lists the indexable routes and every published post', () => {
    const locs = entries.map((e) => e.loc);
    for (const path of paths) expect(locs).toContain(`${origin}${path}`);
    expect(locs).toContain(`${origin}/blog/newer-post/`);
    expect(locs).toContain(`${origin}/blog/older-post/`);
    expect(locs).not.toContain(`${origin}/login/`);
    expect(locs).not.toContain(`${origin}/signup/`);
  });

  it('gives a post the lastmod of its published_at, and the blog index the newest post\'s', () => {
    const byLoc = Object.fromEntries(entries.map((e) => [e.loc, e.lastmod]));
    expect(byLoc[`${origin}/blog/newer-post/`]).toBe('2026-09-10T08:30:00Z');
    expect(byLoc[`${origin}/blog/older-post/`]).toBe('2026-09-01T00:00:00Z');
    expect(byLoc[`${origin}/blog/`]).toBe('2026-09-10T08:30:00Z');
  });

  it('carries no hand-kept lastmod on the static routes (F-F-13)', () => {
    for (const entry of entries) {
      if (entry.loc === `${origin}/blog/` || entry.loc?.startsWith(`${origin}/blog/`)) continue;
      expect(entry.lastmod, entry.loc).toBeUndefined();
    }
  });

  it('never advertises a date in the future, skips an unreachable slug and escapes XML', () => {
    const scheduled = render.renderSitemapXml({ origin, paths: ['/'], now, posts: [{ slug: 'scheduled', published_at: '2027-01-01T00:00:00Z' }, { slug: 'Bad Slug&', published_at: '2026-09-01T00:00:00Z' }] });
    expect(scheduled).toContain('<lastmod>2026-09-30T12:00:00Z</lastmod>');
    expect(scheduled).not.toContain('Bad Slug');
    expect(render.renderSitemapXml({ origin: 'https://x.test/?a=1&b=2', paths: ['/'], posts: [], now })).toContain('&amp;');
  });
});

describe('the pieces the pages share with the rest of the code', () => {
  it('singleH1Body behaves like the client\'s src/lib/blog-html.ts on the same input', () => {
    const cases: [string, string][] = [
      ['<h1>Title</h1><p>x</p>', 'Title'],
      ['<h1>  title &amp; more </h1><p>x</p>', 'Title & More'],
      ['<h1>Other</h1><p>x</p><h1>Again</h1>', 'Title'],
      ['<p>x</p><H1 class="a">Mid</H1>', 'Title'],
      ['<h2>Only h2</h2>', 'Title'],
      ['', 'Title'],
    ];
    for (const [html, title] of cases) expect(render.singleH1Body(html, title), html).toBe(clientSingleH1Body(html, title));
  });

  it('safeHref decides like the client\'s src/lib/blog-html.ts on the same input', () => {
    const cases: unknown[] = [
      '/signup/', '/pricing/?plan=growth#compare', '  /signup/  ', 'https://example.com/x?y=1', 'HTTPS://example.com/', 'https://', 'https://exa mple.com',
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)', 'http://example.com', 'ftp://example.com/x', 'mailto:a@b.co',
      'https://ecoauditor.io@evil.example/login', 'https://user:secret@example.com/', 'https://@example.com/', 'https://example.com/account@home', 'https://example.com/?email=a@b.co',
      '//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ /evil.example', '/ /evil.example', '/\u0000/evil.example',
      'relative/path', '#fragment', '', '   ', null, undefined, 42, true, {}, ['/x/'],
    ];
    for (const href of cases) expect(render.__testing.safeHref(href), JSON.stringify(href)).toBe(clientSafeHref(href));
  });

  it('accepts the slugs /api/publish accepts, and refuses the ones it refuses', () => {
    const base = { title: 't', description: 'd', body: 'x'.repeat(120), publishDate: '2026-09-01T00:00:00Z' };
    for (const slug of ['a', 'a-b', 'scope-3-emissions-reporting', 'a1-2b', 'Upper', 'under_score', '-lead', 'trail-', 'dou--ble', 'has space', 'sl/ash', '', '%2e']) {
      const publishable = validatePost({ ...base, slug }, 0) === null;
      expect(render.isValidSlug(slug), JSON.stringify(slug)).toBe(publishable);
    }
    expect(render.isValidSlug('a'.repeat(201))).toBe(false);
    expect(render.isValidSlug(undefined)).toBe(false);
  });

  it('uses only class names that exist in src, because Tailwind only generates what it finds there', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(entry.name)) files.push(path);
      }
    };
    walk(resolve('src'));
    const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const known = new Set(source.split(/[\s"'`{}$()<>=,;]+/));
    const cssClasses = new Set([...source.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));

    const pages = [render.renderPostPage(shell, row({ cta: { label: 'Go', href: '/x/' } }), SITE_URL), render.renderIndexPage(shell, [render.toListItem(row())], routeMeta['/blog'] as { title: string; description: string }, SITE_URL)];
    const missing = new Set<string>();
    for (const page of pages) {
      for (const m of rootOf(page).matchAll(/class="([^"]*)"/g)) {
        for (const token of (m[1] ?? '').split(/\s+/).filter(Boolean)) if (!known.has(token) && !cssClasses.has(token)) missing.add(token);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('links the routes Header.tsx and Footer.tsx link, in the same form', () => {
    const chrome = readFileSync(resolve('src/components/Header.tsx'), 'utf8') + readFileSync(resolve('src/components/Footer.tsx'), 'utf8');
    const { CHROME_HEADER, CHROME_FOOTER } = render.__testing;
    for (const m of (CHROME_HEADER + CHROME_FOOTER).matchAll(/href="(\/[^"#]*)"/g)) {
      const href = m[1] ?? '';
      if (href !== '/') expect(chrome, href).toContain(href);
    }
  });
});
