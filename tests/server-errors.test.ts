// @vitest-environment node
/**
 * F-G-06 / F-G-08, unit level: server-errors.cjs against a real in-process
 * Express 4 app (no server.cjs, no network beyond 127.0.0.1). The spawned-server
 * half, which proves server.cjs wires this in, is tests/server-failure-policy.test.ts.
 */
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const {
  installAsyncErrorForwarding,
  createErrorHandler,
  createProcessGuards,
  serializeError,
  redactSecrets,
  REJECTION_STORM_LIMIT,
} = require('../server-errors.cjs');
const { classifyApiFailure } = require('../server-security.cjs');

type LogCall = { level: string; message: string; context?: Record<string, unknown> };
type Handler = (...args: unknown[]) => unknown;

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

/** An app with the forwarding installed first, like server.cjs, and a request id. */
function makeApp() {
  const app = express();
  installAsyncErrorForwarding(app);
  app.use((req: { requestId?: string }, _res: unknown, next: () => void) => {
    req.requestId = 'req-test-1';
    next();
  });
  return app;
}

async function listen(app: { listen: (port: number, host: string, cb: () => void) => Server }): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
    servers.push(server);
  });
}

function finish(app: { use: (fn: Handler) => void }, log = makeLog()) {
  app.use(createErrorHandler({ log: log.log, classifyApiFailure }));
  return log;
}

