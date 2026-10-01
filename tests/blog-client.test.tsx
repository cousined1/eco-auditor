// F-F-01 / F-F-11, client side. The server renders /blog/ and /blog/<slug>/ and
// embeds what it rendered from; the client replaces the server's HTML with React's.
// That swap must show the same page, not a loading state, and the head it sets after
// client-side navigation must be the one the server computed, canonical included.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentProvider } from '../src/lib/consent-context';
import { applyPageHead } from '../src/lib/page-head';
import { discardEmbeddedJson, readEmbeddedJson } from '../src/lib/embedded-data';
import BlogList from '../src/pages/BlogList';
import BlogPostPage from '../src/pages/BlogPost';

const HEAD = {
  title: 'First post | Eco-Auditor',
  description: 'The first description.',
  canonical: 'https://ecoauditor.io/blog/first-post/',
};
const POST = {
  id: 'id-1',
  slug: 'first-post',
  title: 'First post: Scope 1 basics',
  meta_title: HEAD.title,
  meta_description: HEAD.description,
  body_html: '<h1>First post: Scope 1 basics</h1><h2>Start</h2><p>Body text of the first post.</p>',
  primary_keyword: 'carbon accounting',
  faq: [{ question: 'What is Scope 1?', answer: 'Direct emissions.' }],
  internal_links: [],
  external_links: [],
  cta: {},
  content_score: null,
  geo_score: null,
  published_at: '2026-09-01T10:00:00.000Z',
};
const PAGE_HEAD = {
  title: 'Blog — Eco-Auditor | Carbon Accounting for SMBs',
  description: 'The blog description.',
  canonical: 'https://ecoauditor.io/blog/',
};

let container: HTMLDivElement;
let root: Root;
const added: Element[] = [];

function addToHead(element: Element) {
  document.head.append(element);
  added.push(element);
}

function seedHead() {
  document.title = PAGE_HEAD.title;
  const tags: [string, Record<string, string>][] = [
    ['meta', { name: 'description', content: PAGE_HEAD.description }],
    ['link', { rel: 'canonical', href: PAGE_HEAD.canonical }],
    ['meta', { property: 'og:url', content: PAGE_HEAD.canonical }],
    ['meta', { property: 'og:title', content: PAGE_HEAD.title }],
    ['meta', { property: 'og:description', content: PAGE_HEAD.description }],
    ['meta', { name: 'twitter:title', content: PAGE_HEAD.title }],
  ];
  for (const [name, attributes] of tags) {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    addToHead(element);
  }
}

function embed(id: string, data: unknown) {
  const script = document.createElement('script');
  script.type = 'application/json';
  script.id = id;
  script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  document.body.append(script);
  added.push(script);
}

const meta = (selector: string, attribute = 'content') => document.head.querySelector(selector)?.getAttribute(attribute);

async function mount(path: string) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ConsentProvider>
          <Routes>
            <Route path="/blog" element={<BlogList />} />
            <Route path="/blog/:slug" element={<BlogPostPage />} />
          </Routes>
        </ConsentProvider>
      </MemoryRouter>,
    ),
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchMock = vi.fn(() => Promise.reject(new Error('unexpected request')));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  seedHead();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const element of added.splice(0)) element.remove();
  vi.unstubAllGlobals();
});

describe('the post page starts from what the server embedded', () => {
  it('renders the post at once: no loading state and no request', async () => {
    embed('blog-post-data', { post: POST, head: HEAD });
    await mount('/blog/first-post/');

    expect(container.querySelector('h1')?.textContent).toBe(POST.title);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.textContent).toContain('Body text of the first post.');
    expect(container.textContent).toContain('What is Scope 1?');
    expect(container.textContent).not.toContain('Loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the server\'s head, canonical and og:url included, and puts the old one back on leaving', async () => {
    embed('blog-post-data', { post: POST, head: HEAD });
    await mount('/blog/first-post/');

    expect(document.title).toBe(HEAD.title);
    expect(meta('meta[name="description"]')).toBe(HEAD.description);
    expect(meta('link[rel="canonical"]', 'href')).toBe(HEAD.canonical);
    expect(meta('meta[property="og:url"]')).toBe(HEAD.canonical);
    expect(meta('meta[property="og:title"]')).toBe(HEAD.title);

    await act(async () => root.render(<div />));
    expect(document.title).toBe(PAGE_HEAD.title);
    expect(meta('meta[name="description"]')).toBe(PAGE_HEAD.description);
    expect(meta('link[rel="canonical"]', 'href')).toBe(PAGE_HEAD.canonical);
    expect(meta('meta[property="og:url"]')).toBe(PAGE_HEAD.canonical);
  });

  it('adds no structured data of its own: the server\'s page already carries Article and FAQPage', async () => {
    embed('blog-post-data', { post: POST, head: HEAD });
    await mount('/blog/first-post/');
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
  });

  it('uses the embedded data once: a later visit to the page fetches fresh data', async () => {
    embed('blog-post-data', { post: POST, head: HEAD });
    await mount('/blog/first-post/');
    expect(document.getElementById('blog-post-data')).toBeNull();
  });

  it('fetches the post when nothing was embedded, and applies the head the API returns', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ post: POST, head: HEAD }), { status: 200 })));
    await mount('/blog/first-post/');
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith('/api/blog-posts/first-post');
    expect(container.querySelector('h1')?.textContent).toBe(POST.title);
    expect(document.title).toBe(HEAD.title);
    expect(meta('link[rel="canonical"]', 'href')).toBe(HEAD.canonical);
  });

  it('ignores data embedded for a different post', async () => {
    embed('blog-post-data', { post: { ...POST, slug: 'another-post', title: 'Another post' }, head: HEAD });
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ post: POST, head: HEAD }), { status: 200 })));
    await mount('/blog/first-post/');
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith('/api/blog-posts/first-post');
    expect(container.querySelector('h1')?.textContent).toBe(POST.title);
  });

  it('says so when the post does not exist', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 })));
    await mount('/blog/nope/');
    await act(async () => {});

    expect(container.querySelector('h1')?.textContent).toBe('Post not found');
    expect(container.querySelector('a[href="/blog/"]')).not.toBeNull();
  });

  it('links back to the blog in the canonical slash form', async () => {
    embed('blog-post-data', { post: POST, head: HEAD });
    await mount('/blog/first-post/');
    const hrefs = [...container.querySelectorAll('article a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/blog/');
    expect(hrefs).not.toContain('/blog');
  });
});

