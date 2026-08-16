import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

// AF-2 — /api/health (and /health) must report status and DB state, and
// send Cache-Control: no-store so cached health never defeats its purpose.
// Build SHA/uptime were removed from the public response to avoid build
// fingerprint disclosure (security audit 2026-08-15).

const ROOT = path.resolve(__dirname, '..');

function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

let child: ChildProcess | null = null;
let baseUrl = '';

function waitForServer(url: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`server did not start within ${timeoutMs}ms`));
        return;
      }
      fetch(`${url}/api/health`)
        .then((r) => {
          if (r.ok) resolve();
          else setTimeout(probe, 150);
        })
        .catch(() => setTimeout(probe, 150));
    }
    probe();
  });
}

describe('AF-2 — /api/health and /health endpoint contract', () => {
  beforeAll(async () => {
    const port = randomPort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn('node', ['server.cjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        INSFORGE_URL: '',
        NEXT_PUBLIC_INSFORGE_URL: '',
        INSFORGE_BASE_URL: '',
        VITE_INSFORGE_BASE_URL: '',
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr?.on('data', (d) => {
      process.stderr.write(`[server-health stderr] ${d}`);
    });
    await waitForServer(baseUrl);
  }, 15000);

  afterAll(() => {
    if (child) {
      child.kill('SIGTERM');
      child = null;
    }
  });

  it('/api/health returns HTTP 200', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    expect(r.status).toBe(200);
  });

  it('/api/health body has status "ok" and db "not configured"', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    const body = await r.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('not configured');
    // sha/build/uptime removed for security — must not be present
    expect(body.sha).toBeUndefined();
    expect(body.build).toBeUndefined();
    expect(body.uptime).toBeUndefined();
  });

  it('/api/health response includes Cache-Control: no-store', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    const cc = r.headers.get('cache-control');
    expect(cc).toBeTruthy();
    expect(cc!.toLowerCase()).toContain('no-store');
  });

  it('/health (alias) returns 200 with the same status + no-store contract', async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('ok');
    const cc = r.headers.get('cache-control');
    expect(cc).toBeTruthy();
    expect(cc!.toLowerCase()).toContain('no-store');
  });
});