describe('installAsyncErrorForwarding: a rejected handler reaches the error middleware', () => {
  it('an async route with no try/catch answers a JSON 500, and the next request still answers 200', async () => {
    const app = makeApp();
    app.get('/api/boom', async () => {
      await Promise.reject(new Error('transient failure'));
    });
    app.get('/api/ok', (_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));
    const log = finish(app);
    const base = await listen(app);

    const failed = await fetch(`${base}/api/boom`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Internal server error', requestId: 'req-test-1' });
    expect((await fetch(`${base}/api/ok`)).status).toBe(200);
    expect(log.calls.filter((c) => c.message === 'Request failed')).toHaveLength(1);
  });

  it('protects a route registered AFTER the server is already serving, with no change to the route', async () => {
    const app = makeApp();
    const base = await listen(app);
    // Registered late, like a route a developer adds without reading the fix. It
    // lands after the terminal handler, so give it one of its own afterwards.
    app.get('/api/added-later', async () => {
      throw new Error('forgot the try/catch');
    });
    const log = finish(app);

    const res = await fetch(`${base}/api/added-later`);
    expect(res.status).toBe(500);
    expect(log.calls.some((c) => c.message === 'Request failed')).toBe(true);
  });

  it('covers handler arrays, path arrays, app.all, app.route() and app.use', async () => {
    const app = makeApp();
    const rejecting = async () => { throw new Error('nope'); };
    app.get('/api/array', [async (_q: unknown, _s: unknown, next: () => void) => next(), rejecting]);
    app.get(['/api/path-a', '/api/path-b'], rejecting);
    app.all('/api/all', rejecting);
    app.route('/api/route').post(rejecting);
    app.use('/api/use', rejecting);
    finish(app);
    const base = await listen(app);

    for (const [method, path] of [
      ['GET', '/api/array'],
      ['GET', '/api/path-a'],
      ['GET', '/api/path-b'],
      ['DELETE', '/api/all'],
      ['POST', '/api/route'],
      ['GET', '/api/use/anything'],
    ]) {
      const res = await fetch(`${base}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(500);
    }
  });

  it('a rejection without an Error (Promise.reject()) still ends the request instead of hanging it', async () => {
    const app = makeApp();
    app.get('/api/empty-reject', () => Promise.reject());
    finish(app);
    const base = await listen(app);
    const res = await fetch(`${base}/api/empty-reject`, { signal: AbortSignal.timeout(3000) });
    expect(res.status).toBe(500);
  });

  it('keeps Express 4 semantics: app.get(setting), arity-4 error middleware, routers and sub-apps', async () => {
    const app = makeApp();
    app.set('answer', 42);
    expect(app.get('answer')).toBe(42);

    // An async error middleware keeps its 4 parameters, so Express still calls it
    // for errors; when IT rejects, the next error middleware gets that error.
    app.get('/api/chain', async () => { throw new Error('first'); });
    const received: string[] = [];
    app.use(async (err: Error, req: unknown, res: unknown, next: unknown) => {
      received.push(typeof req, typeof res, typeof next);
      throw new Error('handler of ' + err.message + ' failed too');
    });
    const log = finish(app);

    // A router and a sub-app are left alone, so Express still mounts them as units.
    const router = express.Router();
    router.get('/ping', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ pong: true }));
    const sub = express();
    sub.get('/hello', (_q: unknown, res: { json: (b: unknown) => void }) => res.json({ hello: true }));
    app.use('/r', router);
    app.use('/sub', sub);
    const base = await listen(app);

    const res = await fetch(`${base}/api/chain`);
    expect(res.status).toBe(500);
    expect(received).toEqual(['object', 'object', 'function']);
    const failure = log.calls.find((c) => c.message === 'Request failed');
    expect((failure?.context?.error as { message: string }).message).toBe('handler of first failed too');
    expect(await (await fetch(`${base}/r/ping`)).json()).toEqual({ pong: true });
    expect(await (await fetch(`${base}/sub/hello`)).json()).toEqual({ hello: true });
    expect(sub.parent).toBe(app); // mounted as a sub-app, not wrapped into a plain function
  });
});

describe('createErrorHandler: one terminal middleware', () => {
  it('logs once with the stack and the driver code, and answers without stack, SQL or path', async () => {
    const app = makeApp();
    app.get('/api/reports/:id', async () => {
      const err = Object.assign(
        new Error('relation "secret_table" does not exist; conn postgres://app:hunter2@db.internal:5432/eco'),
        { code: '42P01', detail: 'Key (email)=(ada@example.com) already exists.' },
      );
      throw err;
    });
    const log = finish(app);
    const base = await listen(app);

    const res = await fetch(`${base}/api/reports/123`);
    // A code-bearing (driver) error is the data store's generic 503.
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/secret_table|hunter2|42P01|\n\s+at |\/api\/reports|"stack"/);
    expect(JSON.parse(text)).toEqual({ error: 'Data store temporarily unavailable. Please retry.', requestId: 'req-test-1' });

    const failures = log.calls.filter((c) => c.message === 'Request failed');
    expect(failures).toHaveLength(1);
    const logged = failures[0]!.context!;
    expect(logged.route).toBe('/api/reports/:id');
    expect(logged.status).toBe(503);
    const error = logged.error as Record<string, string>;
    expect(error.code).toBe('42P01');
    expect(error.stack).toContain('server-errors.test.ts');
    expect(error.message).toContain('postgres://[redacted]@db.internal');
    expect(JSON.stringify(logged)).not.toContain('hunter2');
    // A driver `detail` can quote row values: it is never logged.
    expect(JSON.stringify(logged)).not.toContain('ada@example.com');
  });

  it('keeps the fixed F-D-04 answers for body-parser failures', async () => {
    const app = makeApp();
    app.post('/api/json', express.json({ limit: '1kb' }), (_q: unknown, res: { json: (b: unknown) => void }) => res.json({}));
    finish(app);
    const base = await listen(app);
    const post = (body: string, type = 'application/json') =>
      fetch(`${base}/api/json`, { method: 'POST', headers: { 'content-type': type }, body });

    const malformed = await post('{not json');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON body' });
    const oversize = await post(JSON.stringify({ x: 'y'.repeat(4000) }));
    expect(oversize.status).toBe(413);
    expect(await oversize.json()).toEqual({ error: 'Request body too large' });
  });

  it('answers a page request in plain text, with the request id and nothing else', async () => {
    const app = makeApp();
    app.get('/blog/:slug', async () => { throw new Error('render failed at /srv/app/server-pages.cjs:12'); });
    finish(app);
    const base = await listen(app);
    const res = await fetch(`${base}/blog/x`, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Internal server error (request id req-test-1)');
  });

  it('cuts a half-sent response instead of writing a second one', async () => {
    const app = makeApp();
    app.get('/api/stream', async (_q: unknown, res: { write: (s: string) => void }) => {
      res.write('partial');
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('failed mid-stream');
    });
    const log = finish(app);
    const base = await listen(app);
    await expect(fetch(`${base}/api/stream`).then((r) => r.text())).rejects.toThrow();
    expect(log.calls.filter((c) => c.message === 'Request failed')).toHaveLength(1);
  });
});

describe('createProcessGuards: the process policy', () => {
  function guards(now: () => number) {
    const log = makeLog();
    const exit = vi.fn();
    const stopServer = vi.fn();
    const g = createProcessGuards({ log: log.log, exit, stopServer, now, exitGraceMs: 0 });
    return { g, log, exit, stopServer };
  }
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('logs a single unhandled rejection and keeps running', async () => {
    const { g, log, exit } = guards(() => 1000);
    g.onUnhandledRejection(Object.assign(new Error('floating'), { code: 'ECONNRESET' }));
    await tick();
    expect(exit).not.toHaveBeenCalled();
    const line = log.calls.find((c) => c.message === 'Unhandled rejection');
    expect((line?.context?.error as Record<string, string>).code).toBe('ECONNRESET');
    expect((line?.context?.error as Record<string, string>).stack).toContain('floating');
  });

  it(`exits once ${REJECTION_STORM_LIMIT} rejections land within a minute, after stopping the listener`, async () => {
    let clock = 0;
    const { g, log, exit, stopServer } = guards(() => clock);
    for (let i = 1; i < REJECTION_STORM_LIMIT; i += 1) {
      clock += 1000;
      g.onUnhandledRejection(new Error('r' + i));
    }
    await tick();
    expect(exit).not.toHaveBeenCalled();
    clock += 1000;
    g.onUnhandledRejection(new Error('the tenth'));
    await tick();
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.calls.some((c) => /Rejection storm/.test(c.message))).toBe(true);
  });

  it('does not count rejections older than the window', async () => {
    let clock = 0;
    const { g, exit } = guards(() => clock);
    for (let i = 0; i < REJECTION_STORM_LIMIT * 3; i += 1) {
      clock += 7_000; // one every 7 s: never ten inside 60 s
      g.onUnhandledRejection(new Error('slow'));
    }
    await tick();
    expect(exit).not.toHaveBeenCalled();
  });

  it('an uncaught exception is logged with its stack and exits exactly once', async () => {
    const { g, log, exit } = guards(() => 0);
    g.onUncaughtException(new TypeError('boom'));
    g.onUncaughtException(new TypeError('boom again'));
    await tick();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const line = log.calls.find((c) => /Uncaught exception/.test(c.message));
    expect((line?.context?.error as Record<string, string>).stack).toContain('TypeError: boom');
  });
});

describe('serializeError and redactSecrets', () => {
  it('keeps name, message, code and stack, and redacts credentials and keys', () => {
    const err = Object.assign(new Error('connect to postgresql://eco:s3cr3t-pass@10.0.0.5/db failed; key sk_live_abc123XYZ'), { code: 'ECONNREFUSED' });
    const out = serializeError(err);
    expect(out.name).toBe('Error');
    expect(out.code).toBe('ECONNREFUSED');
    expect(out.message).toBe('connect to postgresql://[redacted]@10.0.0.5/db failed; key [redacted]');
    expect(out.stack).not.toContain('s3cr3t-pass');
    expect(redactSecrets('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer [redacted]');
    expect(redactSecrets('whsec_123abc and https://ecoauditor.io/pricing')).toBe('[redacted] and https://ecoauditor.io/pricing');
  });

  it('turns a non-Error into a message only', () => {
    expect(serializeError('plain string')).toEqual({ message: 'plain string' });
  });
});
