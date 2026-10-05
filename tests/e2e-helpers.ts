/**
 * Shared spawn/docker/psql helpers for the Wave-5 server regression suites
 * (RT-01/RT-02/RT-03, RA-RT-02, SVR-01/SVR-R1/SVR-02, UXE-001/UXE-006).
 *
 * Design rules (per the audit task constraints):
 *  - one-shot, self-terminating: every suite owns its own throwaway Postgres
 *    container (unique name + port) and tears it down in afterAll AND on
 *    every failure path (try/finally in beforeAll + an 'exit' safety hook);
 *  - spawned `node server.cjs` children are tracked and force-killed
 *    (taskkill /F /T on Windows) so no server outlives the test run;
 *  - no shell string interpolation: every child process gets argument arrays,
 *    so SQL and env values can never smuggle shell syntax.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
// Creates the InsForge auth prerequisites (auth schema, auth.users,
// auth.uid(), roles) the repo migrations expect, for throwaway test databases only.
const BOOTSTRAP_SQL = resolve(REPO_ROOT, 'tests/fixtures/insforge-auth-bootstrap.sql');

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCapture(
  cmd: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      reject(new Error(`${cmd} ${args.join(' ')} timed out after ${opts.timeoutMs ?? 30_000}ms`));
    }, opts.timeoutMs ?? 30_000);
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input, 'utf8');
    else child.stdin?.end();
  });
}

export function killTree(child: ChildProcess | null | undefined): void {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  if (!child.pid) return;
  try {
    // SIGTERM is enough on POSIX; on Windows force-kill the whole tree so the
    // spawned server can never leak past the test run.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    }
  } catch { /* already gone */ }
}

/** Force-kills a PID even after the handle is lost (safety net). */
export function killPid(pid: number): void {
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' }); } catch { /* gone */ }
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

export interface SpawnedServer {
  child: ChildProcess;
  base: string;
  port: number;
  env: Record<string, string | undefined>;
}

export function spawnServer(port: number, env: Record<string, string | undefined>): SpawnedServer {
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: REPO_ROOT,
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logTail = '';
  child.stdout?.on('data', (d) => { logTail += String(d); });
  child.stderr?.on('data', (d) => { logTail += String(d); });
  (child as ChildProcess & { logTail?: () => string }).logTail = () => logTail;
  return { child, base: `http://127.0.0.1:${port}`, port, env };
}

/**
 * Polls /api/health until the listener answers at all — 200 (healthy) or 503
 * (degraded, e.g. an intentionally-unreachable DATABASE_URL) both prove the
 * server is up; connection errors keep polling.
 */
export async function waitForServer(spawned: SpawnedServer, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${spawned.base}/api/health`);
      if (res.status === 200 || res.status === 503) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) {
      const tail = ((spawned.child as ChildProcess & { logTail?: () => string }).logTail?.() || '').slice(-2000);
      throw new Error(`server on port ${spawned.port} did not start within ${timeoutMs}ms. Log tail:\n${tail}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Best-effort synchronous kill for process-exit safety nets. */
export function forceKillSync(child: ChildProcess | null | undefined): void {
  if (!child || !child.pid) return;
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }); } catch { /* gone */ }
  }
}

/** Tracks spawned servers + containers and tears everything down exactly once. */
export class E2eCleanup {
  private children: ChildProcess[] = [];
  private containers: string[] = [];
  private done = false;

  track(child: ChildProcess): ChildProcess {
    this.children.push(child);
    return child;
  }

  container(name: string): string {
    this.containers.push(name);
    return name;
  }

  async teardown(): Promise<void> {
    if (this.done) return;
    this.done = true;
    for (const child of this.children) forceKillSync(child);
    this.children = [];
    for (const name of this.containers) {
      try { await runCapture('docker', ['rm', '-f', name], { timeoutMs: 30_000 }); } catch { /* gone */ }
    }
    this.containers = [];
  }
}

