// @vitest-environment node
/**
 * K2 routes against a REAL spawned server with no database (dev auth; no Docker,
 * see tests/helpers/spawn-server.ts). There is no in-memory sample data any more
 * (F-G-07): without a database the plan check and the tenant lookup cannot run,
 * so every entry route answers 503 and stores nothing, and none is reachable
 * without a signed-in caller.
 *
 * What this file used to run on sample data runs on real Postgres, with trials,
 * subscriptions, tenants and concurrent requests, in tests/entries-write-api.test.ts
 * (Docker): server-computed values, the dashboard at once, Scope 3 and relabelled
 * categories, the activity date, Idempotency-Key, edits, deletes and tenant isolation.
 * A row saved before activity data was recorded: tests/entry-edit-route.test.ts.
 *
 * Before K2 none of these routes existed: POST /api/entries answered 404 and the
 * calculator wrote straight through the records API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Spawned } from './helpers/spawn-server';

const SECRET = 'k2-entries-dev-secret';
const CAMX = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-03-15' };

let server: Spawned;

function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${server.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${SECRET}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = await startServer({ ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: SECRET, DEV_COMPANY_ID: 'test-company-1' });
}, 60_000);

afterAll(() => server?.stop());

describe('the entry routes without a database', () => {
  it('list, create, edit and delete answer 503; the old sample rows are not served', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/entries', undefined],
      ['POST', '/api/entries', CAMX],
      ['PATCH', '/api/entries/1', { amount: 1300 }],
      ['DELETE', '/api/entries/1', undefined],
      ['GET', '/api/emissions/summary?period=2025', undefined],
    ] as Array<[string, string, unknown]>) {
      const res = await api(method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 503 });
      expect(await res.text()).not.toMatch(/seed-1|Green Table Foods/);
    }
  });

  it('every route needs a signed-in caller', async () => {
    for (const [method, path] of [['GET', '/api/entries'], ['POST', '/api/entries'], ['PATCH', '/api/entries/1'], ['DELETE', '/api/entries/1']]) {
      const res = await fetch(`${server.base}${path}`, { method });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
    }
  });
});
