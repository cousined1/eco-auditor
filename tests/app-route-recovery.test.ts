// F-B-19 structure guard. chunk-recovery.test.ts and error-boundary.test.tsx prove the
// behaviour; this keeps App.tsx wired to it, so the next page someone adds cannot quietly
// reintroduce "one failed chunk replaces the whole app".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');

describe('App.tsx route wiring (F-B-19)', () => {
  it('declares every lazily loaded page through lazyRoute, never a bare React.lazy', () => {
    expect(source).not.toMatch(/(^|[^A-Za-z.])lazy\(/m);

    const dynamicImports = source.match(/\bimport\(/g) ?? [];
    const recovered = source.match(/lazyRoute\(\s*\(\)\s*=>\s*import\(/g) ?? [];
    expect(dynamicImports.length).toBeGreaterThan(0);
    expect(recovered).toHaveLength(dynamicImports.length);
  });

  it('gives each lazy page its own chunk name, since the reload-once guard is per chunk', () => {
    const names = [...source.matchAll(/lazyRoute\(\s*\(\)\s*=>\s*import\([^)]*\),\s*'([^']+)'\)/g)].map((match) => match[1]);

    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it('contains a failing /app page inside the shell: an in-shell boundary that retries on navigation', () => {
    const boundary = source.match(/<ErrorBoundary\s+inShell[^>]*>[\s\S]*?<\/ErrorBoundary>/);

    expect(boundary).not.toBeNull();
    expect(boundary?.[0]).toMatch(/resetKey=\{locationInfo\.key\}/);
    expect(boundary?.[0]).toMatch(/onReset=\{retryChunkLoads\}/);
    // Every authenticated page renders inside it, so none can take the sidebar down with it.
    for (const route of ['/app', '/app/intake', '/app/calculator', '/app/settings']) {
      expect(boundary?.[0]).toContain(`path="${route}"`);
    }
  });

  it('keeps the whole-app boundary as the last resort for everything else', () => {
    expect(source).toMatch(/export default function App\(\)[\s\S]*?<ErrorBoundary>/);
  });
});