export async function dockerRunPg(name: string, hostPort: number): Promise<void> {
  // Never reuse a stale container from a previous run.
  try { await runCapture('docker', ['rm', '-f', name], { timeoutMs: 30_000 }); } catch { /* not present */ }
  const res = await runCapture(
    'docker',
    ['run', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=e2e', '-p', `${hostPort}:5432`, 'postgres:16-alpine'],
    { timeoutMs: 120_000 }
  );
  if (res.code !== 0) throw new Error(`docker run ${name} failed: ${res.stderr}`);
}

export async function waitPgReady(name: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const res = await runCapture('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'], { timeoutMs: 20_000 });
    if (res.code === 0) return;
    if (Date.now() - start > timeoutMs) throw new Error(`pg container ${name} not ready in time: ${res.stderr}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Runs one statement; returns trimmed stdout (psql -tA). */
export async function psql(name: string, sql: string): Promise<string> {
  const res = await runCapture(
    'docker',
    ['exec', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql],
    { timeoutMs: 30_000 }
  );
  if (res.code !== 0) throw new Error(`psql failed (${res.code}): ${res.stderr}\nSQL: ${sql}`);
  return res.stdout.trim();
}

/** Feeds a SQL script (bootstrap + migrations) through stdin. */
export async function psqlFile(name: string, sql: string): Promise<void> {
  const res = await runCapture(
    'docker',
    ['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, timeoutMs: 60_000 }
  );
  if (res.code !== 0) throw new Error(`psql script failed (${res.code}): ${res.stderr}`);
}

/** Applies the InsForge bootstrap then every repo migration, in order. */
export async function applySchema(containerName: string): Promise<void> {
  await waitPgReady(containerName);
  await psqlFile(containerName, readFileSync(BOOTSTRAP_SQL, 'utf8'));
  const dir = resolve(REPO_ROOT, 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    await psqlFile(containerName, readFileSync(resolve(dir, file), 'utf8'));
  }
}

/** Common DATABASE_URL for a suite's throwaway container. */
export function pgUrl(hostPort: number): string {
  return `postgresql://postgres:e2e@127.0.0.1:${hostPort}/postgres`;
}

/**
 * Deterministic server env: everything server.cjs reads is set explicitly so
 * no ambient machine state can change what a spawned server does.
 */
export function e2eEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: 'development',
    APP_URL: 'http://127.0.0.1:8777',
    DATABASE_URL: '',
    INSFORGE_URL: '',
    NEXT_PUBLIC_INSFORGE_URL: '',
    INSFORGE_BASE_URL: '',
    VITE_INSFORGE_BASE_URL: '',
    ALLOW_DEV_AUTH: 'true',
    DEV_AUTH_SECRET: 'dev-e2e-secret',
    CONSENT_IP_PEPPER: 'test-pepper',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    VITE_STRIPE_PK: '',
    STRIPE_PK: '',
    STRIPE_PRICE_STARTER_MONTHLY: '',
    STRIPE_PRICE_STARTER_ANNUAL: '',
    STRIPE_PRICE_GROWTH_MONTHLY: '',
    STRIPE_PRICE_GROWTH_ANNUAL: '',
    STRIPE_PRICE_PRO_MONTHLY: '',
    STRIPE_PRICE_PRO_ANNUAL: '',
    VITE_STRIPE_PRICE_STARTER_MONTHLY: '',
    VITE_STRIPE_PRICE_STARTER_ANNUAL: '',
    VITE_STRIPE_PRICE_GROWTH_MONTHLY: '',
    VITE_STRIPE_PRICE_GROWTH_ANNUAL: '',
    VITE_STRIPE_PRICE_PRO_MONTHLY: '',
    VITE_STRIPE_PRICE_PRO_ANNUAL: '',
    GIT_SHA: 'e2e-wave5-tests',
    ...overrides,
  };
}

/** Registers a last-resort cleanup that runs even if the worker dies. */
export function registerExitSafety(cleanup: E2eCleanup): void {
  process.once('exit', () => { cleanup.teardown(); });
}
