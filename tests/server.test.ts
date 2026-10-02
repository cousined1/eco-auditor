/**
 * Server logic unit tests
 * Tests rate limiting, security headers, range validation, cache headers
 *
 * These tests import the actual server modules where possible instead of
 * reimplementing server logic in the test file (CodeRabbit audit finding).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildSecurityHeaders } from '../server-security.cjs';
import { resolvePlanPriceId } from '../server-billing.cjs';
import proxyaddr from 'proxy-addr';

const serverSource = readFileSync(resolve('server.cjs'), 'utf8');

// ─── Security Headers (tests actual server module) ───

describe('Security Headers (server-security.cjs)', () => {
  it('includes X-Content-Type-Options: nosniff', () => {
    const headers = buildSecurityHeaders({ hsts: false });
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('includes X-Frame-Options: DENY', () => {
    const headers = buildSecurityHeaders({ hsts: false });
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('includes Referrer-Policy', () => {
    const headers = buildSecurityHeaders({ hsts: false });
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('includes HSTS when hsts: true', () => {
    const headers = buildSecurityHeaders({ hsts: true });
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
  });

  it('omits HSTS when hsts: false', () => {
    const headers = buildSecurityHeaders({ hsts: false });
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('includes Permissions-Policy', () => {
    const headers = buildSecurityHeaders({ hsts: false });
    expect(headers['Permissions-Policy']).toBeDefined();
    expect(headers['Permissions-Policy']).toContain('camera=');
  });
});

// ─── Rate Limiter Logic (extracted pattern, not duplicated from server.cjs) ───
// Note: server.cjs inlines rate limiting in middleware. These tests validate
// the algorithmic correctness of the sliding-window approach.
// TODO: Extract rate limiter into a shared module for server + test reuse.

function createRateLimiter(windowMs: number, max: number) {
  const store = new Map<string, { windowStart: number; count: number }>();

  function check(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { windowStart: now, count: 1 });
      return { allowed: true };
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  }

  return { check, store };
}

describe('Rate Limiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createRateLimiter(60000, 120);
    const result = limiter.check('10.0.0.1');
    expect(result.allowed).toBe(true);
  });

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter(60000, 2);
    limiter.check('10.0.0.2');
    limiter.check('10.0.0.2');
    const result = limiter.check('10.0.0.2');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('tracks different IPs separately', () => {
    const limiter = createRateLimiter(60000, 2);
    limiter.check('10.0.0.10');
    limiter.check('10.0.0.10');
    const result = limiter.check('10.0.0.11');
    expect(result.allowed).toBe(true);
  });

  it('resets window after time passes', () => {
    const limiter = createRateLimiter(100, 2);
    limiter.check('10.0.0.20');
    limiter.check('10.0.0.20');
    expect(limiter.check('10.0.0.20').allowed).toBe(false);
    const entry = limiter.store.get('10.0.0.20')!;
    entry.windowStart = Date.now() - 200;
    expect(limiter.check('10.0.0.20').allowed).toBe(true);
  });
});

// ─── Range Header Validation ───
// RT-04: moved to tests/server-http-utils.test.ts, which imports the extracted
// parseRange/getStaticCacheHeaders module (server-http-utils.cjs) that
// server.cjs itself now uses.

// ─── Subscription & Billing Endpoints (integration-style) ───
// These verify that the server returns correct HTTP status codes
// for disallowed operations.

describe('Billing endpoint guards', () => {
  it('subscription PATCH rejects plans without a configured price', () => {
    // PATCH /api/subscription resolves planId+billing through
    // resolvePlanPriceId and returns 400 for unknown selections.
    expect(resolvePlanPriceId({}, 'growth', 'monthly')).toBeNull();
    expect(resolvePlanPriceId({}, 'not-a-plan', 'monthly')).toBeNull();
  });

  it('checkout rejects disallowed priceId (RT-09 — real gate, integration)', () => {
    // RT-09: the previous body built a test-local Set and asserted against it —
    // zero server code involved. The real ALLOWED_PRICE_IDS gate on
    // POST /api/checkout is now exercised end-to-end (400 for a priceId the
    // server never configured, 500-not-200 for a configured one) in
    // tests/audit-20260922-regressions.test.ts, describe "RT-09".
    const checkoutRoute = serverSource.slice(serverSource.indexOf("app.post('/api/checkout'"));
    expect(checkoutRoute.indexOf('ALLOWED_PRICE_IDS.has(priceId)')).toBeGreaterThan(-1);
    expect(checkoutRoute.indexOf('ALLOWED_PRICE_IDS.has(priceId)')).toBeLessThan(
      checkoutRoute.indexOf('ensureStripeCustomer')
    );
  });
});

describe('Railway runtime schema', () => {
  it('creates the consent audit table before accepting consent records', () => {
    expect(serverSource).toContain('CREATE TABLE IF NOT EXISTS public.consent_records');
    expect(serverSource.indexOf('CREATE TABLE IF NOT EXISTS public.consent_records'))
      .toBeLessThan(serverSource.indexOf('INSERT INTO public.consent_records'));
  });
});

describe('Postgres pool resilience', () => {
  it('handles idle client errors instead of crashing the process', () => {
    // pg-pool emits 'error' on the pool for idle client failures. Unhandled,
    // that reaches uncaughtException and exits the server on any DB blip.
    expect(serverSource).toContain("pgPool.on('error'");
  });
});

describe('Company auto-provisioning', () => {
  it('tolerates the concurrent first-load insert race', () => {
    // A new user's first dashboard load fires two requests at once; without the
    // conflict clause the loser violates companies_user_id_unique and the user
    // sees 503 'Billing status unavailable'.
    expect(serverSource).toContain('ON CONFLICT (user_id) DO NOTHING');
  });
});

describe('Trust proxy client IP resolution', () => {
  // Mirrors the trust function in server.cjs (see the `trust proxy` block).
  const RAILWAY_PRIVATE_HOP = /^(?:::ffff:)?100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./;
  const trust = (addr: string, hop: number) => hop === 0 || RAILWAY_PRIVATE_HOP.test(String(addr));

  const reqFrom = (xff?: string) => ({
    connection: { remoteAddress: '::ffff:100.100.1.1' },
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });

  it('is the function server.cjs actually installs', () => {
    // The proxy-addr checks below run against this local mirror, so pin the
    // mirror to the source or the test would still pass on `trust proxy: 1`.
    expect(serverSource).toContain("app.set('trust proxy', function (addr, hop)");
    expect(serverSource).toContain(RAILWAY_PRIVATE_HOP.source);
    expect(serverSource).toContain('return hop === 0 || RAILWAY_PRIVATE_HOP.test(String(addr));');
  });

  it('skips the Railway-internal hop so it never becomes the shared key', () => {
    expect(proxyaddr(reqFrom(), trust)).toBe('::ffff:100.100.1.1');
    expect(proxyaddr(reqFrom('203.0.113.9'), trust)).toBe('203.0.113.9');
    // The extra Railway-internal hop is skipped rather than becoming the key
    // every visitor shares, which would collapse all rate limiting onto one IP.
    expect(proxyaddr(reqFrom('203.0.113.9, 100.100.4.4'), trust)).toBe('203.0.113.9');
    // Unchanged from the previous fixed hop count of 1.
    expect(proxyaddr(reqFrom('203.0.113.9, 172.70.1.1'), trust)).toBe('172.70.1.1');
  });

  it('does not trust a client-supplied address in the Railway range', () => {
    // Only hops the proxy chain actually appended can be skipped; a forged
    // 100.64/10 entry beyond the trusted prefix must not extend trust.
    // NOTE: this pins Express req.ip behavior of the trust function itself.
    // req.ip is NO LONGER the rate-limit key — every limiter and the consent
    // ipHash key on resolveClientIp() (see the describe below), which never
    // consults attacker-controllable entries (SC-01/SC-02, 2026-09-17 audit).
    const spoofed = {
      connection: { remoteAddress: '::ffff:172.70.1.1' },
      headers: { 'x-forwarded-for': '1.2.3.4, 100.100.9.9' },
    };
    expect(proxyaddr(spoofed, trust)).toBe('1.2.3.4');
  });
});

describe('CSV ingest failure path', () => {
  // K4 moved the handler to server-csv-import-routes.cjs; server.cjs mounts it.
  const routes = readFileSync(resolve('server-csv-import-routes.cjs'), 'utf8');
  const handler = routes.slice(routes.indexOf('async function ingest('), routes.indexOf('async function list('));

  it('mounts the ingest handler on the route, behind the auth guard and the plan gate', () => {
    expect(serverSource).toMatch(/app\.post\('\/api\/ingest\/csv', express\.text\([^)]*\), apiAuthGuard, requirePlan\('starter'\), csvImportHandlers\.ingest\);/);
  });

  it('declares companyId before the try so the catch block can log it', () => {
    // A const inside the try made the catch's log() a ReferenceError, which
    // became an unhandled rejection and exited the process on any 5xx path.
    expect(handler.indexOf('let companyId')).toBeGreaterThan(-1);
    expect(handler.indexOf('let companyId')).toBeLessThan(handler.indexOf('try {'));
  });

  it('gates Scope 3 with the engine normaliser, not a drifting copy', () => {
    const gate = serverSource.slice(serverSource.indexOf('function normalizeScopeLabel'));
    expect(gate.slice(0, gate.indexOf('\n}'))).toContain('normalizeScope(value)');
  });

  it('rejects out-of-range confidence per row, naming the line, instead of failing the insert', async () => {
    const { validateCsvImport } = await import('../server-csv-import.cjs');
    const report = validateCsvImport(
      'scope,category,source,amount,unit,confidence\nScope 1,stationary_combustion,natural_gas,10,therms,150\nScope 1,stationary_combustion,natural_gas,10,therms,95\n',
      { now: new Date('2026-09-30T12:00:00Z') },
    );
    expect(report.errors).toEqual(['Line 2: confidence must be between 0 and 100.']);
    expect(report.rows.map((row: { line: number; entry: { confidence: number } }) => [row.line, row.entry.confidence])).toEqual([[3, 95]]);
  });
});

describe('SPA shell caching', () => {
  it('sends no-cache so a deploy cannot leave a stale shell behind', () => {
    // The fallback hands BOTH its answers (the shell for /app and /auth, the 404 for
    // any other URL) to server-pages.cjs (F-F-03, F-C-25), which sends every HTML
    // page it renders no-cache: a cached shell requests hashed assets that are
    // gone. Nothing in the fallback may answer on its own and skip that.
    // tests/blog-pages-server.test.ts asserts the headers over HTTP.
    const start = serverSource.indexOf("app.get('*'");
    const fallback = serverSource.slice(start, serverSource.indexOf('Terminal error handler', start));
    expect(fallback).toContain('pages.appShell(req, res)');
    expect(fallback).toContain('pages.notFound(req, res)');
    expect(fallback).not.toMatch(/res\.(send|sendFile|status|setHeader)\(/);
    expect(readFileSync(resolve('server-pages.cjs'), 'utf8')).toContain("const HTML_CACHE_CONTROL = 'no-cache, no-transform';");
  });
});

// ─── PERF-001: client IP resolution behind Cloudflare ───
// Evaluates the actual resolveClientIp source from server.cjs so the test
// cannot drift from the implementation (same pattern as csv-quota-transaction).
describe('resolveClientIp (PERF-001)', () => {
  const ipSource = serverSource.slice(
    serverSource.indexOf('const INTERNAL_PEER_PATTERN'),
    serverSource.indexOf("app.use(function (req, res, next) {\n  // Only meter the API surface"),
  );
  const resolveClientIp = runInNewContext(ipSource + '\nresolveClientIp', {}) as (
    req: { socket?: { remoteAddress?: string }; headers?: Record<string, string>; ip?: string }
  ) => string;

  it('honors cf-connecting-ip only when the chain proves Cloudflare transit', () => {
    // Railway topology: socket peer is the internal edge hop, the edge appended
    // a Cloudflare egress address as the rightmost XFF entry, CF set
    // cf-connecting-ip to the real client -> per-client key (PERF-001).
    const proxied = {
      socket: { remoteAddress: '::ffff:100.100.1.1' },
      headers: {
        'x-forwarded-for': '198.51.100.7, 172.70.1.1',
        'cf-connecting-ip': '198.51.100.7',
      },
    };
    expect(resolveClientIp(proxied)).toBe('198.51.100.7');
  });

  it('keys a CF-direct connection (CF egress as the socket peer) on cf-connecting-ip', () => {
    // Topology where Cloudflare connects straight to the origin: the socket
    // peer itself is a CF egress address, so the header is authoritative.
    const cfDirect = {
      socket: { remoteAddress: '172.70.9.9' },
      headers: { 'cf-connecting-ip': '198.51.100.7' },
    };
    expect(resolveClientIp(cfDirect)).toBe('198.51.100.7');
  });

  it('never lets a direct-to-origin attacker mint keys via cf-connecting-ip (SC-01)', () => {
    // Direct-to-origin attacker on *.up.railway.app: the socket peer is the
    // Railway edge (internal), the edge appended the attacker's REAL address
    // as the rightmost XFF entry, and the forged CF header must be ignored.
    const forged = {
      socket: { remoteAddress: '::ffff:100.100.1.1' },
      headers: {
        'x-forwarded-for': '6.6.6.6',
        'cf-connecting-ip': '9.9.9.9',
      },
    };
    expect(resolveClientIp(forged)).toBe('6.6.6.6');
  });

  it('never consults client-forged XFF entries left of the appended one (SC-02)', () => {
    // The rightmost entry is the one the proxy chain appended; anything the
    // client injected to its left is attacker-chosen and unusable as a key.
    const forged = {
      socket: { remoteAddress: '::ffff:100.100.1.1' },
      headers: { 'x-forwarded-for': '8.8.8.8, 6.6.6.6' },
    };
    expect(resolveClientIp(forged)).toBe('6.6.6.6');
  });

  it('a CF-range entry forged mid-chain cannot fake transit when the edge appended later', () => {
    const forged = {
      socket: { remoteAddress: '::ffff:100.100.1.1' },
      headers: {
        'x-forwarded-for': '9.9.9.9, 104.16.5.5, 6.6.6.6',
        'cf-connecting-ip': '1.2.3.4',
      },
    };
    expect(resolveClientIp(forged)).toBe('6.6.6.6');
  });

  it('falls back to the CF egress entry when cf-connecting-ip is not a plain IP', () => {
    const odd = {
      socket: { remoteAddress: '::ffff:100.100.1.1' },
      headers: {
        'x-forwarded-for': '198.51.100.7, 172.70.1.1',
        'cf-connecting-ip': 'not-an-ip',
      },
    };
    expect(resolveClientIp(odd)).toBe('172.70.1.1');
  });

  it('never trusts cf-connecting-ip on a direct (public-peer) hit', () => {
    // Direct connection with a public socket peer: no trusted proxy exists,
    // the socket address wins and headers are irrelevant (CWE-345).
    const direct = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'cf-connecting-ip': '1.2.3.4' } };
    expect(resolveClientIp(direct)).toBe('203.0.113.9');
  });

  it('fails closed to the socket peer, never to req.ip, when nothing is attributable', () => {
    // req.ip is forgeable via hop-0 trust (SC-02); it must never become the
    // limiter key. With no forwarded chain at all, the socket peer is the key.
    expect(resolveClientIp({ socket: { remoteAddress: '127.0.0.1' }, ip: '192.0.2.5' })).toBe('127.0.0.1');
    expect(resolveClientIp({ socket: { remoteAddress: '::ffff:100.100.1.1' }, ip: '192.0.2.5' })).toBe(
      '::ffff:100.100.1.1'
    );
    expect(resolveClientIp({})).toBe('unknown');
  });
});

// ─── DATA-006: a chatbot deck link must not carry lead PII ───
// The demo reply no longer links to the third-party deck at all (F-A-07 /
// F-B-12: it was advertised as "personalized" and was generic). If a link is
// ever restored it must stay a generic product link: the lead's details stay in
// EcoAuditor's own store, never in a URL handed to another host.
describe('Chatbot demo deck link (DATA-006)', () => {
  it('never embeds lead company/email in a third-party URL', () => {
    expect(serverSource).not.toMatch(/radiant-alignment[^`]*\$\{encodeURIComponent\(state\.(company|email|name)\)/);
    for (const link of serverSource.match(/https:\/\/radiant-alignment[^\s'"`)]*/g) ?? []) {
      // Only the non-identifying product marker may ride along.
      expect([...new URL(link).searchParams.keys()]).toEqual(['product']);
    }
  });
});

