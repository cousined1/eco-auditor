/**
 * Route-ordering guards.
 *
 * express.static serves `static/`, which contains a build-time mirror of
 * `public/sitemap.xml`. Express matches routes in registration order, so a
 * `app.get('/sitemap.xml', …)` registered after `express.static` is dead code —
 * the static file answers first and the dynamic route never runs.
 *
 * That is not theoretical: the dynamic sitemap shipped in this shape and was
 * silently inert. It was caught by booting the server and diffing the response
 * against the static file, not by any test, because source-level assertions
 * cannot see registration order. These pins make the order explicit.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const serverSource = readFileSync(resolve(root, 'server.cjs'), 'utf8');

const idx = (needle: string) => serverSource.indexOf(needle);

describe('route registration order', () => {
  it('registers the dynamic sitemap BEFORE express.static', () => {
    const route = idx("app.get('/sitemap.xml'");
    const stat = idx('express.static(path.join');
    expect(route, 'sitemap route not found').toBeGreaterThan(-1);
    expect(stat, 'express.static not found').toBeGreaterThan(-1);
    expect(
      route,
      'the sitemap route is registered after express.static and would be shadowed by static/sitemap.xml',
    ).toBeLessThan(stat);
  });

  it('registers the sitemap exactly once', () => {
    expect([...serverSource.matchAll(/app\.get\('\/sitemap\.xml'/g)]).toHaveLength(1);
  });

  it('still mounts express.static (a bad fix removes it entirely)', () => {
    expect(serverSource).toMatch(/app\.use\(express\.static\(path\.join\(__dirname, 'static'/);
    expect(serverSource).toContain('getStaticCacheHeaders(filePath)');
  });

  it('keeps the blog head route above the SPA fallback', () => {
    const blog = idx("app.get('/blog/:slug'");
    const fallback = idx('// ─── SPA fallback ───');
    expect(blog).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(-1);
    expect(blog, 'blog route must precede the SPA fallback').toBeLessThan(fallback);
  });

  it('keeps the blog head route below express.static so it can rewrite the shell', () => {
    // Deliberately AFTER: the route reads static/index.html itself and rewrites
    // its head, so it needs express.static not to have answered first — but it
    // must still be a real route rather than swallowed by the fallback.
    const blog = idx("app.get('/blog/:slug'");
    const stat = idx('express.static(path.join');
    expect(blog).toBeGreaterThan(stat);
  });
});

describe.skipIf(!existsSync(resolve(root, 'static', 'sitemap.xml')))(
  'the static sitemap mirror still exists but is shadowed on purpose',
  () => {
    it('is a build-time copy, so its presence is expected and harmless', () => {
      const mirrored = readFileSync(resolve(root, 'static', 'sitemap.xml'), 'utf8');
      expect(mirrored).toContain('<urlset');
      // It lists no posts — which is the whole reason the dynamic route exists.
      expect(mirrored).not.toMatch(/\/blog\/[a-z0-9-]+\/<\/loc>/);
    });
  },
);