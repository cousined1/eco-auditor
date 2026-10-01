// @vitest-environment node
/**
 * F-G-08 / F-F-08, unit level: the access-log field allowlist and the
 * client-error report schema (server-observability.cjs). The spawned-server
 * half is tests/server-failure-policy.test.ts.
 */
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const {
  ACCESS_LOG_FIELDS,
  accessLogFields,
  createAccessLog,
  parseClientErrorReport,
  createClientErrorHandler,
  CLIENT_ERRORS_LOGGED_PER_MINUTE,
} = require('../server-observability.cjs');

type LogCall = { level: string; message: string; context?: Record<string, unknown> };

function makeLog() {
  const calls: LogCall[] = [];
  const log = (level: string, message: string, context?: Record<string, unknown>) => {
    calls.push({ level, message, ...(context ? { context } : {}) });
  };
  return { calls, log };
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(app: { listen: (port: number, host: string, cb: () => void) => Server }): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    servers.push(server);
  });
}

// Everything a request can carry that must never reach the access log.
const PII = {
  email: 'ada.lovelace@example.com',
  ip: '203.0.113.77',
  userAgent: 'Mozilla/5.0 pii-agent-marker',
  cookie: 'session=cookie-marker-123',
  authorization: 'Bearer auth-marker-456',
  query: 'token=query-marker-789',
  body: 'body-marker-000',
};

describe('access log: the field allowlist', () => {
  it('writes only allowlisted fields, whatever the request carries', () => {
    const req = {
      requestId: 'rid-1',
      method: 'POST',
      route: { path: '/api/companies/:id/facilities' },
      baseUrl: '',
      originalUrl: `/api/companies/c1/facilities?${PII.query}&email=${PII.email}`,
      url: `/api/companies/c1/facilities?${PII.query}`,
      query: { token: 'query-marker-789', email: PII.email },
      ip: PII.ip,
      ips: [PII.ip],
      headers: { 'user-agent': PII.userAgent, cookie: PII.cookie, authorization: PII.authorization },
      body: { name: PII.body, email: PII.email },
      user: { id: 'u-123', company_id: 'c-456', email: PII.email, name: 'Ada' },
    };
    const fields = accessLogFields(req, { statusCode: 201 }, 12.3456, false);

    expect(Object.keys(fields).every((key) => ACCESS_LOG_FIELDS.includes(key))).toBe(true);
    expect(fields).toEqual({
      requestId: 'rid-1',
      method: 'POST',
      route: '/api/companies/:id/facilities',
      status: 201,
      durationMs: 12.3,
      userId: 'u-123',
      companyId: 'c-456',
    });
    const serialized = JSON.stringify(fields);
    for (const marker of Object.values(PII)) expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain('c1/facilities');
  });

  it('logs no route for a request no route matched, never its URL', () => {
    const fields = accessLogFields({ requestId: 'r', method: 'GET', originalUrl: '/assets/x.js?v=1' }, { statusCode: 200 }, 1, false);
    expect(fields.route).toBeNull();
    expect(JSON.stringify(fields)).not.toContain('assets');
  });

  it('marks a response the client abandoned', () => {
    expect(accessLogFields({ method: 'GET' }, { statusCode: 200 }, 1, true).aborted).toBe(true);
  });

  it('writes exactly one line per request, when the response finishes, with status and duration', async () => {
    const log = makeLog();
    const app = express();
    app.use((req: { requestId?: string }, _res: unknown, next: () => void) => { req.requestId = 'rid-2'; next(); });
    app.use(createAccessLog({ log: log.log }));
    app.get('/api/items/:id', (req: { user?: object }, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      req.user = { id: 'user-9', email: PII.email };
      res.status(202).json({ ok: true });
    });
    const base = await listen(app);

    await fetch(`${base}/api/items/42?${PII.query}`, { headers: { 'user-agent': PII.userAgent, cookie: PII.cookie } });
    await new Promise((r) => setTimeout(r, 30));

    const lines = log.calls.filter((c) => c.message === 'request');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('info');
    expect(lines[0]!.context).toMatchObject({ requestId: 'rid-2', method: 'GET', route: '/api/items/:id', status: 202, userId: 'user-9' });
    expect(typeof lines[0]!.context!.durationMs).toBe('number');
    for (const marker of Object.values(PII)) expect(JSON.stringify(lines[0])).not.toContain(marker);
  });
});

