/**
 * End-to-end check of the blog head rewrite against the REAL built shell.
 *
 * The unit tests use a trimmed shell. This loads static/index.html as the
 * production build actually emits it, runs the server's own rewrite over it, and
 * asserts the properties that matter for a live post URL. It skips when the
 * build output is absent so `npm test` still works on a clean checkout.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const shellPath = resolve(root, 'static', 'index.html');
const hasBuild = existsSync(shellPath);

const serverSource = readFileSync(resolve(root, 'server.cjs'), 'utf8');

function loadRenderer() {
  const start = serverSource.indexOf('function escapeHtmlAttribute(');
  const end = serverSource.indexOf("app.get('/blog/:slug'");
  const body = serverSource.slice(start, end);
  return new Function('APP_BASE_URL', `${body}\n return { renderBlogPostHead };`)(
    'https://ecoauditor.io',
  ).renderBlogPostHead;
}

const post = {
  slug: 'sb-253-compliance-guide-smb',
  title: 'SB 253 Compliance Guide for SMBs: A Practical Roadmap',
  meta_title: 'SB 253 Compliance Guide for SMBs | Eco-Auditor',
  meta_description: 'A step-by-step SB 253 compliance roadmap for small and mid-sized businesses.',
  published_at: '2026-07-29T01:10:26.536Z',
};
const canonical = 'https://ecoauditor.io/blog/sb-253-compliance-guide-smb/';

describe.skipIf(!hasBuild)('blog head rewrite against the real built shell', () => {
  if (!hasBuild) return;
  const renderBlogPostHead = loadRenderer();
  const shell = readFileSync(shellPath, 'utf8');
  const out = renderBlogPostHead(shell, post, canonical);

  it('replaces the homepage canonical', () => {
    expect(shell).toContain('<link rel="canonical" href="https://ecoauditor.io/" />');
    expect(out).toContain(`<link rel="canonical" href="${canonical}" />`);
    expect(out).not.toContain('<link rel="canonical" href="https://ecoauditor.io/" />');
  });

  it('rewrites the title', () => {
    expect(out).toContain('<title>SB 253 Compliance Guide for SMBs | Eco-Auditor</title>');
  });

  it('leaves no homepage FAQPage behind and emits a BlogPosting node', () => {
    expect(out).not.toContain('"@type": "FAQPage"');
    expect(out).toContain('"@type": "BlogPosting"');
  });

  it('produces JSON-LD that parses', () => {
    const blocks = [...out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    expect(() => JSON.parse(blocks[0]![1])).not.toThrow();
    expect(JSON.parse(blocks[0]![1])['@type']).toBe('BlogPosting');
  });

  it('keeps the app bootstrap intact so hydration still works', () => {
    expect(out).toContain('<div id="root">');
    expect(out).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/);
  });

  it('cannot be broken out of the JSON-LD block by a hostile title', () => {
    const hostile = renderBlogPostHead(
      shell,
      { ...post, title: 'x</script><script>alert(1)</script>' },
      canonical,
    );
    const blocks = [...hostile.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    expect(hostile).not.toContain('<script>alert(1)</script>');
    expect(JSON.parse(blocks[0]![1]).headline).toBe('x</script><script>alert(1)</script>');
  });
});