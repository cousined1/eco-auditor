/**
 * RA-RT-02 (Medium) + UXE-001 (High) — audit run AUDIT-RUN-20260919-001828-7455,
 * branch fix/audit-20260922.
 *
 * POST /api/leads abuse controls + the post-fix persistence contract, against
 * spawned real servers:
 *   - honeypot field fill -> 400 before any write;
 *   - per-route limiter (5 per 10 min, server.cjs leadsRateLimit) -> 429;
 *   - UXE-001: with a live pgPool and NODE_ENV=production, a failed INSERT
 *     must answer 500 (writeLead rethrows — the .data/ JSON fallback is
 *     deliberately dev-only) and the process must survive;
 *   - dev fallback branch: NODE_ENV=development + failed INSERT still returns
 *     200 via .data/leads.json (documented dev-only contract).
 *
 * Production + unreachable DATABASE_URL cannot boot (probeDatabase at boot),
 * so the production persistence failure is induced by dropping public.leads
 * while the server holds a healthy pool — the INSERT fails inside writeLead
 * exactly as a real store failure would.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  pgUrl,
  psql,
  registerExitSafety,
  spawnServer,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = 'fix-tests-pg-leads';
const PG_PORT = 54395;
const LEADS_FILE = resolve(__dirname, '..', '.data', 'leads.json');

const cleanup = new E2eCleanup();
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

function leadsFileCount(): number {
  if (!existsSync(LEADS_FILE)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(LEADS_FILE, 'utf8')) as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

async function leadsRowCount(): Promise<number> {
  const out = await psql(CONTAINER, 'SELECT count(*)::int::text FROM public.leads');
  return parseInt(out, 10);
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    await dockerRunPg(CONTAINER, PG_PORT);
    await applySchema(CONTAINER);

    // Dev server with a live data store: honeypot, sanitization, persistence.
    const dev = spawnServer(8779, e2eEnv({ DATABASE_URL: pgUrl(PG_PORT) }));
    cleanup.track(dev.child);
    await waitForServer(dev);
    baseDev = dev.base;

    // Isolated server for the rate-limiter bucket so other tests cannot share
    // (or exhaust) the same 5-per-10-minutes key.
    const rate = spawnServer(8780, e2eEnv({ DATABASE_URL: pgUrl(PG_PORT) }));
    cleanup.track(rate.child);
    await waitForServer(rate);
    baseRate = rate.base;

    // Production instance: pgPool configured and reachable (boot probe passes),
    // used for the UXE-001 persistence-failure contract.
    const prod = spawnServer(8781, e2eEnv({
      NODE_ENV: 'production',
      DATABASE_URL: pgUrl(PG_PORT),
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
  it('dev fallback: a failed INSERT still answers 200 via .data/leads.json (dev-only contract)', async () => {
    await psql(CONTAINER, 'DROP TABLE public.leads');
    const before = leadsFileCount();
    const res = await postLead(baseDev, validLead({ email: 'dev-fallback-e2e@example.com' }));
    // NODE_ENV=development: writeLead falls back to the JSON file instead of
    // rethrowing — the documented dev behavior.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Lead captured successfully' });
    expect(leadsFileCount()).toBeGreaterThan(before);
  }, 30_000);

  it('production: a failed INSERT answers 500 (never a false 200) and the process survives', async () => {
    // public.leads is still dropped by the previous test, so the INSERT inside
    // writeLead fails while pgPool itself is healthy.
    const before = leadsFileCount();
    const res = await postLead(baseProd, validLead({ email: 'prod-fail-e2e@example.com' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Failed to capture lead. Please try again.',
    });
    // The rethrow means the dev-only fallback file was never touched.
    expect(leadsFileCount()).toBe(before);

    // The old bug was an unhandledRejection that killed the whole process at
    // the Express 4 boundary; the server must still be serving.
    const health = await fetch(`${baseProd}/api/health`);
    expect(health.status).toBe(200);
    expect(childProd?.exitCode ?? null).toBeNull(); // process alive
  }, 30_000);
});
