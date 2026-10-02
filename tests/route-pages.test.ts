// F-F-14: the public pages live in two twin modules. src/routePages.ts imports them
// statically (prerender, tests, dev); src/routePages.lazy.ts loads most of them as
// route-level chunks, and vite.config.ts swaps it in for `vite build`. These tests
// keep the twins in step and keep App.tsx from importing a page around them.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const exportsOf = (source: string) => [...source.matchAll(/^export (?:\{ default as (\w+) \}|const (\w+) =)/gm)].map((m) => m[1] ?? m[2] ?? '').sort();

const eager = read('src/routePages.ts');
const lazy = read('src/routePages.lazy.ts');

describe('the public-page route table (src/routePages)', () => {
  it('exports the same pages from both twins', () => {
    const names = exportsOf(eager);
    expect(names.length).toBeGreaterThan(10);
    expect(exportsOf(lazy)).toEqual(names);
  });

  it('points each lazy page at the same file the static twin imports', () => {
    for (const match of lazy.matchAll(/export const (\w+) = lazyRoute\(\(\) => import\('(\.\/pages\/\w+)'\), '(\w+)'\);/g)) {
      const [, name = '', file = ''] = match;
      expect(eager, name).toContain(`export { default as ${name} } from '${file}';`);
    }
  });

  it('loads every lazy page through lazyRoute, so chunk-load recovery applies to it', () => {
    expect(lazy).not.toMatch(/\blazy\(/);
    const dynamicImports = lazy.match(/import\('\.\/pages\//g) ?? [];
    const recovered = lazy.match(/= lazyRoute\(\(\) => import\('\.\/pages\//g) ?? [];
    expect(dynamicImports.length).toBeGreaterThan(10);
    expect(recovered).toHaveLength(dynamicImports.length);
  });

  it('keeps the landing page, pricing and the 404 page eager, and nothing else', () => {
    const staticInLazy = [...lazy.matchAll(/^export \{ default as (\w+) \}/gm)].map((m) => m[1]).sort();
    expect(staticInLazy).toEqual(['LandingPage', 'NotFound', 'Pricing']);
  });

  it('is what App.tsx renders: no public page is imported around it', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("from '@/routePages';");
    const pageImports = [...app.matchAll(/^import \w+ from '\.\/pages\/(\w+)';/gm)].map((m) => m[1]);
    expect(pageImports).toEqual([]);
  });

  it('is swapped for the lazy twin only in `vite build`, ahead of the "@" alias', () => {
    const config = read('vite.config.ts');
    expect(config).toContain("command === 'build'");
    const swap = config.indexOf("find: '@/routePages'");
    const generic = config.indexOf("find: '@',");
    expect(swap).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(swap);
    expect(config).toContain("'./src/routePages.lazy.ts'");
  });
});
