/**
 * UC-01 — the prerendered blog index shipped with zero post links.
 *
 * Verified against the real build artifact: static/blog/index.html contained
 * exactly 0 links matching /blog/<slug> and the literal text "Loading posts…".
 * renderToString never runs effects, so BlogList's useEffect fetch could not
 * execute during the static render; the state stayed at its initializer
 * (loading = true, posts = []) and the list branch was unreachable. The content
 * marketing surface's own landing page reached crawlers and no-JS visitors
 * empty, while the in-app version worked. A byte-length smoke check passed
 * throughout, because the hero markup is long enough to look healthy.
 *
 * Fix: a build-time data channel (src/lib/ssrData.ts) that prerender.mjs fills
 * from the database before render(), and BlogList reads as its initial state.
 *
 * These tests exercise the mechanism directly rather than through a full
 * production build, so they run on a clean checkout with no DATABASE_URL. The
 * real end-to-end evidence is the smoke gate, which boots the built server and
 * asserts /blog/ actually contains post links.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../src/hooks/useTheme';
import { ConsentProvider } from '../src/lib/consent-context';
import { getPrerenderBlogPosts, setPrerenderBlogPosts } from '../src/lib/ssrData';
import BlogList from '../src/pages/BlogList';

// ThemeProvider reads matchMedia during render; jsdom does not implement it.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  );
  document.head.innerHTML = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(__dirname, '..', ...segments), 'utf8');

const POSTS = [
  {
    id: '1',
    slug: 'sb-253-compliance-guide-smb',
    title: 'SB 253 compliance guide for small businesses',
    meta_description: 'What SB 253 requires and how to prepare.',
    excerpt: 'What SB 253 requires and how to prepare.',
    read_minutes: 6,
    primary_keyword: 'sb253',
    published_at: '2026-09-01T10:00:00Z',
  },
  {
    id: '2',
    slug: 'scope-3-baseline',
    title: 'Building a scope 3 baseline',
    meta_description: 'A practical baseline approach.',
    excerpt: 'A practical baseline approach.',
    read_minutes: 4,
    primary_keyword: null,
    published_at: '2026-08-15T10:00:00Z',
  },
];

function renderBlogList(): string {
  return renderToString(
    <MemoryRouter>
      <ThemeProvider>
        <ConsentProvider>
          <BlogList />
        </ConsentProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

/** UTC long-form date, computed the same way the component does. */
function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

describe('UC-01 the blog index prerenders its posts', () => {
  it('renders a link per post when build-time posts are supplied', () => {
    setPrerenderBlogPosts(POSTS);
    try {
      const html = renderBlogList();
      expect(html).toContain('href="/blog/sb-253-compliance-guide-smb"');
      expect(html).toContain('href="/blog/scope-3-baseline"');
      expect(html).toContain('SB 253 compliance guide for small businesses');
    } finally {
      setPrerenderBlogPosts(null);
    }
  });

  it('does not ship the loading state when posts are available', () => {
    setPrerenderBlogPosts(POSTS);
    try {
      const html = renderBlogList();
      expect(html).not.toContain('Loading posts');
    } finally {
      setPrerenderBlogPosts(null);
    }
  });

  it('falls back to the loading state rather than claiming there are no posts', () => {
    // An empty array must not become "No posts yet" — that reads as a promise
    // the build simply could not keep, and would hide real content.
    setPrerenderBlogPosts(null);
    const html = renderBlogList();
    expect(html).toContain('Loading posts');
    expect(html).not.toContain('No posts yet');
  });

  it('renders an empty list only when the build genuinely had zero posts', () => {
    setPrerenderBlogPosts([]);
    try {
      const html = renderBlogList();
      expect(html).toContain('No posts yet');
      expect(html).not.toContain('Loading posts');
    } finally {
      setPrerenderBlogPosts(null);
    }
  });

  it('leaves the channel clean for a later render', () => {
    setPrerenderBlogPosts(POSTS);
    expect(getPrerenderBlogPosts()).toHaveLength(2);
    setPrerenderBlogPosts(null);
    expect(getPrerenderBlogPosts()).toBeNull();
  });
});

