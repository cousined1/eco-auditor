// F-F-13: the auth-only Disallow rules used to sit after the Sitemap line, where
// RFC 9309 makes them part of the group above (Applebot-Extended), so Googlebot and
// Bingbot (the "*" group) were free to crawl /app/, /auth/, /login and /signup.
// This evaluates public/robots.txt the way a crawler does: a crawler obeys the ONE
// group that names it, and only falls back to "*" when none does.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- importing a Node ESM .mjs module with no type declarations
import { NOINDEX_ROUTES, ROUTES, sitemapPaths } from '../scripts/prerender-head.mjs';

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

function parse(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const at = line.indexOf(':');
    if (at === -1) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === 'sitemap') sitemaps.push(value);
    else if (field === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (field === 'allow' || field === 'disallow') {
      collectingAgents = false;
      // A rule before any user-agent line binds to nobody.
      current?.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return { groups, sitemaps };
}

const toPattern = (path: string) => new RegExp('^' + path.replace(/[.+?^${}()|[\]\\]/g, (c) => '\\' + c).replace(/\*/g, '.*').replace(/\\\$$/, '$'));

function isAllowed(groups: Group[], agent: string, path: string): boolean {
  const name = agent.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(name));
  const applicable = named.length > 0 ? named : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (rule.path === '' || !toPattern(rule.path).test(path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

const { groups, sitemaps } = parse(readFileSync(resolve('public/robots.txt'), 'utf8'));
const AGENTS = ['*', 'Googlebot', 'Bingbot', 'DuckDuckBot', 'GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];
const AUTH_ONLY = ['/app/', '/app/dashboard', '/app/intake', '/auth/', '/auth/callback', '/auth/verify-email', '/login', '/signup', '/forgot-password'];
const PUBLIC = ['/', '/pricing/', '/methodology/', '/sample-report/', '/security/', '/demo/', '/contact/', '/privacy/', '/terms/', '/dpa/', '/blog/', '/blog/a-post/', '/llms.txt', '/sitemap.xml'];

describe('robots.txt', () => {
  it.each(AGENTS)('%s is kept out of the auth-only paths', (agent) => {
    for (const path of AUTH_ONLY) expect(isAllowed(groups, agent, path), `${agent} ${path}`).toBe(false);
  });

  it.each(AGENTS)('%s may crawl every public page, the blog and llms.txt', (agent) => {
    for (const path of PUBLIC) expect(isAllowed(groups, agent, path), `${agent} ${path}`).toBe(true);
  });

  it('repeats the same Disallow list in every group (RFC 9309 groups do not inherit from "*")', () => {
    const disallowed = (g: Group) => g.rules.filter((r) => !r.allow).map((r) => r.path).sort();
    const star = groups.find((g) => g.agents.includes('*'));
    expect(star, 'a "*" group').toBeDefined();
    expect(disallowed(star as Group).length).toBeGreaterThan(0);
    for (const group of groups) expect(disallowed(group), group.agents.join(',')).toEqual(disallowed(star as Group));
  });

  it('has no rule outside a group: nothing after the Sitemap line quietly binds to the last agent', () => {
    const text = readFileSync(resolve('public/robots.txt'), 'utf8');
    const afterSitemap = text.slice(text.lastIndexOf('Sitemap:'));
    expect(afterSitemap.match(/^\s*(?:allow|disallow)\s*:/gim)).toBeNull();
  });

  it('never disallows an indexable route, and names the generated sitemap once', () => {
    const indexable = (ROUTES as string[]).filter((r) => !(NOINDEX_ROUTES as Set<string>).has(r));
    for (const path of sitemapPaths() as string[]) expect(isAllowed(groups, '*', path), path).toBe(true);
    expect(indexable.length).toBeGreaterThan(5);
    expect(sitemaps).toEqual(['https://ecoauditor.io/sitemap.xml']);
  });
});
