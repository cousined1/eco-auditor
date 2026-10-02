// F-F-03: static/index.html (the homepage's prerender) doubled as the fallback for
// /app/*, /auth/* and every blog URL, so each hard load of those first painted the
// marketing hero and the intro video poster before the client replaced it. The build
// now also writes a neutral shell (empty #root, noindex, none of the homepage copy).
//
// The head functions are pure, so the first half runs against the real index.html on
// every test run; the second half asserts the build output and is skipped without one.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOINDEX_ROUTES,
  ROUTES,
  SHELL_DESCRIPTION,
  SHELL_TITLE,
  applyRouteHead,
  applyShellHead,
  canonicalFor,
  loadRouteData,
  sitemapPaths,
  // @ts-expect-error -- importing a Node ESM .mjs module with no type declarations
} from '../scripts/prerender-head.mjs';

const template = readFileSync(resolve('index.html'), 'utf8');
const data = loadRouteData();
const shell = applyShellHead(template) as string;
const routes = ROUTES as string[];
const noindex = NOINDEX_ROUTES as Set<string>;
const attr = (html: string, tag: RegExp) => tag.exec(html)?.[1] ?? null;

describe('the neutral shell (applyShellHead)', () => {
  it('is not indexable and names no URL of its own', () => {
    expect(shell).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(shell).not.toContain('rel="canonical"');
    expect(shell).not.toContain('property="og:url"');
    expect(shell).not.toContain('name="twitter:url"');
  });

  it('has an empty #root, so nothing is painted before the client renders', () => {
    expect(shell).toContain('<div id="root"></div>');
    expect(shell).not.toMatch(/<h1\b/);
    expect(shell).not.toMatch(/<video\b/);
  });

  it('carries none of the homepage copy, including the tagline in the image alt text', () => {
    const home = (data.routeMeta as Record<string, { title: string; description: string }>)['/'] as { title: string; description: string };
    expect(attr(shell, /<title>([^<]*)<\/title>/)).toBe(SHELL_TITLE);
    expect(attr(shell, /<meta name="description" content="([^"]*)"/)).toBe(SHELL_DESCRIPTION);
    expect(shell).not.toContain(home.title);
    expect(shell).not.toContain(home.description);
    expect(shell).not.toContain('as easy as bookkeeping');
    expect(attr(shell, /<meta property="og:title" content="([^"]*)"/)).toBe(SHELL_TITLE);
    expect(attr(shell, /<meta name="twitter:description" content="([^"]*)"/)).toBe(SHELL_DESCRIPTION);
  });

  it('keeps the site-wide JSON-LD entities, which the blog pages refer to by @id', () => {
    const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(shell)?.[1] ?? '{}';
    const graph = (JSON.parse(script) as { '@graph': { '@type': string }[] })['@graph'];
    expect(graph.map((node) => node['@type']).sort()).toEqual(['Organization', 'SoftwareApplication', 'WebSite']);
  });

  it('fails the build when the template stops matching, instead of shipping the homepage head', () => {
    for (const tag of [/<meta name="robots"[^>]*>/, /<title>[^<]*<\/title>/, /<meta name="description"[^>]*>/, /<link rel="canonical"[^>]*>/, /<meta property="og:image:alt"[^>]*>/]) {
      expect(() => applyShellHead(template.replace(tag, '')), String(tag)).toThrow(/template has no/);
    }
  });
});

describe('every prerendered page names its own URL, twitter:url included (F-F-01)', () => {
  it.each(routes)('%s', (route) => {
    const html = applyRouteHead(template, route, data) as string;
    if (noindex.has(route)) {
      expect(html).not.toContain('name="twitter:url"');
    } else {
      expect(attr(html, /<meta name="twitter:url" content="([^"]*)"/)).toBe(canonicalFor(route));
    }
  });
});

describe('sitemapPaths', () => {
  it('is every prerendered route that is indexable, in canonical form, and no auth page', () => {
    const paths = sitemapPaths() as string[];
    expect(paths).toEqual(routes.filter((r) => !noindex.has(r)).map((r) => (r === '/' ? '/' : `${r}/`)));
    expect(paths).toContain('/blog/');
    for (const auth of ['/login/', '/signup/', '/forgot-password/']) expect(paths).not.toContain(auth);
  });

  it('left no hand-written sitemap behind', () => {
    expect(existsSync(resolve('public/sitemap.xml'))).toBe(false);
  });
});

const built = existsSync(join('static', 'app-shell.html')) && existsSync(join('static', 'index.html'));

describe.skipIf(!built)('the build output (F-F-03, F-F-13)', () => {
  it('wrote the shell next to, and not as, the homepage', () => {
    const appShell = readFileSync(join('static', 'app-shell.html'), 'utf8');
    const homepage = readFileSync(join('static', 'index.html'), 'utf8');
    expect(appShell).toContain('<div id="root"></div>');
    expect(appShell).toContain('noindex,nofollow');
    expect(appShell).not.toContain('as easy as bookkeeping');
    // The homepage prerender is still the homepage.
    expect(homepage).toContain('as easy as bookkeeping');
    expect(homepage).toContain(`<link rel="canonical" href="${canonicalFor('/')}" />`);
  });

  it('wrote the indexable routes for the server\'s sitemap, and no sitemap.xml of its own', () => {
    expect(JSON.parse(readFileSync(join('static', 'sitemap-routes.json'), 'utf8'))).toEqual(sitemapPaths());
    expect(existsSync(join('static', 'sitemap.xml'))).toBe(false);
  });
});
