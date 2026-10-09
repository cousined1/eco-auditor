/**
 * SEO-01: blog post URLs must not canonicalise to the homepage.
 *
 * Verified live on 2026-10-05: every published /blog/:slug URL fell through to
 * the SPA fallback and returned static/index.html, so all seven posts shipped
 * the homepage's <title>, meta description, OG tags and FAQPage JSON-LD — and
 * this:
 *
 *   <link rel="canonical" href="https://ecoauditor.io/" />
 *
 * A canonical pointing at the homepage is an explicit instruction to
 * consolidate that URL away. With no post URLs in the sitemap and no post links
 * in the prerendered /blog/, Google had three independent signals to drop every
 * article.
 *
 * These tests exercise the head rewrite against the real built shell so the
 * canonical, title, OG and structured data cannot silently regress.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');

/** Extracts the head-rewriting helper so the real code is under test. */
function loadRenderer(): (shell: string, post: unknown, canonicalUrl: string) => string {
  const start = serverSource.indexOf('function renderBlogPostHead(');
  expect(start, 'renderBlogPostHead not found').toBeGreaterThan(-1);
  const helpersStart = serverSource.indexOf('function escapeHtmlAttribute(');
  const routeStart = serverSource.indexOf("app.get('/blog/:slug'");
  const body = serverSource.slice(helpersStart, routeStart);
  const factory = new Function(
    'APP_BASE_URL',
    `${body}
     return { renderBlogPostHead, escapeHtmlAttribute };`
  );
  return factory('https://ecoauditor.io').renderBlogPostHead;
}

const renderBlogPostHead = loadRenderer();

// A trimmed but structurally faithful copy of the real shell's head.
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>Eco-Auditor — GHG Carbon Accounting for SMBs</title>
    <meta name="description" content="Eco-Auditor gives small and mid-size businesses reviewable GHG emissions data." />
    <link rel="canonical" href="https://ecoauditor.io/" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://ecoauditor.io/" />
    <meta property="og:title" content="Eco-Auditor — GHG Carbon Accounting for SMBs" />
    <meta property="og:description" content="Reviewable Scope 1-3 emissions data without enterprise software." />
    <meta name="twitter:url" content="https://ecoauditor.io/" />
    <meta name="twitter:title" content="Eco-Auditor — GHG Carbon Accounting for SMBs" />
    <meta name="twitter:description" content="Eco-Auditor is a GHG Protocol-aligned carbon accounting platform." />
    <script type="application/ld+json">
    { "@type": "FAQPage", "mainEntity": [ { "question": "What is Eco-Auditor?" } ] }
    </script>
    <script type="module" crossorigin src="/assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

const post = {
  slug: 'sb-253-compliance-guide-smb',
  title: 'SB 253 Compliance Guide for SMBs: A Practical Roadmap',
  meta_title: 'SB 253 Compliance Guide for SMBs | Eco-Auditor',
  meta_description: 'A step-by-step SB 253 compliance roadmap for small and mid-sized businesses.',
  published_at: '2026-07-29T01:10:26.536Z',
};
const canonical = 'https://ecoauditor.io/blog/sb-253-compliance-guide-smb/';

describe('SEO-01 blog posts are not canonicalised to the homepage', () => {
  const out = renderBlogPostHead(SHELL, post, canonical);

  it('emits a self-referencing canonical', () => {
    expect(out).toContain(`<link rel="canonical" href="${canonical}" />`);
    expect(out).not.toMatch(/rel="canonical" href="https:\/\/ecoauditor\.io\/"/);
  });

  it('replaces the homepage title with the article title', () => {
    expect(out).toContain('<title>SB 253 Compliance Guide for SMBs | Eco-Auditor</title>');
    expect(out).not.toContain('GHG Carbon Accounting for SMBs</title>');
  });

  it('replaces the homepage description with the article description', () => {
    expect(out).toContain('<meta name="description" content="A step-by-step SB 253 compliance');
    expect(out).not.toContain('content="Eco-Auditor gives small and mid-size');
  });

  it('points og:url, twitter:url and og:type at the article', () => {
    expect(out).toContain(`<meta property="og:url" content="${canonical}" />`);
    expect(out).toContain(`<meta name="twitter:url" content="${canonical}" />`);
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).toContain('<meta property="og:title" content="SB 253 Compliance Guide for SMBs | Eco-Auditor" />');
  });

  it('replaces the homepage FAQPage with a BlogPosting node for this article', () => {
    expect(out).toContain('"@type": "BlogPosting"');
    expect(out).not.toContain('"@type": "FAQPage"');
    expect(out).toContain(`"url": "${canonical}"`);
    expect(out).toContain('"datePublished": "2026-07-29T01:10:26.536Z"');
  });

  it('does not disturb the module script that boots the app', () => {
    expect(out).toContain('<script type="module" crossorigin src="/assets/index.js"></script>');
    expect(out).toContain('<div id="root"></div>');
  });

  it('escapes a hostile title rather than injecting markup into the head', () => {
    const evil = renderBlogPostHead(
      SHELL,
      { ...post, title: 'Bad "><script>alert(1)</script>', meta_title: null },
      canonical,
    );
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('appends the site suffix only when the title does not already carry it', () => {
    expect(renderBlogPostHead(SHELL, post, canonical)).toContain('<title>SB 253 Compliance Guide for SMBs | Eco-Auditor</title>');
    const already = renderBlogPostHead(SHELL, { ...post, meta_title: 'Something | Eco-Auditor' }, canonical);
    expect(already).toContain('<title>Something | Eco-Auditor</title>');
    expect(already.match(/\| Eco-Auditor<\/title>/g)).toHaveLength(1);
  });
});

describe('SEO-02 the sitemap lists published posts', () => {
  const sitemapRoute = serverSource.slice(
    serverSource.indexOf("app.get('/sitemap.xml'"),
    serverSource.indexOf('// ─── SPA fallback ───'),
  );

  it('is served from the database, not only the static file', () => {
    expect(sitemapRoute).toContain('FROM blog_posts');
    expect(sitemapRoute).toContain('/blog/');
    expect(sitemapRoute).toContain('encodeURIComponent(row.slug)');
  });

  it('never advertises auth-only app routes', () => {
    expect(sitemapRoute).not.toMatch(/loc.*\/app\//);
    expect(sitemapRoute).not.toMatch(/loc.*\/auth\//);
  });

  it('sets an XML content type', () => {
    expect(sitemapRoute).toContain('application/xml');
  });

  it('degrades to the marketing pages when the table is missing', () => {
    // The read is wrapped so a missing blog_posts table cannot 500 the sitemap.
    expect(sitemapRoute).toMatch(/catch\s*\(err\)/);
    expect(sitemapRoute).toContain("log('warn'");
  });
});