/**
 * VERIFY-FINAL-DATA D-1 — a facility deleted while an entry or a CSV import names
 * it, through the real Express routes and a real Postgres (every repo migration
 * applied). Docker: one throwaway container (tests/e2e-helpers.ts); run by
 * explicit path.
 *
 * DELETE /api/companies/:id/facilities/:facilityId (server-company-routes.cjs
 * removeFacility) locks the facility row FOR UPDATE, counts its entries and
 * deletes. Before the fix an entry write only SELECTed the facility, and the CSV
 * commit read the file's facilities before its transaction, so a delete that
 * committed in between failed the rows' foreign key (SQLSTATE 23503): a 500 for
 * an entry, a 503 for a CSV commit. The data stayed correct, the answer did not.
 *
 * Two kinds of test:
 *   - "held delete": a psql session plays the delete's transaction (lock FOR
 *     UPDATE, hold, DELETE, COMMIT) while the API call arrives, so the race is
 *     the same every run;
 *   - "racing": the two real routes in parallel, PAIRS times each. Whatever the
 *     interleaving, an answer is a 2xx, 400 or 409, and never a 5xx.
 *
 * One tenant (race, an active Growth subscription: no import quota).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  registerExitSafety,
  runCapture,
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-facility-race');
const USER = { id: '91000000-0000-4000-8000-000000000009', email: 'd1-race@example.com' };
const TOKEN = 'd1-token-race';
const PAIRS = 15;
const HOLD_SECONDS = 1.5;

const CAMX = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-03-15' };
const FACILITY_ERROR = 'facility_id is not one of your facilities.';
const GONE_WARNING = '1 row (line 2) names a facility that was deleted while the file was being imported: imported without a facility.';

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
let companyId = '';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function api(method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': contentType }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function json(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

async function count(sql: string): Promise<number> {
  return Number(await psql(CONTAINER, `SELECT count(*)::int::text FROM ${sql}`));
}

async function newFacility(name: string): Promise<string> {
  return psql(
    CONTAINER,
    `WITH f AS (INSERT INTO public.facilities (company_id, name, type, city) VALUES (${companyId}, '${name}', 'factory', 'Fresno') RETURNING id) SELECT id FROM f`
  );
}

const csvOf = (...rows: string[]) => ['scope,category,source,amount,unit,date,facility_name', ...rows].join('\n') + '\n';
const gasRow = (amount: number, facility: string) => `Scope 1,stationary_combustion,natural_gas,${amount},therms,2025-01-31,${facility}`;

/**
 * The delete route's transaction, held open after it locked the facility row: runs
 * `during` once the lock is held, then waits for the delete to commit.
 */
async function whileDeleteIsHeld(facility: string, during: () => Promise<void>): Promise<void> {
  const held = runCapture(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    {
      input: `BEGIN;\nSELECT id FROM public.facilities WHERE id = ${facility} FOR UPDATE;\nSELECT pg_sleep(${HOLD_SECONDS});\nDELETE FROM public.facilities WHERE id = ${facility};\nCOMMIT;\n`,
      timeoutMs: 60_000,
    }
  ).catch((err: Error) => ({ code: -1, stdout: '', stderr: err.message }));
  let failure: unknown = null;
  try {
    // The sleep is the running statement only once the row is locked.
    for (let tries = 0; (await psql(CONTAINER, `SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE 'SELECT pg_sleep(%'`)) !== '1'; tries++) {
      if (tries > 100) throw new Error('the held delete never reached its sleep');
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    await during();
  } catch (err) {
    failure = err;
  }
  const result = await held; // the delete commits after the hold, whether or not the call above failed
  if (failure) throw failure;
  if (result.code !== 0) throw new Error(`held delete failed: ${result.stderr}`);
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ('${USER.id}', '${USER.email}')`);
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at, subscription_status, subscription_plan, subscription_current_period_end)
       VALUES ('${USER.id}', 'D1 Race Co', 'other', now() - interval '1 day', 'active', 'growth', now() + interval '30 days')`
    );
    companyId = await psql(CONTAINER, `SELECT id::text FROM public.companies WHERE user_id = '${USER.id}'`);

    // Stand-in for InsForge's GET /api/auth/sessions/current (what authGuard calls).
    mockInsforge = http.createServer((req, res) => {
      if (req.headers.authorization === `Bearer ${TOKEN}` && (req.url || '').startsWith('/api/auth/sessions/current')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ user: { id: USER.id, email: USER.email } }));
        return;
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
    });
    await new Promise<void>((resolveMock) => { mockInsforge!.listen(0, '127.0.0.1', () => resolveMock()); });

    const spawned = spawnServer(await freePort(), e2eEnv({
      NODE_ENV: 'production',
      DATABASE_URL: pgUrl(pgPort),
      INSFORGE_BASE_URL: `http://127.0.0.1:${(mockInsforge.address() as { port: number }).port}`,
    }));
    cleanup.track(spawned.child);
    base = spawned.base;
    await waitForServer(spawned);
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 180_000);

