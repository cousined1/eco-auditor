// @vitest-environment node
// /login, /signup and /forgot-password are prerendered by scripts/prerender.mjs
// through src/entry-server.tsx (renderToString in Node, no window). Their
// render path must not touch browser globals: Login now resolves its
// post-sign-in destination through a shared helper and reads router state
// for its notices, both during render. A ReferenceError here breaks the build.
import { describe, expect, it } from 'vitest';
import { render } from '../src/entry-server';

describe('auth pages still prerender without browser globals', () => {
  it.each(['/login', '/signup', '/forgot-password'])('%s', (url) => {
    expect(typeof window).toBe('undefined');
    const html = render(url);
    expect(html).toContain('<form');
    expect(html).not.toMatch(/click the link/i);
  });
});
