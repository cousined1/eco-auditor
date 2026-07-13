import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// P0-01 + AF-4 — asserts the PRERENDERED OUTPUT on disk (what crawlers see).
// The vitest config include glob matches `.test.{ts,tsx,js}` (not `.spec.ts`),
// so this file uses `.test.ts` to actually run. ponytail: spec named it
// `.spec.ts` but the config gates on `.test.*`.
const ROOT = path.resolve(__dirname, '..');
const STATIC = path.join(ROOT, 'static');

function readStatic(route: string): string {
  const file = path.join(STATIC, route, 'index.html');
  if (!existsSync(file)) throw new Error(`missing prerendered file: ${file}`);
  return readFileSync(file, 'utf8');
}

function countOccurrences(haystack: string, needle: string): number {
  // ponytail: case-insensitive substring count without regex escaping pitfalls.
  const lower = haystack.toLowerCase();
  const target = needle.toLowerCase();
  let count = 0;
  let idx = lower.indexOf(target);
  while (idx !== -1) {
    count++;
    idx = lower.indexOf(target, idx + target.length);
  }
  return count;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : null;
}

describe('P0-01 + AF-4 — prerendered route output on disk', () => {
  it('static/login/index.html and static/signup/index.html exist', () => {
    expect(existsSync(path.join(STATIC, 'login', 'index.html'))).toBe(true);
    expect(existsSync(path.join(STATIC, 'signup', 'index.html'))).toBe(true);
  });

  it('each auth route has exactly one <title> (AF-4 per-route meta)', () => {
    const login = readStatic('login');
    const signup = readStatic('signup');
    expect((login.match(/<title>/g) || []).length).toBe(1);
    expect((signup.match(/<title>/g) || []).length).toBe(1);
  });

  it('auth route titles differ from the homepage title (AF-4)', () => {
    const home = readStatic('.');
    const login = readStatic('login');
    const signup = readStatic('signup');
    const homeTitle = extractTitle(home);
    const loginTitle = extractTitle(login);
    const signupTitle = extractTitle(signup);
    expect(homeTitle).toBeTruthy();
    expect(loginTitle).not.toBe(homeTitle);
    expect(signupTitle).not.toBe(homeTitle);
    expect(loginTitle).not.toBe(signupTitle);
  });

  it('auth routes contain noindex,nofollow robots meta (P0-01)', () => {
    const login = readStatic('login');
    const signup = readStatic('signup');
    expect(login).toContain('noindex,nofollow');
    expect(signup).toContain('noindex,nofollow');
  });

  it('static/login/index.html does NOT contain "start your free trial" (P0-01 failable)', () => {
    // Spec P0-01: login is sign-in, not signup. The failable grep is
    // `grep -ci "start your free trial" static/login/index.html` = 0.
    const login = readStatic('login');
    expect(countOccurrences(login, 'start your free trial')).toBe(0);
  });

  it('static/signup/index.html contains a signup-appropriate title', () => {
    const signup = readStatic('signup');
    const title = extractTitle(signup);
    expect(title).toBeTruthy();
    // Signup page should signal trial/start, not sign-in.
    expect(title!.toLowerCase()).toMatch(/trial|sign.?up|free|start/);
  });

  it('marketing routes do NOT contain noindex (they are indexable)', () => {
    const home = readStatic('.');
    const pricing = readStatic('pricing');
    expect(home).not.toContain('noindex');
    expect(pricing).not.toContain('noindex');
  });

  it('robots.txt disallows /signup, /login, /auth/ and allows marketing routes', () => {
    const robots = readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
    expect(robots).toMatch(/Disallow:\s*\/signup/i);
    expect(robots).toMatch(/Disallow:\s*\/login/i);
    expect(robots).toMatch(/Disallow:\s*\/auth\//i);
    // Marketing routes must not be disallowed.
    expect(robots).not.toMatch(/Disallow:\s*\/pricing/i);
    expect(robots).not.toMatch(/Disallow:\s*\/methodology/i);
  });
});