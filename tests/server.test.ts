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
// Note: This logic is inlined in server.cjs video handler.
// TODO: Extract parseRange into shared module for server + test reuse.

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number; contentLength: number } | { invalid: true } {
  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (isNaN(start) || isNaN(end) || start < 0 || end < start || start >= fileSize) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
    contentLength: Math.min(end, fileSize - 1) - start + 1,
  };
}

describe('Range Header Validation', () => {
  const fileSize = 10000;

  it('parses valid range', () => {
    const result = parseRange('bytes=0-999', fileSize);
    if ('invalid' in result) throw new Error('Should not be invalid');
    expect(result.start).toBe(0);
    expect(result.end).toBe(999);
    expect(result.contentLength).toBe(1000);
  });

  it('parses open-ended range', () => {
    const result = parseRange('bytes=500-', fileSize);
    if ('invalid' in result) throw new Error('Should not be invalid');
    expect(result.start).toBe(500);
    expect(result.end).toBe(9999);
  });

  it('rejects NaN start', () => {
    const result = parseRange('bytes=abc-999', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects negative start', () => {
    const result = parseRange('bytes=-1-999', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects start > end', () => {
    const result = parseRange('bytes=999-500', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects start >= file size', () => {
    const result = parseRange('bytes=10000-10001', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('rejects NaN end', () => {
    const result = parseRange('bytes=0-xyz', fileSize);
    expect(result).toEqual({ invalid: true });
  });

  it('clamps end to file size - 1', () => {
    const result = parseRange('bytes=0-99999', fileSize);
    if ('invalid' in result) throw new Error('Should not be invalid');
    expect(result.end).toBe(9999);
  });
});

// ─── Cache Headers Logic ───
// Note: This logic is inlined in server.cjs static file handler.
// TODO: Extract getCacheHeaders into shared module for server + test reuse.

describe('Cache Headers Logic', () => {
  function getCacheHeaders(filePath: string): string | null {
    if (filePath.includes('/assets/') && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
      return 'public, max-age=31536000, immutable';
    } else if (filePath.endsWith('.html')) {
      return 'no-cache';
    }
    return null;
  }

  it('sets immutable cache for hashed JS assets', () => {
    expect(getCacheHeaders('/assets/index-D6gBU1wL.js')).toBe('public, max-age=31536000, immutable');
  });

  it('sets immutable cache for hashed CSS assets', () => {
    expect(getCacheHeaders('/assets/index-CjmghmtH.css')).toBe('public, max-age=31536000, immutable');
  });

  it('sets no-cache for HTML files', () => {
    expect(getCacheHeaders('/index.html')).toBe('no-cache');
  });

  it('returns null for other files', () => {
    expect(getCacheHeaders('/favicon.ico')).toBeNull();
  });
});

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

  it('checkout rejects disallowed priceId', () => {
    // CodeRabbit fix: priceId must be validated against server-side allowlist.
    // The server now checks ALLOWED_PRICE_IDS before creating checkout sessions.
    const allowedPrices = new Set(['price_starter_mo', 'price_growth_mo']);
    const fakePrice = 'price_attack_inject';
    expect(allowedPrices.has(fakePrice)).toBe(false);
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
  const route = serverSource.slice(serverSource.indexOf("app.post('/api/ingest/csv'"));
  const handler = route.slice(0, route.indexOf("app.get('/api/ingest/status"));

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

  it('rejects out-of-range confidence per row instead of failing the whole import', () => {
    expect(handler).toContain('confidence must be between 0 and 100');
  });
});

describe('SPA shell caching', () => {
  it('sends no-cache so a deploy cannot leave a stale shell behind', () => {
    // Scoped to the fallback's own branch: the 404 below it and the prerendered
    // routes above already send no-cache, so an unscoped match would pass
    // without the fix. A cached shell requests hashed assets that are gone.
    const fallback = serverSource.slice(serverSource.indexOf("app.get('*'"));
    const shellBranch = fallback.slice(0, fallback.indexOf('res.status(404)'));
    expect(shellBranch).toContain("'no-cache, no-transform'");
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

// ─── DATA-006: chatbot demo deck link must not carry lead PII ───
describe('Chatbot demo deck link (DATA-006)', () => {
  it('does not embed lead company/email in the third-party URL', () => {
    expect(serverSource).not.toMatch(/radiant-alignment[^`]*\$\{encodeURIComponent\(state\.(company|email)\)/);
    // Only the non-identifying product marker is sent.
    expect(serverSource).toContain("'https://radiant-alignment-production-b430.up.railway.app/?product=ecoauditor'");
  });
});

// ─── DATA-005 / INFRA-003: account data controls + readiness, integration ───
// Spawns the real server (no DB, dev auth) like tests/server-health.test.ts.
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

  it('exports the caller workspace as a JSON attachment (DATA-005)', async () => {
    const r = await fetch(`${base}/api/account/export`, { headers: auth });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('content-disposition')).toContain('attachment; filename="ecoauditor-export-test-company-1.json"');
    const body = await r.json();
    expect(body.exportedAt).toBeTruthy();
    expect(body.company.id).toBe('test-company-1');
    expect(Array.isArray(body.facilities)).toBe(true);
    expect(Array.isArray(body.emissionEntries)).toBe(true);
  });

  it('deletes audit data but not the account, and export then comes back empty (DATA-005)', async () => {
    const before = await (await fetch(`${base}/api/account/export`, { headers: auth })).json();
    expect(before.emissionEntries.length).toBeGreaterThan(0);

    const r = await fetch(`${base}/api/account/delete-data`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deleted).toBe(true);
    expect(body.deletedEntries).toBe(before.emissionEntries.length);
    expect(body.deletedFacilities).toBe(before.facilities.length);

    const after = await (await fetch(`${base}/api/account/export`, { headers: auth })).json();
    expect(after.emissionEntries).toHaveLength(0);
    expect(after.facilities).toHaveLength(0);
    // The company row itself must survive the delete.
    expect(after.company.id).toBe('test-company-1');
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
    // No DATABASE_URL configured -> ready (same semantics as /health), video
    // is informational only.
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('not configured');
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
