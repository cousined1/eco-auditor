/**
 * RA-RT-02 (Medium) + UXE-001 (High) — audit run AUDIT-RUN-20260919-001828-7455,
 * branch fix/audit-20260922.
 *
 * POST /api/leads abuse controls + the post-fix persistence contract, against
 * spawned real servers:
 *   - honeypot field fill -> 400 before any write;
 *   - per-route limiter (5 per 10 min, server.cjs leadsRateLimit) -> 429;
 *   - UXE-001 + F-G-12: a failed INSERT answers 503 in development and in
 *     production alike (writeLead rethrows; the JSON file the development server
 *     used to fall back to is gone), and the process must survive.
 *
 * Production + unreachable DATABASE_URL cannot boot (probeDatabase at boot),
 * so the persistence failure is induced by dropping public.leads while the
 * servers hold a healthy pool — the INSERT fails inside writeLead exactly as a
 * real store failure would.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  registerExitSafety,
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-leads');

const cleanup = new E2eCleanup();
let pgPort = 0;
let baseDev = '';
let baseRate = '';
let baseProd = '';
let childProd: ChildProcess | null = null;

function validLead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'E2E Wave5', email: 'leads-e2e@example.com', message: 'integration test lead', ...overrides };
}

async function postLead(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function leadsRowCount(): Promise<number> {
  const out = await psql(CONTAINER, 'SELECT count(*)::int::text FROM public.leads');
  return parseInt(out, 10);
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    // Dev server with a live data store: honeypot, sanitization, persistence.
    const dev = spawnServer(await freePort(), e2eEnv({ DATABASE_URL: pgUrl(pgPort) }));
    cleanup.track(dev.child);
    await waitForServer(dev);
    baseDev = dev.base;

    // Isolated server for the rate-limiter bucket so other tests cannot share
    // (or exhaust) the same 5-per-10-minutes key.
    const rate = spawnServer(await freePort(), e2eEnv({ DATABASE_URL: pgUrl(pgPort) }));
    cleanup.track(rate.child);
    await waitForServer(rate);
    baseRate = rate.base;

    // Production instance: pgPool configured and reachable (boot probe passes),
    // used for the UXE-001 persistence-failure contract.
    const prod = spawnServer(await freePort(), e2eEnv({
      NODE_ENV: 'production',
      DATABASE_URL: pgUrl(pgPort),
    }));
    cleanup.track(prod.child);
    childProd = prod.child;
    await waitForServer(prod);
    baseProd = prod.base;
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 180_000);

afterAll(async () => {
  await cleanup.teardown();
});

describe('RA-RT-02 — /api/leads route-level abuse controls', () => {
  it('a filled honeypot field is rejected with 400 before any write', async () => {
    const before = await leadsRowCount();
    const res = await postLead(baseDev, {
      name: 'Bot Bot',
      email: 'bot@example.com',
      website: 'http://spam.example',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid submission' });
    expect(await leadsRowCount()).toBe(before);
  }, 30_000);

  it('a payload without email is rejected by the sanitizer with 400', async () => {
    const res = await postLead(baseDev, { name: 'No Email' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/email/i);
  }, 30_000);

  it('a valid lead answers 200 and is durably persisted in public.leads', async () => {
    const res = await postLead(baseDev, validLead());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Lead captured successfully' });
    const stored = await psql(
      CONTAINER,
      `SELECT email || '|' || source FROM public.leads WHERE email = 'leads-e2e@example.com' ORDER BY id DESC LIMIT 1`
    );
    expect(stored).toBe('leads-e2e@example.com|api');
  }, 30_000);
});

describe('RA-RT-02 — per-route rate limiter (5 per 10 minutes)', () => {
  it('allows the first 5 requests and answers 429 with Retry-After on the 6th', async () => {
    const honeypot = { name: 'Bot Bot', email: 'bot@example.com', website: 'http://spam.example' };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await postLead(baseRate, honeypot)).status);
    }
    // The first 5 pass the limiter (the handler answers its own 400 for the
    // honeypot); the 6th is rate-limited before the handler runs.
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    const limited = await postLead(baseRate, honeypot);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  }, 30_000);
});

describe('UXE-001 — persistence-failure contract for /api/leads', () => {
  it('development: a failed INSERT answers 503 too; there is no file fallback any more (F-G-12)', async () => {
    await psql(CONTAINER, 'DROP TABLE public.leads');
    const res = await postLead(baseDev, validLead({ email: 'dev-fail-e2e@example.com' }));
    // It used to answer 200 after writing the lead to a JSON file nobody read.
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to capture lead. Please try again.' });
  }, 30_000);

  it('production: a failed INSERT answers 503 (never a false 200) and the process survives', async () => {
    // public.leads is still dropped by the previous test, so the INSERT inside
    // writeLead fails while pgPool itself is healthy.
    const res = await postLead(baseProd, validLead({ email: 'prod-fail-e2e@example.com' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Failed to capture lead. Please try again.',
    });

    // The old bug was an unhandledRejection that killed the whole process at
    // the Express 4 boundary; the server must still be serving.
    const health = await fetch(`${baseProd}/api/health`);
    expect(health.status).toBe(200);
    expect(childProd?.exitCode ?? null).toBeNull(); // process alive
  }, 30_000);
});
