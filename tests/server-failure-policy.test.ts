// @vitest-environment node
/**
 * The server's failure and observability policy against a REAL spawned
 * `node server.cjs` (no Docker, no database; tests/helpers/spawn-server.ts):
 *
 *   F-G-06  a route added without try/catch (tests/helpers/test-routes-preload.cjs
 *           registers it on the real app) answers a JSON 500 and the next request
 *           a 200; an unhandled rejection is logged and the process continues; a
 *           storm of them, or an uncaught exception, exits so Railway restarts it
 *   F-G-08  one access-log line per request, no personal data; a failure is logged
 *           once with stack and driver code, the connection string redacted
 *   F-G-08  POST /api/client-error: limits and the /api budget
 *   F-G-13  Stripe and pg constructor failures are logged, never swallowed;
 *           config warnings at a production boot name variables, never values
 *   F-O-01  the version comes from package.json; a stale APP_VERSION is ignored
 *   F-G-18  the real server honours gzip;q=0
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, waitFor, type LogLine, type Spawned } from './helpers/spawn-server';

const TEST_ROUTES = path.resolve(__dirname, 'helpers', 'test-routes-preload.cjs');
const FAILING_SDK = path.resolve(__dirname, 'helpers', 'failing-sdk-preload.cjs');
const PACKAGE_VERSION = (JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

const byMessage = (app: Spawned, pattern: RegExp): LogLine[] => app.logs.filter((line) => pattern.test(String(line.message)));

function waitForExit(app: Spawned, timeoutMs = 10_000): Promise<number | null> {
  if (app.child.exitCode !== null) return Promise.resolve(app.child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not exit')), timeoutMs);
    app.child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('F-G-06: a route added without try/catch, on the real app', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer({ GIT_SHA: 'policy-sha' }, { preload: [TEST_ROUTES] });
  }, 60_000);

  afterAll(() => app?.stop());

  it('answers a JSON 500 with the request id, and the next request answers 200', async () => {
    const failed = await fetch(`${app.base}/api/__test/rejects`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Internal server error', requestId: failed.headers.get('x-request-id') });

    const next = await fetch(`${app.base}/api/health`);
    expect(next.status).toBe(200);
    expect(app.child.exitCode).toBeNull();
  });

  it('logs the failure once, with stack and pg code, and redacts the connection string', async () => {
    const res = await fetch(`${app.base}/api/__test/driver-error`);
    const requestId = res.headers.get('x-request-id');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Data store temporarily unavailable. Please retry.', requestId });

    const failures = await waitFor(() => {
      const lines = byMessage(app, /^Request failed$/).filter((line) => line.requestId === requestId);
      return lines.length ? lines : undefined;
    }, 5000, 'the failure log line');
    expect(failures).toHaveLength(1);
    const error = failures[0]!.error as Record<string, string>;
    expect(failures[0]!.route).toBe('/api/__test/driver-error');
    expect(error.code).toBe('57P01');
    expect(error.stack).toContain('test-routes-preload.cjs');
    expect(error.message).toContain('postgres://[redacted]@db.internal');
    expect(app.rawLog()).not.toContain('hunter2-marker');
  });

  it('an unhandled rejection started by a request is logged and the process keeps serving', async () => {
    expect((await fetch(`${app.base}/api/__test/floating`)).status).toBe(200);
    const line = await waitFor(() => byMessage(app, /^Unhandled rejection$/)[0], 5000, 'the rejection log line');
    expect((line.error as Record<string, string>).message).toBe('floating rejection nobody awaited');
    await new Promise((r) => setTimeout(r, 200));
    expect((await fetch(`${app.base}/api/health`)).status).toBe(200);
    expect(app.child.exitCode).toBeNull();
  });

  it('writes one access-log line per request: route pattern, status, duration, and no personal data', async () => {
    const res = await fetch(`${app.base}/api/health?email=ada@example.com&token=query-marker-1`, {
      headers: { 'user-agent': 'agent-marker/1.0', cookie: 'session=cookie-marker-2' },
    });
    const requestId = res.headers.get('x-request-id');
    const lines = await waitFor(() => {
      const found = app.logs.filter((line) => line.message === 'request' && line.requestId === requestId);
      return found.length ? found : undefined;
    }, 5000, 'the access-log line');
    await new Promise((r) => setTimeout(r, 100));
    expect(app.logs.filter((line) => line.message === 'request' && line.requestId === requestId)).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', method: 'GET', route: '/api/health', status: 200 });
    expect(typeof lines[0]!.durationMs).toBe('number');
    const raw = app.rawLog();
    for (const marker of ['ada@example.com', 'query-marker-1', 'agent-marker', 'cookie-marker-2', '127.0.0.1']) {
      expect(raw).not.toContain(marker);
    }
  });

  it('compresses through the real middleware stack and honours gzip;q=0', async () => {
    const get = (encoding: string) =>
      new Promise<http.IncomingMessage>((resolve, reject) => {
        http.get(`${app.base}/api/__test/large-text`, { headers: { 'accept-encoding': encoding } }, (res) => {
          res.resume();
          resolve(res);
        }).on('error', reject);
      });
    expect((await get('gzip')).headers['content-encoding']).toBe('gzip');
    expect((await get('gzip;q=0, identity')).headers['content-encoding']).toBeUndefined();
  });
});

describe('F-G-06: the exits that remain are bounded and logged', () => {
  it('ten unhandled rejections within a minute exit the process with code 1', async () => {
    const app = await startServer({}, { preload: [TEST_ROUTES] });
    try {
      for (let i = 0; i < 9; i += 1) await fetch(`${app.base}/api/__test/floating`);
      await waitFor(() => (byMessage(app, /^Unhandled rejection$/).length >= 9 ? true : undefined), 5000, 'nine rejections');
      expect(app.child.exitCode).toBeNull();

      await fetch(`${app.base}/api/__test/floating`);
      expect(await waitForExit(app)).toBe(1);
      expect(byMessage(app, /Rejection storm/)).toHaveLength(1);
    } finally {
      app.stop();
    }
  }, 60_000);

  it('an uncaught exception is logged with its stack and exits with code 1', async () => {
    const app = await startServer({}, { preload: [TEST_ROUTES] });
    try {
      expect((await fetch(`${app.base}/api/__test/throws-later`)).status).toBe(200);
      expect(await waitForExit(app)).toBe(1);
      const line = byMessage(app, /^Uncaught exception/)[0];
      expect((line?.error as Record<string, string>).stack).toContain('thrown from a timer');
    } finally {
      app.stop();
    }
  }, 60_000);
});

describe('POST /api/client-error on the real server (F-G-08, F-F-08)', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer({ GIT_SHA: 'client-error-sha' });
  }, 60_000);

  afterAll(() => app?.stop());

  const post = (body: string) =>
    fetch(`${app.base}/api/client-error`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

  it('caps the body at 8 KB', async () => {
    const res = await post(JSON.stringify({ message: 'm', stack: 'x'.repeat(9000) }));
    expect(res.status).toBe(413);
  });

  // Keep LAST in this describe: it exhausts the route's limit for this address.
  it('logs a valid report with the build sha, then limits one address to 10 a minute without spending the /api budget', async () => {
    const first = await post(JSON.stringify({ message: 'TypeError: boom', route: '/app/reports', source: 'boundary' }));
    expect(first.status).toBe(204);
    const report = await waitFor(() => byMessage(app, /^Client error report$/)[0], 5000, 'the report line');
    expect(report).toMatchObject({ level: 'warn', build: 'client-error-sha', source: 'boundary', route: '/app/reports', error: { message: 'TypeError: boom' } });

    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) statuses.push((await post(JSON.stringify({ message: 'again ' + i }))).status);
    // The limiter runs before the body parser, so it has already counted the
    // oversize request and the first report: 8 more fit in this minute.
    expect(statuses.slice(0, 8).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(8).every((status) => status === 429)).toBe(true);
    // 130 requests went through; had they been metered by the shared /api limiter
    // (120 a minute), this would be refused.
    expect((await fetch(`${app.base}/api/version`)).status).toBe(200);
  }, 60_000);
});

describe('F-G-13: SDK constructor failures are logged, never swallowed', () => {
  it('logs the Stripe and pg failures, with the key and the password redacted', async () => {
    const app = await startServer(
      { STRIPE_SECRET_KEY: 'sk_test_markerKEY123', DATABASE_URL: 'postgres://eco:pw-marker@127.0.0.1:1/eco' },
      { preload: [FAILING_SDK] },
    );
    try {
      const stripeLine = await waitFor(() => byMessage(app, /^Stripe SDK failed to initialise/)[0], 5000, 'the Stripe line');
      const pgLine = await waitFor(() => byMessage(app, /^Postgres pool setup failed$/)[0], 5000, 'the pg line');
      expect(stripeLine.level).toBe('error');
      expect((stripeLine.error as Record<string, string>).message).toContain('[redacted]');
      expect((pgLine.error as Record<string, string>).message).toContain('postgres://[redacted]@127.0.0.1');
      const raw = app.rawLog();
      expect(raw).not.toContain('sk_test_markerKEY123');
      expect(raw).not.toContain('pw-marker');
      // Unchanged behaviour: the process still serves, billing answers 503.
      expect((await fetch(`${app.base}/api/health`)).status).toBe(200);
    } finally {
      app.stop();
    }
  }, 60_000);
});

describe('F-O-01 / F-G-13 / F-F-18: version and boot warnings', () => {
  it('reports the package.json version and ignores a stale APP_VERSION, with one warning', async () => {
    const app = await startServer({ APP_VERSION: '1.0.0' });
    try {
      const res = await fetch(`${app.base}/api/version`);
      expect(await res.json()).toEqual({ version: PACKAGE_VERSION });
      const warnings = await waitFor(() => {
        const found = app.logs.filter((line) => line.level === 'warn' && line.variable === 'APP_VERSION');
        return found.length ? found : undefined;
      }, 5000, 'the APP_VERSION warning');
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]!.action)).toMatch(/Delete APP_VERSION/);
    } finally {
      app.stop();
    }
  }, 60_000);

  it('a production boot names each missing or dev-only variable once, and never logs a value', async () => {
    const app = await startServer(
      {
        NODE_ENV: 'production',
        CONSENT_IP_PEPPER: 'pepper-value-marker',
        SITE_DEPLOY_TOKEN: '',
        VITE_GTM_ID: '',
        VITE_INSFORGE_ANON_KEY: '',
        INSFORGE_BASE_URL: 'https://insforge-a-marker.example',
        VITE_INSFORGE_BASE_URL: 'https://insforge-b-marker.example',
        DEV_COMPANY_ID: 'dev-company-marker',
        APP_VERSION: '',
      },
      { fakePg: 'ok' },
    );
    try {
      await waitFor(() => app.logs.find((line) => line.message === 'Eco-Auditor listening'), 8000, 'the listening line');
      const warned = app.logs.filter((line) => line.level === 'warn' && typeof line.variable === 'string').map((line) => line.variable).sort();
      expect(warned).toEqual(['DEV_COMPANY_ID', 'INSFORGE_BASE_URL', 'SITE_DEPLOY_TOKEN', 'VITE_GTM_ID', 'VITE_INSFORGE_ANON_KEY']);
      const raw = app.rawLog();
      for (const marker of ['pepper-value-marker', 'insforge-a-marker', 'insforge-b-marker', 'dev-company-marker']) {
        expect(raw).not.toContain(marker);
      }
    } finally {
      app.stop();
    }
  }, 60_000);
});