afterAll(async () => {
  if (mockInsforge) {
    try { mockInsforge.close(); } catch { /* already closed */ }
  }
  await cleanup.teardown();
});

describe('an entry write while the facility it names is being deleted', () => {
  it('a new entry waits for the delete, finds the facility gone and is 400, not 500; nothing is stored', async () => {
    const facility = await newFacility('Held Plant A');
    let res!: Response;
    await whileDeleteIsHeld(facility, async () => { res = await api('POST', '/api/entries', { ...CAMX, facility_id: Number(facility) }); });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ success: false, error: FACILITY_ERROR });
    expect(await count(`public.facilities WHERE id = ${facility}`)).toBe(0);
    expect(await count(`public.emission_entries WHERE company_id = ${companyId}`)).toBe(0);
  }, 60_000);

  it('an edit that moves an entry to that facility is 400, not 500, and the entry keeps its facility', async () => {
    const created = await api('POST', '/api/entries', CAMX);
    expect(created.status).toBe(201);
    const entry = String((await json(created)).data.id);
    const facility = await newFacility('Held Plant B');
    let res!: Response;
    await whileDeleteIsHeld(facility, async () => { res = await api('PATCH', `/api/entries/${entry}`, { facility_id: Number(facility) }); });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ success: false, error: FACILITY_ERROR });
    expect(await psql(CONTAINER, `SELECT (facility_id IS NULL)::text FROM public.emission_entries WHERE id = ${entry}`)).toBe('true');
    expect((await api('DELETE', `/api/entries/${entry}`)).status).toBe(200);
  }, 60_000);

  it(`${PAIRS} writes racing their facility's delete: each pair is 201 + 409 (write first) or 400 + 200 (delete first), never a 5xx, no orphan`, async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const facility = await newFacility(`Entry Race ${i}`);
      const [write, removal] = await Promise.all([
        api('POST', '/api/entries', { ...CAMX, amount: 10 + i, facility_id: Number(facility) }),
        api('DELETE', `/api/companies/${companyId}/facilities/${facility}`),
      ]);
      outcomes.push(`${write.status}/${removal.status}`);
      // The facility is either gone (and the entry refused) or kept by its entry.
      expect(await count(`public.facilities WHERE id = ${facility}`)).toBe(write.status === 201 ? 1 : 0);
    }
    expect(outcomes.filter((outcome) => outcome !== '201/409' && outcome !== '400/200')).toEqual([]);
    expect(await count(`public.emission_entries e WHERE e.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = e.facility_id)`)).toBe(0);
  }, 120_000);
});

describe('a CSV commit while a facility the file names is being deleted', () => {
  it('the commit waits for the delete and imports the row without a facility, with a warning, instead of a 503', async () => {
    const facility = await newFacility('Held Csv Plant');
    let res!: Response;
    await whileDeleteIsHeld(facility, async () => {
      res = await api('POST', '/api/ingest/csv?filename=held.csv', csvOf(gasRow(321, 'Held Csv Plant')), 'text/csv');
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ success: true, imported: 1 });
    expect(body.warnings).toEqual([GONE_WARNING]);
    expect(await count(`public.facilities WHERE id = ${facility}`)).toBe(0);
    expect(await psql(CONTAINER, `SELECT concat_ws('|', count(*), count(*) FILTER (WHERE facility_id IS NULL)) FROM public.emission_entries WHERE import_id = ${body.import_id}`)).toBe('1|1');
  }, 60_000);

  it(`${PAIRS} imports racing their facility's delete: every import is 200; the facility is kept (409) exactly when a row names it`, async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const name = `Csv Race ${i}`;
      const facility = await newFacility(name);
      const [imported, removal] = await Promise.all([
        api('POST', `/api/ingest/csv?filename=race-${i}.csv`, csvOf(gasRow(100 + i, name)), 'text/csv'),
        api('DELETE', `/api/companies/${companyId}/facilities/${facility}`),
      ]);
      outcomes.push(`${imported.status}/${removal.status}`);
      const named = await count(`public.emission_entries WHERE facility_id = ${facility}`);
      expect(removal.status === 409, `pair ${i}: the facility is kept exactly when a row names it`).toBe(named === 1);
    }
    expect(outcomes.filter((outcome) => outcome !== '200/200' && outcome !== '200/409')).toEqual([]);
    expect(await count(`public.emission_entries e WHERE e.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = e.facility_id)`)).toBe(0);
  }, 120_000);
});
