/**
 * SEO-04: robots.txt group semantics.
 *
 * Directives after a `User-agent:` line belong to THAT group, and the group ends
 * at the next `User-agent:` line. The auth-only disallows used to sit at the
 * bottom of public/robots.txt, after the Applebot-Extended block, so they
 * attached to Applebot alone. `User-agent: *` carried nothing but `Allow: /`.
 *
 * Googlebot matches the wildcard group, so it was explicitly permitted to crawl
 * /app/, /login, /signup and /forgot-password — the exact surfaces the file
 * claimed to protect. Verified against the live file on 2026-10-05.
 *
 * A naive substring check would have passed on the old file ("/app/" is present),
 * so this parses the file the way a crawler does.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = readFileSync(resolve(__dirname, '..', 'public', 'robots.txt'), 'utf8');

/**
 * Minimal RFC 9309 group parser: consecutive `User-agent:` lines open a group
 * (a group may list several agents); any other directive belongs to the group
 * currently open; `Sitemap:` is not a group directive.
 */
type Group = { agents: string[]; rules: string[] };

function parseRobots(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let expectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (current && !expectingAgents) {
        current = null;
      }
      if (!current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgents = true;
      continue;
    }
    if (field === 'allow' || field === 'disallow') {
      if (current) current.rules.push(`${field}:${value}`);
      expectingAgents = false;
    }
  }
  return { groups, sitemaps };
}

const { groups, sitemaps } = parseRobots(raw);
const wildcard = groups.find((g) => g.agents.includes('*'));

describe('robots.txt protects the auth-only surfaces from the wildcard agent', () => {
  it('parses at least one group and finds the wildcard', () => {
    expect(groups.length).toBeGreaterThan(1);
    expect(wildcard, 'no User-agent: * group found').toBeDefined();
  });

  it('disallows /app/ for the wildcard group, not only for a named bot', () => {
    expect(wildcard!.rules).toContain('disallow:/app/');
    expect(wildcard!.rules).toContain('disallow:/auth/');
  });

  it('disallows the credential surfaces for the wildcard group', () => {
    for (const path of ['/login', '/signup', '/forgot-password']) {
      expect(wildcard!.rules, `${path} is crawlable by Googlebot`).toContain(`disallow:${path}`);
    }
  });

  it('keeps public marketing surfaces crawlable', () => {
    expect(wildcard!.rules).toContain('allow:/');
    for (const path of ['/llms.txt', '/methodology', '/pricing', '/blog/']) {
      expect(wildcard!.rules, `${path} should stay crawlable`).toContain(`allow:${path}`);
    }
  });

  it('still gives each named AI agent its own group with the auth disallows', () => {
    for (const agent of ['gptbot', 'claudebot', 'perplexitybot', 'google-extended', 'applebot-extended']) {
      const group = groups.find((g) => g.agents.includes(agent));
      expect(group, `missing group for ${agent}`).toBeDefined();
      expect(group!.rules).toContain('disallow:/app/');
    }
  });

  it('declares the sitemap exactly once', () => {
    expect(sitemaps).toEqual(['https://ecoauditor.io/sitemap.xml']);
  });

  it('is LF with no BOM', () => {
    expect(raw.includes('\r\n')).toBe(false);
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('would have caught the previous file (proves the parser is not vacuous)', () => {
    // The exact wildcard group from the live file before the fix. The
    // disallows existed in the text, but after the Applebot-Extended block, so
    // this group had none of them.
    const previous = [
      'User-agent: *',
      'Allow: /',
      '',
      'User-agent: GPTBot',
      'Allow: /',
      'Disallow: /app/',
      '',
      '# Disallow auth-only app paths',
      'Disallow: /app/',
      'Disallow: /login',
    ].join('\n');
    const oldWildcard = parseRobots(previous).groups.find((g) => g.agents.includes('*'));

    expect(oldWildcard!.rules).toEqual(['allow:/']);
    expect(oldWildcard!.rules).not.toContain('disallow:/app/');
    // A substring check would have passed on that file, which is why this
    // parses groups instead.
    expect(previous).toContain('Disallow: /app/');
  });
});