// ─── DATA-005 / INFRA-003: account data controls + readiness, integration ───
// Spawns the real server (no DB, dev auth) like tests/server-health.test.ts.
// Without a database every data route answers 503 (F-G-07).
describe('Account data controls and readiness (integration)', () => {
  const port = 10000 + Math.floor(Math.random() * 50000);
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: 'Bearer test-dev-secret' };
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    child = spawn('node', ['server.cjs'], {
      env: {
        ...process.env,
        PORT: String(port),
        DEV_AUTH_SECRET: 'test-dev-secret',
        ALLOW_DEV_AUTH: 'true',
        NODE_ENV: 'development',
        INSFORGE_BASE_URL: '',
        VITE_INSFORGE_BASE_URL: '',
        DATABASE_URL: '',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) return;
      } catch { /* not up yet */ }
      await new Promise((res) => setTimeout(res, 150));
    }
    throw new Error('integration server did not start within 9s');
  }, 15000);

  afterAll(() => {
    child?.kill('SIGTERM');
    child = null;
  });

  // The export and the delete themselves run on real Postgres in
  // tests/entries-write-api.test.ts (DATA-005): there is no sample company to
  // export or delete any more (F-G-07).
  it('without a database, export and delete-data answer 503 and serve no sample company (DATA-005)', async () => {
    const exported = await fetch(`${base}/api/account/export`, { headers: auth });
    expect(exported.status).toBe(503);
    expect(await exported.text()).not.toContain('test-company-1');
    const deleted = await fetch(`${base}/api/account/delete-data`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' } });
    expect(deleted.status).toBe(503);
    expect(await deleted.json()).toEqual({ success: false, error: 'Data store unavailable' });
  });

  it('requires authentication for both controls', async () => {
    expect((await fetch(`${base}/api/account/export`)).status).toBe(401);
    expect((await fetch(`${base}/api/account/delete-data`, { method: 'POST' })).status).toBe(401);
  });

  it('echoes an X-Request-Id header (INFRA-007)', async () => {
    const r = await fetch(`${base}/api/version`);
    const id = r.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const r2 = await fetch(`${base}/api/version`);
    expect(r2.headers.get('x-request-id')).not.toBe(id);
  });

  it('/ready gates on the data store, not the video (INFRA-003/INFRA-008)', async () => {
    const r = await fetch(`${base}/ready`);
    // No DATABASE_URL configured -> ready (same semantics as /health); the
    // video is not part of readiness, and the body is the status only (D-10).
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'ok' });
  });

  it('meters only /api/ paths with the global limiter (PERF-001)', async () => {
    // Runs last in this describe: it deliberately exhausts the API bucket.
    // Static/prerendered requests must not consume the API bucket.
    for (let i = 0; i < 125; i++) {
      const r = await fetch(`${base}/?limiter-probe=${i}`);
      expect(r.status).not.toBe(429);
    }
    // A burst of API calls trips the shared limiter.
    let saw429 = false;
    for (let i = 0; i < 130; i++) {
      const r = await fetch(`${base}/api/version?limiter-probe=${i}`);
      if (r.status === 429) { saw429 = true; break; }
    }
    expect(saw429).toBe(true);
  });
});
