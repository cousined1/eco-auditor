// F-F-12: every page is prerendered at <route>/index.html and its canonical URL has
// the trailing slash, so express.static answers the bare path (/pricing) with a 301.
// A link written bare costs every crawler and every refresh one redirect, and the
// homepage's footer alone had nine. Internal links are written in the canonical form.
//
// This scans src for links that still are not, and fails the day somebody adds one.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- importing a Node ESM .mjs module with no type declarations
import { ROUTES } from '../scripts/prerender-head.mjs';

// The routes scripts/prerender.mjs writes as <route>/index.html; blog posts, which the
// server renders at /blog/<slug>/, are checked separately.
const PAGES = new Set((ROUTES as string[]).filter((route) => route !== '/'));

// Files whose links another work item owns; each entry is a known exception, not a
// precedent. Remove an entry when its file is fixed. (Empty since the consent banner
// was fixed at integration.)
const KNOWN_EXCEPTIONS = new Set<string>([]);

/**
 * Links whose target starts with a literal path: to="/x", href='/x', to={`/x`}, href: '/x',
 * to: '/x'. Captures the quote, the path characters, and what follows them.
 */
const LINK = /\b(?:to|href)\s*[=:]\s*\{?\s*(["'`])(\/[\w./-]*)(.{0,80})/g;

function findBareLinks(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split('\n')) {
    // Navigate / navigate() change the route inside the app: no request reaches the server.
    if (/<Navigate\b/.test(line)) continue;
    for (const match of line.matchAll(LINK)) {
      const [, quote = '', path = '', rest = ''] = match;
      const endsHere = rest.startsWith(quote) || /^(?:\?|#|\$\{)/.test(rest);
      // /blog/${slug} with nothing after the placeholder is a bare post URL.
      const barePost = path === '/blog/' && rest.startsWith('${') && rest.replace(/^\$\{[^}]*\}/, '').startsWith(quote);
      if ((PAGES.has(path) && endsHere) || barePost) found.push(path + rest);
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

describe('internal links use the canonical trailing-slash form (F-F-12)', () => {
  it('finds a bare link, and only a bare link (the scan itself works)', () => {
    const bare = [
      '<Link to="/pricing">',
      "<a href='/methodology'>",
      "{ label: 'Demo', href: '/demo', variant: 'primary' }",
      "{ label: 'Terms', to: '/terms' }",
      '<Link to={`/blog/${post.slug}`}>',
      '<Link to="/contact?topic=sales">',
      "<Link to={`/signup${query ? '?' + query : ''}`}>",
    ];
    for (const line of bare) expect(findBareLinks(line), line).toHaveLength(1);

    const fine = [
      '<Link to="/pricing/">',
      '<Link to="/contact/?topic=sales">',
      "{ label: 'Demo', href: '/demo/' }",
      '<Link to={`/blog/${post.slug}/`}>',
      "<Link to={`/signup/${query ? '?' + query : ''}`}>",
      '<a href="/#features">',
      '<a href="/sample-report/pacific-freight-fy2026.pdf">',
      '<Link to="/app/intake">',
      '<a href="https://example.com/pricing">',
      '<a href="mailto:hello@developer312.com">',
      '<Navigate to={`/login?redirect=${target}`} replace />',
    ];
    for (const line of fine) expect(findBareLinks(line), line).toHaveLength(0);
  });

  it('finds the pages it checks', () => {
    expect(PAGES.has('/pricing')).toBe(true);
    expect(PAGES.has('/blog')).toBe(true);
    expect(sourceFiles(resolve('src')).length).toBeGreaterThan(50);
  });

  it('leaves no bare internal link in src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve('src'))) {
      const name = relative(resolve('.'), file).split('\\').join('/');
      if (KNOWN_EXCEPTIONS.has(name)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const target of findBareLinks(line)) offenders.push(`${name}:${index + 1}  ${target}`);
      });
    }
    expect(offenders, `write these with a trailing slash (e.g. "/pricing/"):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps every known exception honest: the file still has the bare link it is excused for', () => {
    for (const name of KNOWN_EXCEPTIONS) {
      const stillBare = findBareLinks(readFileSync(resolve(name), 'utf8')).length > 0;
      expect(stillBare, `${name} has no bare link any more: remove it from KNOWN_EXCEPTIONS`).toBe(true);
    }
  });
});
