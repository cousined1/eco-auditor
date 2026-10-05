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
import { parseRobots, robotsGroup, isDisallowed } from '../scripts/robots-groups.mjs';

const raw = readFileSync(resolve(__dirname, '..', 'public', 'robots.txt'), 'utf8');

const { groups, sitemaps } = parseRobots(raw);
const wildcard = groups.find((g) => g.agents.includes('*'));

/** Rule strings, kept in the `field:value` form the assertions below read well. */
const rulesOf = (g: { allows: string[]; disallows: string[] } | undefined): string[] =>
  !g ? [] : [...g.allows.map((v) => `allow:${v}`), ...g.disallows.map((v) => `disallow:${v}`)];

describe('robots.txt protects the auth-only surfaces from the wildcard agent', () => {
  it('parses at least one group and finds the wildcard', () => {
    expect(groups.length).toBeGreaterThan(1);
    expect(wildcard, 'no User-agent: * group found').toBeDefined();
  });

  it('disallows /app/ for the wildcard group, not only for a named bot', () => {
    expect(rulesOf(wildcard)).toContain('disallow:/app/');
    expect(rulesOf(wildcard)).toContain('disallow:/auth/');
  });

  it('disallows the credential surfaces for the wildcard group', () => {
    for (const path of ['/login', '/signup', '/forgot-password']) {
      expect(rulesOf(wildcard), `${path} is crawlable by Googlebot`).toContain(`disallow:${path}`);
    }
  });

  it('keeps public marketing surfaces crawlable', () => {
    expect(rulesOf(wildcard)).toContain('allow:/');
    for (const path of ['/llms.txt', '/methodology', '/pricing', '/blog/']) {
      expect(rulesOf(wildcard), `${path} should stay crawlable`).toContain(`allow:${path}`);
    }
  });

  it('still gives each named AI agent its own group with the auth disallows', () => {
    for (const agent of ['gptbot', 'claudebot', 'perplexitybot', 'google-extended', 'applebot-extended']) {
      const group = groups.find((g) => g.agents.includes(agent));
      expect(group, `missing group for ${agent}`).toBeDefined();
      expect(rulesOf(group)).toContain('disallow:/app/');
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

    expect(rulesOf(oldWildcard)).toEqual(['allow:/']);
    expect(rulesOf(oldWildcard)).not.toContain('disallow:/app/');
    // A substring check would have passed on that file, which is why this
    // parses groups instead.
    expect(previous).toContain('Disallow: /app/');
  });
});

/**
 * The parser is shared with the runtime smoke gate (scripts/smoke.mjs), so its
 * own edge cases are pinned here. Two of these are regressions against real
 * failures during the 2026-10-05 audit, not hypotheticals.
 */
describe('parseRobots (shared with scripts/smoke.mjs)', () => {
  it('ignores directives mentioned inside comments', () => {
    // This is the exact trap the smoke gate fell into. public/robots.txt opens
    // with a comment explaining group semantics, and that comment contains the
    // literal `User-agent:`. A parser that splits on the raw string reads the
    // comment as the first group and finds no directives in it — which is why
    // a correct file reported five failures.
    const body = [
      '# Directives after a `User-agent:` line belong to THAT group.',
      '',
      'User-agent: *',
      'Disallow: /app/',
    ].join('\n');

    const group = robotsGroup(body, '*');
    expect(group).not.toBeNull();
    expect(group!.disallows).toEqual(['/app/']);
  });

  it('treats consecutive User-agent lines as one group, not two', () => {
    const body = ['User-agent: GPTBot', 'User-agent: ClaudeBot', 'Disallow: /app/'].join('\n');
    const { groups } = parseRobots(body);

    expect(groups).toHaveLength(1);
    expect(groups[0].agents).toEqual(['gptbot', 'claudebot']);
    expect(isDisallowed(body, 'ClaudeBot', '/app/')).toBe(true);
  });

  it('does not carry rules across a group boundary', () => {
    const body = ['User-agent: *', 'Disallow: /app/', 'User-agent: GPTBot', 'Allow: /'].join('\n');

    expect(isDisallowed(body, '*', '/app/')).toBe(true);
    // The wildcard's disallow must not leak into the GPTBot group.
    expect(isDisallowed(body, 'GPTBot', '/app/')).toBe(false);
  });

  it('reports a missing group as not disallowed rather than throwing', () => {
    const body = ['User-agent: GPTBot', 'Disallow: /app/'].join('\n');

    expect(robotsGroup(body, '*')).toBeNull();
    expect(isDisallowed(body, '*', '/app/')).toBe(false);
  });

  it('is not fooled by the shipped file: wildcard blocks the auth surfaces', () => {
    for (const p of ['/app/', '/auth/', '/login', '/signup', '/forgot-password']) {
      expect(isDisallowed(raw, '*', p), `${p} is crawlable by Googlebot`).toBe(true);
    }
  });
});