// @vitest-environment node
/**
 * F-G-18: the hand-rolled gzip middleware (server-compression.cjs), against a
 * real in-process Express app over 127.0.0.1. Raw node:http requests, so the
 * client neither adds nor strips an encoding by itself.
 */
import { createRequire } from 'node:module';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const { acceptsGzip, createCompression } = require('../server-compression.cjs');

type LogCall = { level: string; message: string; context?: Record<string, unknown> };
type Res = {
  type: (t: string) => Res;
  send: (b: string) => void;
  write: (c: Buffer | string) => boolean;
  end: (c?: string) => void;
  once: (e: string, f: () => void) => void;
};

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const TEXT = 'Eco-Auditor compressible text. '.repeat(200); // about 6 KB

function makeApp(options: { createGzip?: () => zlib.Gzip } = {}) {
  const calls: LogCall[] = [];
  const log = (level: string, message: string, context?: Record<string, unknown>) => calls.push({ level, message, ...(context ? { context } : {}) });
  const app = express();
  app.use(createCompression({ log, ...options }));
  app.get('/text', (_req: unknown, res: Res) => res.type('text/plain').send(TEXT));
  return { app, calls };
}

async function listen(app: { listen: (port: number, host: string, cb: () => void) => Server }): Promise<string> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    servers.push(server);
  });
}

function request(url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('acceptsGzip: Accept-Encoding with q-values (RFC 9110 12.5.3)', () => {
  it.each([
    ['gzip, deflate, br', true],
    ['gzip', true],
    ['GZIP;Q=1', true],
    ['x-gzip', true],
    ['*', true],
    ['br;q=1, gzip;q=0.8', true],
    ['deflate, gzip;q=0.9', true],
    ['gzip;q=0', false],
    ['gzip;q=0, identity', false],
    ['gzip;q=0.0', false],
    ['gzip;q=0.5, identity', false],
    ['gzip;q=0.8, identity;q=0.9', false],
    ['identity', false],
    ['*;q=0', false],
    ['deflate, br', false],
    ['gzip;q=abc', false],
    ['', false],
  ])('%j -> %s', (header, expected) => {
    expect(acceptsGzip(header)).toBe(expected);
  });

  it('treats a missing header as no gzip', () => {
    expect(acceptsGzip(undefined)).toBe(false);
  });
});

describe('the middleware over HTTP', () => {
  it('compresses when gzip is accepted, and not when it is refused with q=0', async () => {
    const { app } = makeApp();
    const base = await listen(app);

    const gz = await request(`${base}/text`, { headers: { 'accept-encoding': 'gzip, deflate' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.headers.vary).toContain('Accept-Encoding');
    expect(zlib.gunzipSync(gz.body).toString()).toBe(TEXT);

    const refused = await request(`${base}/text`, { headers: { 'accept-encoding': 'gzip;q=0, identity' } });
    expect(refused.headers['content-encoding']).toBeUndefined();
    expect(refused.body.toString()).toBe(TEXT);
  });

  it('keeps the HEAD and Range exclusions', async () => {
    const { app } = makeApp();
    const base = await listen(app);
    const head = await request(`${base}/text`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
    expect(head.headers['content-encoding']).toBeUndefined();
    const ranged = await request(`${base}/text`, { headers: { 'accept-encoding': 'gzip', range: 'bytes=0-99' } });
    expect(ranged.headers['content-encoding']).toBeUndefined();
  });

  it('respects backpressure: write() reports a full gzip buffer and "drain" follows', async () => {
    const { app } = makeApp();
    const accepted: boolean[] = [];
    let drained = false;
    app.get('/big', (_req: unknown, res: Res) => {
      res.type('text/plain');
      const ok = res.write(Buffer.alloc(256 * 1024, 'a'));
      accepted.push(ok);
      if (ok) return res.end();
      res.once('drain', () => {
        drained = true;
        res.end();
      });
      return undefined;
    });
    const base = await listen(app);

    const res = await request(`${base}/big`, { headers: { 'accept-encoding': 'gzip' } });
    expect(accepted).toEqual([false]);
    expect(drained).toBe(true);
    expect(zlib.gunzipSync(res.body).length).toBe(256 * 1024);
  });

  it('a large piped body arrives whole (the piped source is not left waiting for a drain)', async () => {
    const { app } = makeApp();
    app.get('/piped', (_req: unknown, res: Res & NodeJS.WritableStream) => {
      res.type('text/plain');
      Readable.from((function* () {
        for (let i = 0; i < 200; i += 1) yield Buffer.alloc(16 * 1024, String(i % 10));
      })()).pipe(res);
    });
    const base = await listen(app);
    const res = await request(`${base}/piped`, { headers: { 'accept-encoding': 'gzip' } });
    expect(zlib.gunzipSync(res.body).length).toBe(200 * 16 * 1024);
  });

  it('a zlib error fails that one response and is logged, not an uncaught exception', async () => {
    const { app, calls } = makeApp({
      createGzip: () => {
        const stream = zlib.createGzip();
        setImmediate(() => stream.destroy(new Error('simulated zlib failure')));
        return stream;
      },
    });
    const base = await listen(app);
    await request(`${base}/text`, { headers: { 'accept-encoding': 'gzip' } }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    const failure = calls.find((c) => c.message === 'Response compression failed');
    expect(failure?.level).toBe('error');
    expect(String(failure?.context?.error)).toContain('simulated zlib failure');
    // The server (this test process) is still serving.
    expect((await request(`${base}/text`, { headers: { 'accept-encoding': 'identity' } })).status).toBe(200);
  });

  it('a handler that writes after end() is logged instead of taking the process down', async () => {
    const { app, calls } = makeApp();
    app.get('/late-write', (_req: unknown, res: Res) => {
      res.type('text/plain');
      res.end(TEXT);
      res.write('too late');
    });
    const base = await listen(app);
    await request(`${base}/late-write`, { headers: { 'accept-encoding': 'gzip' } }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.message === 'Response compression failed')).toBe(true);
    expect((await request(`${base}/text`)).status).toBe(200);
  });
});