// D-W2A-5, client side. The server empties a CTA whose target is not a root-relative
// path or an https URL before it embeds or returns a post, and the page applies the
// same allowlist again before it renders one: the post it is given is data, from the
// page or from the API, and an <a> made from it must not be a way to run script.
describe('the call to action on the post page', () => {
  const cta = (href: string, label = 'Start your free trial') => ({ ...POST, cta: { label, href } });
  const ctaLinks = () => [...container.querySelectorAll('article section a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href') }));

  it('renders a call to action that points at a path of the site', async () => {
    embed('blog-post-data', { post: cta('/signup/'), head: HEAD });
    await mount('/blog/first-post/');

    expect(ctaLinks()).toEqual([{ text: 'Start your free trial', href: '/signup/' }]);
  });

  it('renders one that points at an https URL', async () => {
    embed('blog-post-data', { post: cta('https://example.com/offer'), head: HEAD });
    await mount('/blog/first-post/');

    expect(ctaLinks().map((link) => link.href)).toEqual(['https://example.com/offer']);
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example', '/\t/evil.example', 'http://example.com', 'relative', ''])(
    'renders no call to action for a target of %j, whatever the data says',
    async (href) => {
      embed('blog-post-data', { post: cta(href), head: HEAD });
      await mount('/blog/first-post/');

      expect(ctaLinks()).toEqual([]);
      // Nothing on the page can carry the value into a link.
      const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
      expect(hrefs.filter((h) => /^\s*(javascript|data|vbscript):/i.test(h) || h.startsWith('//'))).toEqual([]);
    },
  );

  it('does the same for a post fetched from the API', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ post: cta('javascript:alert(1)'), head: HEAD }), { status: 200 })));
    await mount('/blog/first-post/');
    await act(async () => {});

    expect(container.querySelector('h1')?.textContent).toBe(POST.title);
    expect(ctaLinks()).toEqual([]);
  });

  it('falls back to "Get started" when the call to action has no label', async () => {
    embed('blog-post-data', { post: { ...POST, cta: { href: '/signup/' } }, head: HEAD });
    await mount('/blog/first-post/');

    expect(ctaLinks()).toEqual([{ text: 'Get started', href: '/signup/' }]);
  });
});

describe('the blog index starts from what the server embedded', () => {
  const ITEM = { id: 'id-1', slug: 'first-post', title: POST.title, meta_description: POST.meta_description, excerpt: 'An excerpt.', read_minutes: 3, primary_keyword: 'carbon accounting', content_score: null, geo_score: null, published_at: POST.published_at };

  it('renders the list at once, with slash-form links, and makes no request', async () => {
    embed('blog-list-data', { posts: [ITEM] });
    await mount('/blog');

    expect(container.textContent).not.toContain('Loading posts');
    expect(container.textContent).toContain(ITEM.title);
    expect(container.textContent).toContain('3 min read');
    const hrefs = [...container.querySelectorAll('article a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/blog/first-post/', '/blog/first-post/']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById('blog-list-data')).toBeNull();
  });

  it('fetches the list when nothing was embedded', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ posts: [ITEM] }), { status: 200 })));
    await mount('/blog');
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith('/api/blog-posts');
    expect(container.textContent).toContain(ITEM.title);
  });
});

describe('applyPageHead and the embedded-data helpers', () => {
  it('only touches tags the document has, and restores every one of them', () => {
    // No twitter:description in this document: it is left alone, not created.
    const restore = applyPageHead(HEAD);
    expect(document.head.querySelector('meta[name="twitter:description"]')).toBeNull();
    expect(meta('meta[name="twitter:title"]')).toBe(HEAD.title);
    restore();
    expect(meta('meta[name="twitter:title"]')).toBe(PAGE_HEAD.title);
    expect(document.title).toBe(PAGE_HEAD.title);
  });

  it('reads embedded JSON, tolerates bad or missing JSON, and discards it', () => {
    expect(readEmbeddedJson('nothing-here')).toBeNull();
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = 'broken-data';
    script.textContent = '{not json';
    document.body.append(script);
    added.push(script);
    expect(readEmbeddedJson('broken-data')).toBeNull();
    embed('good-data', { a: 1 });
    expect(readEmbeddedJson('good-data')).toEqual({ a: 1 });
    discardEmbeddedJson('good-data');
    expect(readEmbeddedJson('good-data')).toBeNull();
  });
});
