/**
 * Spawns a REAL `node server.cjs` for tests that need the whole HTTP stack, with
 * no Docker and no database:
 *
 *   startServer()                      no DATABASE_URL: every data route answers 503
 *   startServer({}, { fakePg: 'ok' })  a fake pool (tests/helpers/fake-pg-preload.cjs)
 *                                      that records lead INSERTs
 *   startServer({}, { fakePg: 'down' })a fake pool whose every query fails, like an
 *                                      unreachable database
 *   startServer({}, { fakePg: 'data-down' })
 *                                      company and billing reads answer, every other
 *                                      statement fails (auth passes, the data does not)
 *
 * Deliberately independent of the Docker-based e2e helper module, which starts
 * containers with fixed names and ports. Every server gets an OS-assigned free port.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const PRELOAD = path.resolve(__dirname, 'fake-pg-preload.cjs');

export type LogLine = Record<string, unknown> & { level?: string; message?: string };

export interface Spawned {
  base: string;
  child: ChildProcess;
  /** Every JSON log line the server has written so far (stdout and stderr). */
  logs: LogLine[];
  /** The raw stdout + stderr text, for "this must never appear" assertions. */
  rawLog: () => string;
  /** Lead INSERTs recorded by the fake pool. */
  dbLog: () => Array<{ table: string; params: unknown[] }>;
  stop: () => void;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Polls `read` until it returns something truthy; throws on timeout. */
export async function waitFor<T>(read: () => T | undefined | false, timeoutMs = 6000, what = 'condition'): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

export async function startServer(
  env: Record<string, string> = {},
  // preload: extra test-only modules loaded with --require before server.cjs.
  options: { fakePg?: 'ok' | 'down' | 'data-down'; preload?: string[] } = {},
): Promise<Spawned> {
  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), 'eco-spawned-server-'));
  const dbFile = path.join(dir, 'fake-pg.jsonl');
  const preloads = [...(options.fakePg ? [PRELOAD] : []), ...(options.preload ?? [])];
  const args = [...preloads.flatMap((file) => ['--require', file]), 'server.cjs'];

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      GIT_SHA: 'spawned-test-sha',
      RAILWAY_GIT_COMMIT_SHA: '',
      VERCEL_GIT_COMMIT_SHA: '',
      // With a fake pool a URL must exist for the server to build one; the
      // preload swaps `pg` out, so it is never contacted. Without one every
      // data route answers 503 (there is no in-memory data, F-G-07).
      DATABASE_URL: options.fakePg ? 'postgres://fake:fake@127.0.0.1:1/fake' : '',
      FAKE_PG_MODE: options.fakePg ?? '',
      FAKE_PG_LOG: dbFile,
      INSFORGE_URL: '',
      NEXT_PUBLIC_INSFORGE_URL: '',
      INSFORGE_BASE_URL: '',
      VITE_INSFORGE_BASE_URL: '',
      ALLOW_DEV_AUTH: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      CONSENT_IP_PEPPER: 'test-pepper',
      LEAD_NOTIFY_WEBHOOK_URL: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: LogLine[] = [];
  let raw = '';
  const onData = (chunk: Buffer) => {
    const text = String(chunk);
    raw += text;
    for (const line of text.split('\n')) {
      try { logs.push(JSON.parse(line) as LogLine); } catch { /* not a JSON log line */ }
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  };

  const started = Date.now();
  for (;;) {
    try {
      // 200 (healthy) and 503 (degraded, e.g. a database that is down) both
      // prove the listener is up.
      const r = await fetch(`${base}/api/health`);
      if (r.status === 200 || r.status === 503) break;
    } catch { /* not listening yet */ }
    if (child.exitCode !== null || Date.now() - started > 20_000) {
      const why = child.exitCode !== null ? 'exited early' : 'did not start in time';
      stop();
      throw new Error(`server ${why}:\n${raw.slice(-1500)}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    base,
    child,
    logs,
    rawLog: () => raw,
    dbLog: () =>
      existsSync(dbFile)
        ? readFileSync(dbFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { table: string; params: unknown[] })
        : [],
    stop,
  };
}

export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
