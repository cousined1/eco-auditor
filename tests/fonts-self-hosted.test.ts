// @vitest-environment node
/**
 * F-F-06: the site's fonts come from the site. A visitor's IP address and user
 * agent used to go to fonts.googleapis.com and fonts.gstatic.com on every page,
 * before any consent and through a render-blocking stylesheet. These tests fail
 * if a Google Fonts request comes back through index.html, the CSS, a script or
 * the CSP, or if a font the CSS points at is missing or is not a font.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const read = (path: string): string => readFileSync(resolve(path), 'utf8');
const GOOGLE_FONTS_HOST = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

// Every source file that can put a request on a page.
function sourceFiles(dir: string): string[] {
  return (readdirSync(resolve(dir), { recursive: true }) as string[])
    .filter((name) => /\.(ts|tsx|css|html|mjs)$/.test(name) && !/\.test\./.test(name))
    .map((name) => join(dir, name))
    .filter((path) => statSync(resolve(path)).isFile());
}

describe('no request to Google Fonts (F-F-06)', () => {
  it('index.html links no Google Fonts stylesheet and opens no connection to a Google font host', () => {
    const html = read('index.html');
    expect(html).not.toMatch(GOOGLE_FONTS_HOST);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/);
  });

  it('nothing in src/, scripts/ or public/ names a Google Fonts host', () => {
    const offenders = ['src', 'scripts', 'public']
      .flatMap(sourceFiles)
      .filter((path) => GOOGLE_FONTS_HOST.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('the Content-Security-Policy allows no Google Fonts host, so a reintroduced link would be blocked and reported', () => {
    const { buildSecurityHeaders } = require('../server-security.cjs') as {
      buildSecurityHeaders: (options?: { hsts?: boolean }) => Record<string, string>;
    };
    expect(buildSecurityHeaders({ hsts: true })['Content-Security-Policy']).not.toMatch(GOOGLE_FONTS_HOST);
  });
});

describe('the fonts are served from /fonts (F-F-06)', () => {
  const css = read('src/index.css');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1] ?? '');
  const hosted = faces.filter((face) => /url\('\/fonts\//.test(face));

  it('declares Inter and JetBrains Mono, every face with font-display: swap and a woff2 source', () => {
    const families = hosted.map((face) => /font-family:\s*'([^']+)'/.exec(face)?.[1]);
    expect(families).toEqual(expect.arrayContaining(['Inter', 'JetBrains Mono']));
    for (const face of hosted) {
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/format\('woff2'\)/);
      expect(face).toMatch(/unicode-range:/);
    }
  });

  it('every file the CSS points at exists and is a real woff2 font', () => {
    const files = [...css.matchAll(/url\('(\/fonts\/[^']+\.woff2)'\)/g)].map((match) => match[1] ?? '');
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const path = resolve(`public${file}`);
      expect(existsSync(path), `${file} is missing from public/fonts`).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString('latin1'), `${file} is not a woff2 file`).toBe('wOF2');
      expect(bytes.length).toBeGreaterThan(10_000);
    }
  });

  it('preloads the one face every page needs, and that file is declared in the CSS', () => {
    const html = read('index.html');
    const preload = /<link rel="preload" href="(\/fonts\/[^"]+\.woff2)" as="font" type="font\/woff2" crossorigin \/>/.exec(html);
    expect(preload, 'index.html has no font preload').not.toBeNull();
    expect(css).toContain(`url('${preload?.[1]}')`);
    expect(existsSync(resolve(`public${preload?.[1]}`))).toBe(true);
  });

  it('ships the licence text of both families beside the files (SIL Open Font License 1.1)', () => {
    for (const file of ['public/fonts/OFL-Inter.txt', 'public/fonts/OFL-JetBrainsMono.txt']) {
      const text = read(file);
      expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
      expect(text).toMatch(/^Copyright/);
    }
  });

  it('font file names carry the font version, because the server caches them as immutable', () => {
    for (const name of readdirSync(resolve('public/fonts')).filter((file) => file.endsWith('.woff2'))) {
      expect(name).toMatch(/-v\d+-/);
    }
  });
});
