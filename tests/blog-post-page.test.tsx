/**
 * Blog post detail page regressions.
 *
 * src/pages/BlogPost.tsx had zero component coverage — every mention of it in
 * tests/ was an explanatory comment, never an import. It is the page a search
 * visitor lands on, and it rendered under a post title exactly the strings an
 * unfixed date bug produces.
 *
 * BLOG-01 (medium) — a param change on the same route (/blog/a -> /blog/b)
 * reuses the component rather than remounting it, and the effect never reset
 * `error`, `post` or `loading`. Arriving at a second post after a 404 left
 * `error` set; the error and article blocks are independent conditions, so both
 * rendered and the reader saw "Post not found" above a correctly loaded
 * article. `loading` also never returned to true, so the stale error was shown
 * during the next fetch instead of "Loading…".
 *
 * BLOG-02 (medium) — formatDate existed in this file AND in BlogList.tsx, and
 * only the BlogList copy was fixed. `new Date(bad)` does not throw; it yields an
 * Invalid Date and toLocaleDateString() returns the literal "Invalid Date", so
 * the try/catch wrapping it could never fire. The same post read "Undated" on
 * the index and "Invalid Date" under its own title. Both now call
 * src/lib/formatDate.ts.
 *
 * BLOG-03 (low) — the effect overwrote <meta name="description"> but its cleanup
 * restored only document.title, so a post's description stayed on every page
 * navigated to afterwards.
 *
 * BLOG-04 (low) — estimateReadTime read html.length during render, so a post
 * with a null body_html threw a TypeError and took the page into the
 * ErrorBoundary.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BlogPostPage from '../src/pages/BlogPost';
import { formatPublishedDate } from '../src/lib/formatDate';

const nav: { current: ((to: string) => void) | null } = { current: null };

function CaptureNavigate() {
  const go = useNavigate();
  // Assigned in an effect, not during render: the react-hooks immutability rule
  // rejects mutating module state while rendering.
  useEffect(() => {
    nav.current = go;
  }, [go]);
  return null;
}

function post(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    slug: 'first-post',
    title: 'First post',
    meta_title: 'First post | Eco-Auditor',
    meta_description: 'The first post description.',
    body_html: '<p>Hello world</p>',
    primary_keyword: 'carbon',
    faq: [],
    internal_links: [],
    external_links: [],
    cta: { label: 'Get started', href: '/signup' },
    content_score: null,
    geo_score: null,
    published_at: '2026-03-04T00:00:00.000Z',
    ...over,
  };
}

function jsonOnce(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

/**
 * Mounts the real page at /blog/:slug.
 */
async function mount(entry: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <CaptureNavigate />
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/**
 * A real client-side param change. React Router matches /blog/:slug for both
 * entries and reuses the mounted element rather than remounting it, which is
 * the exact condition BLOG-01 needs. Re-rendering with a different
 * initialEntries would NOT do this — MemoryRouter ignores it after mount — so
 * the test would silently pass on the old code.
 */
async function navigateTo(entry: string) {
  await act(async () => {
    nav.current!(entry);
  });
}

const text = () => container.textContent || '';
const headingNamed = (name: string) =>
  Array.from(container.querySelectorAll('h1, h2')).some((h) => h.textContent === name);

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.head.innerHTML = '<meta name="description" content="The site default description." />';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('formatPublishedDate', () => {
  it('renders a valid ISO date', () => {
    expect(formatPublishedDate('2026-03-04T00:00:00.000Z')).toMatch(/2026/);
  });

  it('renders "Undated" rather than "Invalid Date" for an unparseable value', () => {
    expect(formatPublishedDate('not a date')).toBe('Undated');
  });

  it('renders "Undated" rather than January 1, 1970 for a null published_at', () => {
    // new Date(null) is the epoch, not invalid — this is the case that put
    // "January 1, 1970" under a real post title.
    expect(formatPublishedDate(null)).toBe('Undated');
    expect(formatPublishedDate(undefined)).toBe('Undated');
    expect(formatPublishedDate('')).toBe('Undated');
  });
});

describe('BlogPost page state across a slug change (BLOG-01)', () => {
  it('clears a 404 error when the next slug loads, and never shows both', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonOnce({ error: 'nope' }, 404))
      .mockImplementationOnce(async () => jsonOnce({ post: post({ title: 'Second post', slug: 'second-post' }) }));

    await mount('/blog/missing-post');
    expect(headingNamed('Post not found')).toBe(true);

    await navigateTo('/blog/second-post');

    expect(headingNamed('Second post')).toBe(true);
    // The defect: error and post were independent conditions, so the error
    // banner rendered above an article that had loaded correctly.
    expect(
      headingNamed('Post not found'),
      'the previous slug\'s 404 stayed on screen above a correctly loaded article',
    ).toBe(false);
  });

  it('does not leave the previous post on screen while the next one loads', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonOnce({ post: post() }))
      .mockImplementationOnce(async () => jsonOnce({ post: post({ title: 'Second post', slug: 'second-post' }) }));

    await mount('/blog/first-post');
    expect(headingNamed('First post')).toBe(true);

    await navigateTo('/blog/second-post');

    expect(headingNamed('Second post')).toBe(true);
    expect(headingNamed('First post')).toBe(false);
  });
});

describe('BlogPost page meta hygiene (BLOG-03)', () => {
  it('restores the site default description when the page unmounts', async () => {
    fetchMock.mockImplementation(async () => jsonOnce({ post: post() }));
    await mount('/blog/first-post');

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    expect(desc.content).toBe('The first post description.');

    await act(async () => {
      root.render(<div />);
    });

    expect(
      desc.content,
      "a post's meta description leaked onto every page navigated to afterwards",
    ).toBe('The site default description.');
  });
});

describe('BlogPost renders degraded data instead of crashing (BLOG-04, BLOG-02)', () => {
  it('renders a post with a null body instead of throwing into the ErrorBoundary', async () => {
    fetchMock.mockImplementation(async () => jsonOnce({ post: post({ body_html: null }) }));
    await mount('/blog/first-post');

    expect(headingNamed('First post')).toBe(true);
    expect(text()).toContain('1 min read');
  });

  it('shows "Undated" under the title for a null published_at', async () => {
    fetchMock.mockImplementation(async () => jsonOnce({ post: post({ published_at: null }) }));
    await mount('/blog/first-post');

    expect(headingNamed('First post')).toBe(true);
    expect(text()).toContain('Undated');
    expect(text()).not.toContain('Invalid Date');
    expect(text()).not.toContain('1970');
  });

  it('shows "Undated" rather than "Invalid Date" for an unparseable published_at', async () => {
    fetchMock.mockImplementation(async () => jsonOnce({ post: post({ published_at: 'garbage' }) }));
    await mount('/blog/first-post');

    expect(text()).toContain('Undated');
    expect(text()).not.toContain('Invalid Date');
  });
});

describe('BlogPost and BlogList share one date formatter', () => {
  it('neither page defines its own copy of the formatter', async () => {
    // The original defect was two copies with one fixed and one not.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(__dirname, '..');
    for (const file of ['src/pages/BlogPost.tsx', 'src/pages/BlogList.tsx']) {
      const src = readFileSync(resolve(root, file), 'utf8');
      expect(src, `${file} still declares its own date formatter`).not.toMatch(/function\s+formatDate\s*\(/);
      expect(src, `${file} does not use the shared formatter`).toContain('lib/formatDate');
    }
  });
});