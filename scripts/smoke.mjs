#!/usr/bin/env node
/**
 * Boot-and-sweep smoke gate.
 *
 * Three defects shipped during the 2026-10-05 audit that NO source-level test
 * could see, because all three are properties of the running process rather
 * than of the code text:
 *
 *   - SEO-03: the dynamic /sitemap.xml was registered after express.static and
 *     was silently shadowed by the mirrored static/sitemap.xml.
 *   - SEO-04: robots.txt put the auth-only Disallow lines after the last
 *     User-agent group, so Googlebot's wildcard group had none of them.
 *   - CRLF: a rewrite re-joined server.cjs with CRLF, which silently broke the
 *     regression tests that slice it on a literal "\n".
 *
 * Registration order, config-file group scoping, and file encoding are only
 * observable by starting the server and looking at what it returns. This turns
 * that into a repeatable gate so the next instance is caught before release
 * rather than during an audit.
 *
 * Requires a completed `npm run build` (it reads the generated static/).
 * Runs with no database: InsForge and DATABASE_URL are unset, so protected
 * endpoints answer 503, which is the correct fail-closed behaviour and exactly
 * what the auth assertions check for.
 *
 * Usage: node scripts/smoke.mjs [--port <n>] [--timeout <ms>]
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { robotsGroup } from './robots-groups.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BOOT_TIMEOUT_MS = Number(argValue('--timeout', '30000'));

/**
 * The public origin server.cjs is expected to build absolute URLs from. It is
 * injected into the child rather than inherited, so the sweep is deterministic:
 * without APP_URL the server falls back to http://localhost:3000 and the sitemap
 * emits <loc>http://localhost:3000/</loc> — correct behaviour for a missing var,
 * useless as a check. Set APP_URL_CANONICAL to sweep against a different origin.
 */
const CANONICAL_ORIGIN = (argValue('--origin', 'https://ecoauditor.io') || '').replace(/\/+$/, '');

const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * server.cjs does `const PORT = process.env.PORT` and hands it straight to
 * listen(), so PORT=0 becomes the named pipe "0" rather than an ephemeral TCP
 * port. Ask the OS for a free port instead.
 */
function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function get(path, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: options.followRedirects ? 'follow' : 'manual',
    ...options.init,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/** Marketing pages must each render their own content and self-canonical. */
const MARKETING_PAGES = [
  '/', '/pricing/', '/methodology/', '/sample-report/', '/security/',
  '/demo/', '/contact/', '/privacy/', '/terms/', '/dpa/', '/blog/',
];
/** Auth pages are noindex and must carry no canonical. */
const NOINDEX_PAGES = ['/login/', '/signup/', '/forgot-password/'];
/** Must never 5xx, including junk paths. */
const ROBUSTNESS_PATHS = [
  '/nonexistent-page-xyz', '/app', '/app/calculator', '/app/intake',
  '/sitemap.xml', '/robots.txt', '/manifest.webmanifest',
];

let port = 0;

async function boot() {
  const chosen = await findFreePort();
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(chosen), NODE_ENV: 'development', APP_URL: CANONICAL_ORIGIN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  port = chosen;
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode})\n${stderr.slice(-800)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200 || res.status === 503) return child;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error(`server did not become ready within ${BOOT_TIMEOUT_MS}ms\n${stderr.slice(-800)}`);
}