describe('UC-01 the SSR entry wires the channel and clears it', () => {
  const entry = readRepoFile('src', 'entry-server.tsx');

  it('accepts blog posts and seeds the channel before rendering', () => {
    expect(entry).toContain('blogPosts');
    expect(entry).toMatch(/setPrerenderBlogPosts\(options\.blogPosts \?\? null\)/);
    // Must be set before renderToString, which never runs effects.
    const seedAt = entry.indexOf('setPrerenderBlogPosts(options');
    const renderAt = entry.indexOf('renderToString(');
    expect(seedAt).toBeGreaterThan(-1);
    expect(seedAt).toBeLessThan(renderAt);
  });

  it('clears the channel afterwards so a later render cannot inherit stale posts', () => {
    expect(entry).toMatch(/finally\s*\{[\s\S]{0,200}setPrerenderBlogPosts\(null\)/);
  });

  it('the prerenderer queries the same columns and ordering as /api/blog-posts', () => {
    const prerender = readRepoFile('scripts', 'prerender.mjs');
    const server = readRepoFile('server.cjs');

    const projection = prerender.match(/SELECT\s+(.+?)\s+FROM blog_posts\s+ORDER BY published_at DESC LIMIT 50/)?.[1];
    expect(projection, 'prerender blog query not found').toBeDefined();

    // Every column the static build selects must exist in the server's query,
    // or the two render different content.
    for (const column of projection!.split(',').map((c) => c.trim())) {
      expect(server, `server /api/blog-posts does not select ${column}`).toContain(column);
    }
    expect(prerender).toContain('ORDER BY published_at DESC LIMIT 50');
  });

  it('warns loudly when the build cannot reach the posts', () => {
    // This failure is invisible in the output; a silent skip would reintroduce
    // the original defect with no signal that anything was lost.
    const prerender = readRepoFile('scripts', 'prerender.mjs');
    expect(prerender).toContain('DATABASE_URL not set');
    expect(prerender).toContain('WITHOUT post links');
  });

  it('mirrors the server tag-stripping regex exactly', () => {
    // Hand-typing this literal twice is how it was nearly shipped wrong twice.
    const prerender = readRepoFile('scripts', 'prerender.mjs');
    const serverLiteral = server1();
    expect(prerender).toContain(serverLiteral);
  });
});

/** The exact regex source server.cjs uses to strip tags. */
function server1(): string {
  const server = readRepoFile('server.cjs');
  const literal = server.match(/const text = String\(row\.body_html[\s\S]*?\.replace\((\/[^/]*\/g), ' '\)/)?.[1];
  expect(literal, 'could not extract the tag-stripping regex from server.cjs').toBeDefined();
  return literal!;
}

describe('UC-05 the blog title and description do not drift', () => {
  it('the client sets the same title the static build writes', () => {
    const prerender = readRepoFile('scripts', 'prerender.mjs');
    const blogList = readRepoFile('src', 'pages', 'BlogList.tsx');

    const built = prerender.match(/'\/blog':\s*\{\s*title: '([^']+)'/)?.[1];
    expect(built, 'prerender HEAD title for /blog not found').toBeDefined();
    expect(blogList).toContain(`document.title = '${built}'`);
  });

  it('the client sets the same description the static build writes', () => {
    const prerender = readRepoFile('scripts', 'prerender.mjs');
    const blogList = readRepoFile('src', 'pages', 'BlogList.tsx');

    const built = prerender.match(/'\/blog':\s*\{[\s\S]*?description:\s*'([^']+)'/)?.[1];
    expect(built).toBeDefined();
    expect(blogList).toContain(built);
  });
});

describe('UC-04/UC-07 the blog list fails and dates gracefully', () => {
  it('never renders the browser-internal timeout message', () => {
    const blogList = readRepoFile('src', 'pages', 'BlogList.tsx');
    // A 15s AbortSignal.timeout rejects with a DOMException whose message is
    // things like "signal timed out"; that is not copy for a reader.
    expect(blogList).toContain('TimeoutError');
    expect(blogList).toContain('took too long to respond');
  });

  it('renders a real date rather than the browser default for a valid timestamp', () => {
    setPrerenderBlogPosts(POSTS);
    try {
      const html = renderBlogList();
      expect(html).toContain(longDate(POSTS[0].published_at));
      expect(html).not.toContain('Invalid Date');
    } finally {
      setPrerenderBlogPosts(null);
    }
  });

  it('renders "Undated" for an unparseable published_at instead of "Invalid Date"', () => {
    // new Date(bad) does not throw — it yields an Invalid Date and
    // toLocaleDateString() returns the literal string "Invalid Date", which was
    // then printed under a post title. The old try/catch could not catch this
    // because nothing threw.
    const bad = { ...POSTS[0], slug: 'bad-date', published_at: 'not-a-date' };
    setPrerenderBlogPosts([bad]);
    try {
      const html = renderBlogList();
      expect(html).toContain('Undated');
      expect(html).not.toContain('Invalid Date');
    } finally {
      setPrerenderBlogPosts(null);
    }
  });

  it('does not render the epoch for a missing timestamp', () => {
    const missing = { ...POSTS[0], slug: 'no-date', published_at: '' };
    setPrerenderBlogPosts([missing]);
    try {
      const html = renderBlogList();
      expect(html).not.toContain('January 1, 1970');
      expect(html).toContain('Undated');
    } finally {
      setPrerenderBlogPosts(null);
    }
  });
});

describe('UC-02/UC-03 the shells and the paywall are navigable', () => {
  it('the auth shell defines the main-content landmark like every other shell', () => {
    const authShell = readRepoFile('src', 'components', 'auth', 'AuthShell.tsx');
    expect(authShell).toMatch(/<main id="main-content" tabIndex=\{-1\}/);
  });

  it('the full-page paywall heading is the page heading, not an h4', () => {
    const prompt = readRepoFile('src', 'components', 'UpgradePrompt.tsx');
    expect(prompt).toMatch(/const Heading = fullPage \? 'h1' : 'h2'/);
    expect(prompt).not.toContain('<h4');
  });
});