describe('client error reports: schema, scrubbing and cap', () => {
  it('keeps message, a truncated stack, the page path and the source, and scrubs personal data', () => {
    const stack = [
      'TypeError: cannot read x of ada@example.com',
      ...Array.from({ length: 40 }, (_, i) => `    at fn${i} (https://ecoauditor.io/assets/index-abc.js?session=s3cr3t#frag:1:${i})`),
    ].join('\n');
    const report = parseClientErrorReport({
      message: 'Failed for ada@example.com with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc_DEF-123',
      stack,
      route: '/app/reports',
      source: 'boundary',
      extra: 'ignored field',
    });
    expect(report).toEqual({
      source: 'boundary',
      route: '/app/reports',
      error: {
        message: 'Failed for [email] with token [token]',
        stack: expect.any(String),
      },
    });
    expect(report.error.stack.split('\n')).toHaveLength(15);
    expect(report.error.stack).toContain('https://ecoauditor.io/assets/index-abc.js:1:0');
    expect(report.error.stack).not.toMatch(/s3cr3t|ada@example|#frag/);
    expect(JSON.stringify(report)).not.toContain('ignored field');
  });

  it.each([
    ['no message', { route: '/' }],
    ['an empty message', { message: '   ' }],
    ['a non-string message', { message: { nested: true } }],
    ['an oversize message', { message: 'x'.repeat(1001) }],
    ['a route with a query string', { message: 'm', route: '/app?email=ada@example.com' }],
    ['a full URL as route', { message: 'm', route: 'https://evil.example/' }],
    ['an unknown source', { message: 'm', source: 'console' }],
    ['a non-object body', 'just text'],
    ['an array body', [{ message: 'm' }]],
  ])('rejects %s', (_label, body) => {
    expect(parseClientErrorReport(body)).toBeNull();
  });

  it('scrubs a percent-encoded email in the page path', () => {
    expect(parseClientErrorReport({ message: 'm', route: '/u/ada%40example.com' }).route).toBe('/u/[email]');
  });

  // D-S1: only the query string of an absolute http(s) URL used to go, so a relative
  // URL (an OAuth callback's code) or another scheme (a socket's token) reached the log.
  it('drops the query string and fragment of a relative URL and of any scheme, in the message and the stack', () => {
    const report = parseClientErrorReport({
      message: 'GET /auth/callback?insforge_code=code-marker-1 failed, then wss://rt.example.test/live?token=token-marker-2#frag-marker-3 closed',
      stack: [
        'Error: redirected to /auth/callback?insforge_code=code-marker-4#state-marker-5',
        '    at connect (wss://rt.example.test/socket.js?token=token-marker-6:12:5)',
        '    at ready (/assets/index-abc.js?v=version-marker-7:3:9)',
        // A colon inside the query ("?redirect_to=https://...") is part of it, not the end of it.
        '    at next (https://ecoauditor.io/auth?redirect_to=https://ecoauditor.io/app&insforge_code=code-marker-8)',
      ].join('\n'),
    });
    expect(report.error.message).toBe('GET /auth/callback failed, then wss://rt.example.test/live closed');
    expect(report.error.stack.split('\n')).toEqual([
      'Error: redirected to /auth/callback',
      '    at connect (wss://rt.example.test/socket.js:12:5)',
      '    at ready (/assets/index-abc.js:3:9)',
      '    at next (https://ecoauditor.io/auth)',
    ]);
    expect(JSON.stringify(report)).not.toContain('marker');
  });

  // D-S2: JSON.stringify escapes what is below U+0020 and leaves these as they are, so a
  // viewer that breaks lines on one of them shows a single report as two lines.
  it('replaces U+2028, U+2029 and the C1 controls (NEL is U+0085) with a space', () => {
    const odd = '\u{85}\u{2028}\u{2029}\u{80}\u{9f}';
    const report = parseClientErrorReport({
      message: `first${odd}second`,
      stack: `Error: boom${odd}{"forged":"line"}\n    at f (https://ecoauditor.io/a.js:1:2)`,
    });
    expect(report.error.message).toBe(`first${' '.repeat(odd.length)}second`);
    expect(report.error.stack).toBe(`Error: boom${' '.repeat(odd.length)}{"forged":"line"}\n    at f (https://ecoauditor.io/a.js:1:2)`);
    expect(JSON.stringify(report)).not.toMatch(/[\u{80}-\u{9f}\u{2028}\u{2029}]/u);
  });

  it('answers 204 for a valid report and logs it once with the build sha, 400 for anything else', async () => {
    const log = makeLog();
    const app = express();
    app.post('/api/client-error', express.json({ limit: '8kb' }), createClientErrorHandler({ log: log.log, buildSha: () => 'sha-abc' }));
    const base = await listen(app);
    const post = (body: unknown) =>
      fetch(`${base}/api/client-error`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: PII.cookie }, body: JSON.stringify(body) });

    expect((await post({ message: 'boom', route: '/app', source: 'error' })).status).toBe(204);
    expect((await post({ route: '/app' })).status).toBe(400);

    const reports = log.calls.filter((c) => c.message === 'Client error report');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      level: 'warn',
      message: 'Client error report',
      context: { build: 'sha-abc', source: 'error', route: '/app', error: { message: 'boom' } },
    });
    expect(JSON.stringify(log.calls)).not.toContain('cookie-marker');
  });

  it(`logs at most ${CLIENT_ERRORS_LOGGED_PER_MINUTE} reports a minute across all callers, and still answers 204`, () => {
    const log = makeLog();
    let clock = 0;
    const handler = createClientErrorHandler({ log: log.log, buildSha: () => null, now: () => clock });
    const statuses: number[] = [];
    const res = { status(code: number) { statuses.push(code); return { end() {}, json() {} }; } };
    for (let i = 0; i < CLIENT_ERRORS_LOGGED_PER_MINUTE + 50; i += 1) handler({ body: { message: 'm' + i } }, res);
    expect(log.calls).toHaveLength(CLIENT_ERRORS_LOGGED_PER_MINUTE);
    expect(statuses.every((code) => code === 204)).toBe(true);
    clock += 60_000;
    handler({ body: { message: 'next minute' } }, res);
    expect(log.calls).toHaveLength(CLIENT_ERRORS_LOGGED_PER_MINUTE + 1);
  });
});