async function run() {
  console.log('Smoke sweep — booting server.cjs…');
  if (!existsSync(join(root, 'static', 'index.html'))) {
    console.error('static/index.html missing. Run `npm run build` first.');
    process.exit(1);
  }

  const child = await boot();
  console.log(`Server listening on 127.0.0.1:${port}\n`);

  try {
    console.log('Marketing pages: content, title and canonical');
    const titles = new Map();
    for (const route of MARKETING_PAGES) {
      const { status, text } = await get(route);
      const title = (text.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
      const canonical = (text.match(/rel="canonical" href="([^"]*)"/) || [])[1] || '';
      const visible = text
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      check(`${route} returns 200`, status === 200, `got ${status}`);
      check(
        `${route} has its own title`,
        Boolean(title) && !titles.has(title),
        titles.has(title) ? `duplicate of ${titles.get(title)}` : title.slice(0, 60),
      );
      titles.set(title, route);
      check(
        `${route} self-canonicalises`,
        canonical === `https://ecoauditor.io${route}`,
        `got "${canonical}"`,
      );
      // A prerender regression would leave an app shell: real pages carry text.
      check(`${route} prerendered with content`, visible.length > 800, `${visible.length} visible chars`);
    }

    console.log('\nNoindex pages');
    for (const route of NOINDEX_PAGES) {
      const { status, text } = await get(route);
      check(`${route} returns 200`, status === 200, `got ${status}`);
      check(
        `${route} carries no canonical`,
        !/rel="canonical"/.test(text),
        'a noindex page must not also self-canonicalise',
      );
    }

    console.log('\nSitemap (SEO-03 regression: must not be the shadowed static file)');
    const sitemap = await get('/sitemap.xml');
    check('/sitemap.xml is XML', /application\/xml/.test(sitemap.headers.get('content-type') || ''));
    check('/sitemap.xml parses as a urlset', sitemap.text.includes('<urlset'));
    check('/sitemap.xml lists the marketing root', sitemap.text.includes(`<loc>${CANONICAL_ORIGIN}/</loc>`),
      `expected <loc>${CANONICAL_ORIGIN}/</loc>; got ${(sitemap.text.match(/<loc>[^<]*<\/loc>/) || ['no <loc> at all'])[0]}`,
    );
    check(
      '/sitemap.xml advertises no localhost origin',
      !sitemap.text.includes('localhost'),
      'a <loc> points at localhost — APP_URL is unset, so every URL in the sitemap is unreachable for crawlers',
    );
    check(
      '/sitemap.xml never advertises auth-only routes',
      !/\/app\/|\/auth\/|\/login|\/signup/.test(sitemap.text.replace(/<lastmod>[\s\S]*?<\/lastmod>/g, '')),
    );
    const staticMirror = readFileSync(join(root, 'static', 'sitemap.xml'), 'utf8');
    check(
      '/sitemap.xml is served by the dynamic route, not the static mirror',
      sitemap.text !== staticMirror,
      'response is byte-identical to static/sitemap.xml — the dynamic route is shadowed',
    );

    console.log('\nrobots.txt (SEO-04 regression: wildcard group scoping)');
    const robots = await get('/robots.txt');
    check('/robots.txt returns 200', robots.status === 200, `got ${robots.status}`);
    const wildcardGroup = robotsGroup(robots.text, '*');
    check(
      'robots.txt declares a User-agent: * group',
      wildcardGroup !== null,
      'no wildcard group — Googlebot matches nothing and gets no directives at all',
    );
    for (const path of ['/app/', '/auth/', '/login', '/signup', '/forgot-password']) {
      check(
        `robots.txt disallows ${path} for User-agent: *`,
        Boolean(wildcardGroup) && wildcardGroup.disallows.includes(path),
        'the wildcard group is what Googlebot matches',
      );
    }
    check('robots.txt declares the sitemap', /^Sitemap:\s*https:\/\/ecoauditor\.io\/sitemap\.xml$/m.test(robots.text));

    console.log('\nRobustness');
    for (const route of ROBUSTNESS_PATHS) {
      const { status } = await get(route);
      check(`${route} does not 5xx`, status < 500, `got ${status}`);
    }
    for (const slug of ["' OR 1=1--", '../../etc/passwd', '%00', '<script>', 'a/b/c', 'UPPER-Case']) {
      const { status } = await get(`/blog/${encodeURIComponent(slug)}`);
      check(`blog slug ${JSON.stringify(slug).slice(0, 24)} does not 5xx`, status < 500, `got ${status}`);
    }
    const unknownApi = await get('/api/definitely-not-a-route');
    check('unknown /api returns JSON, not the HTML shell', /json/.test(unknownApi.headers.get('content-type') || ''));

    console.log('\nAuth fails closed (no session, no database)');
    for (const route of [
      '/api/account/export', '/api/emissions/summary', '/api/emissions/trend',
      '/api/companies/1/facilities', '/api/facilities/1/emissions',
      '/api/companies/1/compliance', '/api/companies/1/reports',
    ]) {
      const { status } = await get(route);
      check(`${route} refuses unauthenticated`, status >= 400, `got ${status}`);
    }

    // ENT-01: with no database, the entitlement endpoints used to answer 200
    // with an invented subscription — /api/billing said
    // { active: true, plan: 'starter', status: 'trialing' } and /api/trial-status
    // said { trial: true }. Settings renders the first directly, so a paying
    // customer was told they were on a free trial.
    //
    // Here authGuard answers first (no InsForge configured), so this cannot
    // reach the no-pool branch. That is fine and is the point: the assertion is
    // that NO reachable configuration produces a 200 carrying entitlement. If
    // someone ever reorders the guards so the no-pool branch runs, this fires.
    console.log('\nEntitlement is never fabricated (no database)');
    for (const route of ['/api/billing', '/api/trial-status']) {
      const { status, text } = await get(route);
      check(`${route} does not answer 200 without a database`, status !== 200, `got ${status}`);
      check(
        `${route} invents no entitlement`,
        !/"(active|trial)"\s*:\s*true/.test(text) && !/"plan"\s*:\s*"starter"/.test(text),
        text.slice(0, 120),
      );
    }
    for (const route of ['/api/checkout', '/api/ingest/csv', '/api/companies/1/facilities', '/api/account/delete-data']) {
      const { status } = await get(route, { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } });
      check(`POST ${route} refuses unauthenticated`, status >= 400, `got ${status}`);
    }

    console.log('\nSecurity headers');
    const home = await get('/');
    for (const [header, expected] of [
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
      ['content-security-policy', /default-src 'self'/],
    ]) {
      const value = home.headers.get(header) || '';
      check(`${header} is set`, expected instanceof RegExp ? expected.test(value) : value === expected, value.slice(0, 48));
    }
    check('Content-Security-Policy present on /sitemap.xml too', Boolean((await get('/sitemap.xml')).headers.get('content-security-policy')));
  } finally {
    child.kill();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (failures > 0) {
    console.error(`\n${failures} smoke check(s) FAILED:`);
    for (const r of results.filter((x) => !x.ok)) console.error(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
    process.exit(1);
  }
  console.log('Smoke sweep passed.');
}

run().catch((err) => {
  console.error('smoke sweep failed to run:', err.message);
  process.exit(1);
});