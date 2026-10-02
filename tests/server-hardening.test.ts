// @vitest-environment node
/**
 * Server-side hardening from the 2026-09-29 audit, against a REAL spawned server
 * (no Docker, no database; see tests/helpers/spawn-server.ts):
 *
 *   F-D-02   no X-Powered-By header on any response
 *   F-D-03   anonymous /health and /api/health expose status + sha only, and
 *            still answer 503 when the database is unreachable
 *   F-D-04   body-parser failures answer JSON, not Express's HTML error page
 *   F-X1-05  GET /api/video is not metered by the /api limiter
 *   F-F-17   /ready is not cacheable (and keeps its contract)
 *   D-10     anonymous /ready and /api/version expose the status / version only
 *   F-A-18 / F-E-07  the retired Slice 6 compliance routes answer 410 and serve
 *            no regulatory date, status or applicability verdict
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, waitFor, type Spawned } from './helpers/spawn-server';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('server hardening, no database', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer({ GIT_SHA: 'hardening-sha' });
  }, 60_000);

  afterAll(() => app?.stop());

  describe('F-D-02: X-Powered-By', () => {
    it.each([
      ['a JSON API route', 'GET', '/api/health'],
      ['a health alias', 'GET', '/health'],
      ['readiness', 'GET', '/ready'],
      ['the home page path', 'GET', '/'],
      ['an unknown page (404)', 'GET', '/no-such-page'],
      ['an unknown API route (404)', 'GET', '/api/no-such-route'],
      ['a retired route (410)', 'GET', '/api/compliance/deadlines'],
    ])('is absent on %s', async (_label, method, path) => {
      const res = await fetch(`${app.base}${path}`, { method });
      expect(res.headers.has('x-powered-by')).toBe(false);
      // The header hygiene must not have cost the security headers.
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('is absent on an error response too', async () => {
      const res = await fetch(`${app.base}/api/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      expect(res.status).toBe(400);
      expect(res.headers.has('x-powered-by')).toBe(false);
    });
  });

  describe('F-D-03: anonymous health payload', () => {
    it.each(['/health', '/api/health'])('%s exposes exactly status and sha', async (path) => {
      const res = await fetch(`${app.base}${path}`);
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body).toEqual({ status: 'ok', sha: 'hardening-sha' });
      // Named so a regression says what leaked.
      for (const leaked of ['uptime', 'version', 'db', 'build', 'timestamp']) {
        expect(body).not.toHaveProperty(leaked);
      }
      expect(res.headers.get('cache-control')).toContain('no-store');
    });
  });

  describe('F-F-17 / D-10: /ready', () => {
    it('is no-store, keeps its readiness contract, and tells an anonymous caller the status only', async () => {
      const res = await fetch(`${app.base}/ready`);
      // Railway's healthcheck reads the status code.
      expect(res.status).toBe(200);
      const cacheControl = res.headers.get('cache-control') ?? '';
      expect(cacheControl).toContain('no-store');
      expect(res.headers.get('pragma')).toBe('no-cache');
      // D-10: the db, video and timestamp detail is gone; exact key set, so a
      // field added later fails here instead of leaking quietly.
      expect(await readJson(res)).toEqual({ status: 'ok' });
    });
  });

  describe('D-10: /api/version', () => {
    it('tells an anonymous caller the version only', async () => {
      const res = await fetch(`${app.base}/api/version`);
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(Object.keys(body)).toEqual(['version']);
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(res.headers.get('cache-control')).toContain('no-store');
    });
  });

  describe('F-D-04: body-parser errors answer JSON', () => {
    it('malformed JSON is a 400 with a JSON error, not an HTML page', async () => {
      const res = await fetch(`${app.base}/api/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });

    it('an oversize body is a 413 with a JSON error', async () => {
      const res = await fetch(`${app.base}/api/consent-audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: {}, filler: 'x'.repeat(6000) }),
      });
      expect(res.status).toBe(413);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'Request body too large' });
    });

    it('an unsupported charset is a 415 with a JSON error', async () => {
      const res = await fetch(`${app.base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-32' },
        body: '{"message":"hi"}',
      });
      expect(res.status).toBe(415);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'Unsupported content type' });
    });

    it('never echoes parser detail or the offending body', async () => {
      const res = await fetch(`${app.base}/api/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"name": "Ada", secret-marker-1234',
      });
      const text = await res.text();
      expect(text).not.toContain('secret-marker-1234');
      expect(text).not.toMatch(/SyntaxError|Unexpected token|<pre>|at .*\.js/);
    });

    it('does not turn a valid request into an error', async () => {
      const res = await fetch(`${app.base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'pricing' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('F-A-18 / F-E-07: retired compliance routes', () => {
    const cases: Array<[string, string]> = [
      ['GET', '/api/compliance/deadlines'],
      ['GET', '/api/companies/1/compliance'],
      ['POST', '/api/compliance/1/signoff'],
    ];

    it.each(cases)('%s %s answers 410 Gone and serves no regulatory data', async (method, path) => {
      const res = await fetch(`${app.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status).toBe(410);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('data');
      // The wrong verdicts the audit found must not be served in any form.
      expect(JSON.stringify(body)).not.toMatch(/overdue|due_soon|upcoming|SB 253|CSRD|2026-01-01|2027-01-01|2025-01-01/);
    });

    it('answers the same way with credentials, so nothing depends on who asks', async () => {
      const res = await fetch(`${app.base}/api/compliance/deadlines`, { headers: { authorization: 'Bearer anything' } });
      expect(res.status).toBe(410);
    });
  });

  // Keep this LAST in the file: it deliberately exhausts the API bucket.
  describe('F-X1-05: /api/video is not metered by the /api limiter', () => {
    it('130 video range requests leave the API budget untouched, while other API routes are still metered', async () => {
      for (let i = 0; i < 130; i += 1) {
        const res = await fetch(`${app.base}/api/video`, { headers: { range: 'bytes=0-1' } });
        // 404 without a video volume, 206 with one: never 429.
        expect(res.status).not.toBe(429);
      }
      // If the video were metered, this would be the 131st request in the window.
      const health = await fetch(`${app.base}/api/health`);
      expect(health.status).toBe(200);

      // The limiter itself is still on for everything else in this same process
      // (so the assertions above are not passing because metering is off).
      let limited = false;
      for (let i = 0; i < 130 && !limited; i += 1) {
        limited = (await fetch(`${app.base}/api/version`)).status === 429;
      }
      expect(limited).toBe(true);
    }, 60_000);
  });
});

describe('server hardening, database unreachable', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer({ GIT_SHA: 'degraded-sha' }, { fakePg: 'down' });
  }, 60_000);

  afterAll(() => app?.stop());

  it.each(['/health', '/api/health'])('%s stays 503 (Railway and the Docker HEALTHCHECK depend on it) with status and sha only', async (path) => {
    const res = await fetch(`${app.base}${path}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', sha: 'degraded-sha' });
  });

  it('/ready still reports the data store as unreachable with a 503, and the status only (D-10)', async () => {
    const res = await fetch(`${app.base}/ready`);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await readJson(res)).toEqual({ status: 'degraded' });
    // The detail the body no longer carries is in the log.
    await waitFor(() => app.logs.find((line) => line.message === 'Database health probe failed'), 5000, 'the probe failure line');
  });

  it('the process survives the failing probes', async () => {
    await fetch(`${app.base}/api/health`);
    expect(app.child.exitCode).toBeNull();
  });
});
