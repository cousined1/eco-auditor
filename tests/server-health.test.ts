import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

// AF-2 — /api/health (and /health) must self-report the build SHA from env and
// send Cache-Control: no-store so cached health never defeats its purpose
// (godmythos HR #22/#25). See `.omo/impl-spec.md` AF-2.
//
// Approach: spawn `node server.cjs` as a child process with a random PORT and
// GIT_SHA=testsha123, then fetch the endpoints. No new deps (no supertest) —
// uses Node's built-in fetch (Node 22) and child_process.

const ROOT = path.resolve(__dirname, '..');
const TEST_SHA = 'testsha123';

// ponytail: pick a random high port to avoid collisions with a running dev server.
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
        GIT_SHA: TEST_SHA,
        // Avoid accidental DB connection attempts during the test.
        INSFORGE_URL: '',
        NEXT_PUBLIC_INSFORGE_URL: '',
        INSFORGE_BASE_URL: '',
        VITE_INSFORGE_BASE_URL: '',
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Surface server stderr if it crashes before we can probe.
    child.stderr?.on('data', (d) => {
      // Only log on failure to keep output clean; the probe timeout will reject.
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

  it('/api/health body has status "ok" and sha equal to the GIT_SHA env value', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    const body = await r.json();
    expect(body.status).toBe('ok');
    // sha must be self-reported from env (GIT_SHA), never hardcoded.
    expect(body.sha).toBe(TEST_SHA);
    // build alias mirrors /api/version (impl-spec AF-2).
    expect(body.build).toBe(TEST_SHA);
    expect(body.db).toBe('not configured');
  });

  it('/api/health response includes Cache-Control: no-store', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    const cc = r.headers.get('cache-control');
    expect(cc).toBeTruthy();
    expect(cc!.toLowerCase()).toContain('no-store');
  });

  it('/health (alias) returns 200 with the same sha + no-store contract', async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sha).toBe(TEST_SHA);
    const cc = r.headers.get('cache-control');
    expect(cc).toBeTruthy();
    expect(cc!.toLowerCase()).toContain('no-store');
  });

  it('/features redirects permanently to the homepage feature section', async () => {
    const response = await fetch(`${baseUrl}/features`, { redirect: 'manual' });

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/#features');
  });
});
