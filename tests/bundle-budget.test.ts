// F-F-14: the eager JavaScript of the landing page. Every marketing page used to
// ship and execute the whole public app (legal pages, sign-in forms, blog, ...):
// 204 kB gzipped before the split (measured with `vite build` at 1374329 + wave 1).
// The eager set is what static/index.html loads without a click: its module script
// plus its modulepreload links.
//
// Skipped without build output (npm run build): it measures static/, which tests
// never produce themselves. CI builds before it tests.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const STATIC = resolve('static');
const built = existsSync(join(STATIC, 'index.html')) && existsSync(join(STATIC, 'assets'));

// The audit's bar for the landing page's initial JS (v1 budget, lane F finding F-F-14).
const BUDGET_GZIP_BYTES = 170_000;

function eagerScripts(): string[] {
  const html = readFileSync(join(STATIC, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? '');
  const preloads = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? '');
  return [...new Set([...scripts, ...preloads])];
}

const gzipBytes = (file: string) => gzipSync(readFileSync(join(STATIC, file)), { level: 9 }).length;

describe.skipIf(!built)('the landing page\'s eager JavaScript (F-F-14)', () => {
  it('stays inside the budget', () => {
    const files = eagerScripts();
    expect(files.length).toBeGreaterThan(1);
    const total = files.reduce((sum, file) => sum + gzipBytes(file), 0);
    expect(total, `${files.join(', ')} = ${total} B gzip`).toBeLessThanOrEqual(BUDGET_GZIP_BYTES);
  });

  it('does not preload the authenticated app or the charting library', () => {
    for (const file of eagerScripts()) expect(file).not.toMatch(/recharts|CartesianChart|carbon-calculator|Dashboard|DataIntake|Settings/);
  });

  it('loads each lazy public page as its own chunk that the landing page does not preload', () => {
    const lazy = [...readFileSync(resolve('src/routePages.lazy.ts'), 'utf8').matchAll(/export const (\w+) = lazyRoute\(\(\) => import\('\.\/pages\/(\w+)'\)/g)].map((m) => m[2] ?? '');
    expect(lazy.length).toBeGreaterThan(10);
    const chunks = readdirSync(join(STATIC, 'assets')).filter((f) => f.endsWith('.js'));
    const eager = eagerScripts();
    for (const page of lazy) {
      const chunk = chunks.find((f) => f.startsWith(`${page}-`));
      expect(chunk, `a chunk for ${page}`).toBeDefined();
      expect(eager, page).not.toContain(`/assets/${chunk}`);
    }
  });
});
