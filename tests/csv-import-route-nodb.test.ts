// @vitest-environment node
/**
 * K4 routes through a REAL spawned server with no database (dev auth; no Docker,
 * tests/helpers/spawn-server.ts). There is no in-memory store any more (F-G-07):
 * without a database every import route answers 503 and stores nothing, and none
 * is reachable without a signed-in caller.
 *
 * What this file used to run on sample data runs on real Postgres (Docker): the
 * dry run, the commit, the 409 for a file imported before, the history and an
 * undo that shows on the dashboard at once in tests/csv-import-route.test.ts;
 * the unit conversion /api/calculate and /api/entries share with the importer
 * in tests/entries-write-api.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Spawned } from './helpers/spawn-server';

const SECRET = 'k4-csv-dev-secret';
const FILE = [
  'scope,category,source,amount,unit,date',
  'Scope 1,stationary_combustion,natural_gas,"1,000",ccf,2025-03-31',
  'Scope 2,purchased_electricity,CAMX,10000,kWh,2025-03-31',
].join('\n');

type Json = Record<string, unknown>;
let server: Spawned;

function api(method: string, path: string, body?: string | Json, headers: Record<string, string> = {}): Promise<Response> {
  const text = typeof body === 'string';
  return fetch(`${server.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRET}`,
      ...(body === undefined ? {} : { 'content-type': text ? 'text/csv' : 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : text ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = await startServer({ ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: SECRET, DEV_COMPANY_ID: 'test-company-1' });
}, 60_000);

afterAll(() => server?.stop());

describe('the CSV import over HTTP, without a database', () => {
  it('every route needs a signed-in caller', async () => {
    for (const [method, path] of [['POST', '/api/ingest/csv'], ['GET', '/api/ingest/imports'], ['POST', '/api/ingest/imports/1/undo']]) {
      const res = await fetch(`${server.base}${path}`, { method });
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
    }
  });

  it('the dry run, the commit, the history and the undo answer 503 and store nothing', async () => {
    for (const [method, path, body, headers] of [
      ['POST', '/api/ingest/csv?dry_run=1&filename=q1.csv', FILE, {}],
      ['POST', '/api/ingest/csv?filename=q1.csv', FILE, { 'idempotency-key': 'k4-nodb-upload-0001' }],
      ['GET', '/api/ingest/imports', undefined, {}],
      ['POST', '/api/ingest/imports/1/undo', {}, {}],
    ] as Array<[string, string, string | Json | undefined, Record<string, string>]>) {
      const res = await api(method, path, body, headers);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 503 });
    }
  });

  it('/api/calculate and POST /api/entries answer 503 too: the plan check reads the database', async () => {
    const gas = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'ccf', activity_date: '2025-05-31' };
    expect((await api('POST', '/api/calculate', { entries: [gas] })).status).toBe(503);
    expect((await api('POST', '/api/entries', gas)).status).toBe(503);
  });
});
