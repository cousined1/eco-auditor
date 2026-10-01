/**
 * K5 (F-B-03 = F-C-03) — the company profile, first-run onboarding and facility
 * edits, through the real Express routes, a real Postgres (every repo migration
 * applied, including 20260930121000) and real bearer-token auth. Docker: one
 * throwaway container (tests/e2e-helpers.ts); run by explicit path.
 *
 * Before K5 none of these routes existed (GET /api/company and the PATCH/DELETE
 * routes answered 404): the server invented "<email-prefix> Organization" on the
 * first call and nothing could rename it, edit a facility, or tell the SPA that
 * onboarding was still pending.
 *
 * Tenants: fresh / dash / flow / skip (no company row: the first call provisions
 * one), real (a company created by SQL with a name of its own), a, b (two tenants
 * for the ownership checks), expired (trial over).
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
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-company');

const USERS = {
  fresh: { id: 'f1000000-0000-4000-8000-00000000000f', email: 'k5-fresh@example.com' },
  dash: { id: 'd1000000-0000-4000-8000-00000000000d', email: 'k5-dash@example.com' },
  flow: { id: 'c1000000-0000-4000-8000-00000000000c', email: 'k5-flow@example.com' },
  skip: { id: '51000000-0000-4000-8000-000000000005', email: 'k5-skip@example.com' },
  real: { id: '71000000-0000-4000-8000-000000000007', email: 'k5-real@example.com' },
  a: { id: 'a1000000-0000-4000-8000-00000000000a', email: 'k5-a@example.com' },
  b: { id: 'b1000000-0000-4000-8000-00000000000b', email: 'k5-b@example.com' },
  expired: { id: 'e1000000-0000-4000-8000-00000000000e', email: 'k5-expired@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `k5-token-${user}`;
const PROVISIONED_ON_FIRST_CALL: UserKey[] = ['fresh', 'dash', 'flow', 'skip'];

const GAS = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1200, unit: 'therms', activity_date: '2025-03-15' };

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
const company = {} as Record<UserKey, string>;

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function api(user: UserKey | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(user ? { authorization: `Bearer ${tokenOf(user)}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

async function overview(user: UserKey): Promise<Body> {
  const res = await api(user, 'GET', '/api/company');
  expect(res.status).toBe(200);
  return json(res);
}

async function count(sql: string): Promise<number> {
  return Number(await psql(CONTAINER, `SELECT count(*)::int::text FROM ${sql}`));
}

async function companyRow(user: UserKey, columns: string): Promise<string> {
  return psql(CONTAINER, `SELECT concat_ws('|', ${columns}) FROM public.companies WHERE user_id = '${USERS[user].id}'`);
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${Object.values(USERS).map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    // Companies the server did not create: a real name, not flagged auto_provisioned.
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at) VALUES
         ('${USERS.real.id}', 'Real Co', 'Technology', now() + interval '14 days'),
         ('${USERS.a.id}', 'K5 A Co', 'other', now() + interval '14 days'),
         ('${USERS.b.id}', 'K5 B Co', 'other', now() + interval '14 days'),
         ('${USERS.expired.id}', 'K5 Expired Co', 'other', now() - interval '1 day')`
    );
    for (const line of (await psql(CONTAINER, 'SELECT user_id::text || \'=\' || id::text FROM public.companies')).split('\n')) {
      const [userId, id] = line.split('=');
      const key = (Object.keys(USERS) as UserKey[]).find((k) => USERS[k].id === userId);
      if (key && id) company[key] = id;
    }

    // Stand-in for InsForge's GET /api/auth/sessions/current (what authGuard calls).
    mockInsforge = http.createServer((req, res) => {
      const key = (Object.keys(USERS) as UserKey[]).find((k) => req.headers.authorization === `Bearer ${tokenOf(k)}`);
      if (key && (req.url || '').startsWith('/api/auth/sessions/current')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ user: { id: USERS[key].id, email: USERS[key].email } }));
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

describe('F-B-03 — the first login', () => {
  it('a brand-new account is provisioned as a placeholder and is sent to onboarding', async () => {
    const body = await overview('fresh');
    expect(body).toMatchObject({
      success: true,
      company: { name: 'k5-fresh Organization', industry: 'other', consolidation_approach: 'unspecified', base_year: null },
      onboarding: { needs_onboarding: true, auto_provisioned: true, completed_at: null, skipped_at: null },
      facilities: [],
      plan: { id: 'starter', facility_limit: 1 },
      checklist: { company_named: false, facility_added: false, data_added: false, report_generated: false, complete: false },
    });
    expect(await companyRow('fresh', 'auto_provisioned::text, (onboarding_completed_at IS NULL)::text, (onboarding_skipped_at IS NULL)::text')).toBe('true|true|true');
  });

  it('asking again provisions nothing new and changes nothing', async () => {
    const first = await overview('fresh');
    const second = await overview('fresh');
    expect(second.company.id).toBe(first.company.id);
    expect(await count(`public.companies WHERE user_id = '${USERS.fresh.id}'`)).toBe(1);
    expect(second.onboarding).toEqual(first.onboarding);
  });

  it('the call that used to provision the company away from onboarding (the dashboard summary) leaves onboarding pending', async () => {
    // The audit's path: login -> /app -> summary -> requirePlan -> ensureCompanyForUser.
    expect((await api('dash', 'GET', '/api/emissions/summary?period=2026')).status).toBe(200);
    const body = await overview('dash');
    expect(body.company.name).toBe('k5-dash Organization');
    expect(body.onboarding.needs_onboarding).toBe(true);
    expect(await companyRow('dash', 'auto_provisioned::text')).toBe('true');
  });

  it('a company the server did not create goes straight to the app', async () => {
    const body = await overview('real');
    expect(body.company).toMatchObject({ name: 'Real Co', industry: 'Technology' });
    expect(body.onboarding).toMatchObject({ needs_onboarding: false, auto_provisioned: false });
    expect(body.checklist.company_named).toBe(true);
  });

  it('needs a session: no token is 401', async () => {
    expect((await api(null, 'GET', '/api/company')).status).toBe(401);
    expect((await api(null, 'PATCH', `/api/companies/${company.a}`, { name: 'x' })).status).toBe(401);
    expect((await api(null, 'POST', `/api/companies/${company.a}/onboarding/skip`)).status).toBe(401);
  });
});

describe('onboarding: name the company, or finish later', () => {
  it('PATCH names the company, stores the reporting basis and ends onboarding', async () => {
    company.flow = String((await overview('flow')).company.id);
    const res = await api('flow', 'PATCH', `/api/companies/${company.flow}`, {
      name: '  Northstar Foods ', industry: 'Manufacturing', consolidation_approach: 'operational_control', base_year: 2022,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      success: true,
      data: { name: 'Northstar Foods', industry: 'Manufacturing', consolidation_approach: 'operational_control', base_year: 2022 },
      onboarding: { needs_onboarding: false, auto_provisioned: true },
    });
    expect(await companyRow('flow', 'name, industry, consolidation_approach, base_year, (onboarding_completed_at IS NOT NULL)::text, (onboarding_skipped_at IS NULL)::text'))
      .toBe('Northstar Foods|Manufacturing|operational_control|2022|true|true');
    const after = await overview('flow');
    expect(after.onboarding.needs_onboarding).toBe(false);
    expect(after.checklist.company_named).toBe(true);
  });

  it('"Finish later" ends the gate without naming the company, and the checklist still asks for a name', async () => {
    company.skip = String((await overview('skip')).company.id);
    const res = await api('skip', 'POST', `/api/companies/${company.skip}/onboarding/skip`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ success: true, onboarding: { needs_onboarding: false } });
    const first = await companyRow('skip', 'onboarding_skipped_at::text, (onboarding_completed_at IS NULL)::text');
    expect(first).toMatch(/\|true$/);
    const after = await overview('skip');
    expect(after.onboarding).toMatchObject({ needs_onboarding: false, completed_at: null });
    expect(after.company.name).toBe('k5-skip Organization');
    expect(after.checklist.company_named).toBe(false);
    // Skipping again keeps the first time.
    expect((await api('skip', 'POST', `/api/companies/${company.skip}/onboarding/skip`)).status).toBe(200);
    expect(await companyRow('skip', 'onboarding_skipped_at::text, (onboarding_completed_at IS NULL)::text')).toBe(first);
  });

  it('renaming from Settings also ends onboarding, whichever screen saved the name', async () => {
    // "skip" renames later: the placeholder is gone and the checklist ticks.
    expect((await api('skip', 'PATCH', `/api/companies/${company.skip}`, { name: 'Skipper Ltd' })).status).toBe(200);
    expect((await overview('skip')).checklist.company_named).toBe(true);
    expect(await companyRow('skip', '(onboarding_completed_at IS NOT NULL)::text')).toBe('true');
  });

  it('keeps names with quotes, semicolons and accents exactly as typed (bound parameters)', async () => {
    const name = `Robert'); DROP TABLE companies;-- Mueller & Sons "GmbH"`;
    expect((await api('real', 'PATCH', `/api/companies/${company.real}`, { name })).status).toBe(200);
    expect(await companyRow('real', 'name')).toBe(name);
    expect(await count('public.companies')).toBeGreaterThan(5);
  });
});

describe('validation: what a client may and may not change', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a name over 200 characters', { name: 'x'.repeat(201) }],
    ['an industry outside the list', { industry: 'Wizardry' }],
    ['a consolidation approach outside the list', { consolidation_approach: 'operational control' }],
    ['a base year before 1990', { base_year: 1989 }],
    ['a base year in the future', { base_year: new Date().getUTCFullYear() + 1 }],
    ['a fractional base year', { base_year: 2022.5 }],
    ['a base year sent as text', { base_year: '2022' }],
    ['nothing at all', {}],
  ];

  it.each(bad)('%s is 400 and changes nothing', async (_label, body) => {
    const before = await companyRow('a', 'name, industry, consolidation_approach, base_year, updated_at::text');
    const res = await api('a', 'PATCH', `/api/companies/${company.a}`, body);
    expect(res.status).toBe(400);
    expect(typeof (await json(res)).error).toBe('string');
    expect(await companyRow('a', 'name, industry, consolidation_approach, base_year, updated_at::text')).toBe(before);
  });

  it('plan, billing, trial and onboarding-state fields are refused, never applied', async () => {
    const before = await companyRow('a', 'name, subscription_plan, subscription_status, stripe_customer_id, trial_ends_at::text, auto_provisioned::text, user_id::text');
    const attempt = {
      name: 'Hacked Co', subscription_plan: 'pro', subscription_status: 'active', stripe_customer_id: 'cus_x',
      trial_ends_at: '2099-01-01T00:00:00Z', auto_provisioned: true, user_id: USERS.b.id,
    };
    const res = await api('a', 'PATCH', `/api/companies/${company.a}`, attempt);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/subscription_plan/);
    expect(await companyRow('a', 'name, subscription_plan, subscription_status, stripe_customer_id, trial_ends_at::text, auto_provisioned::text, user_id::text')).toBe(before);
    // Each one alone is refused too, so none of them is reachable by leaving out the name.
    for (const field of Object.keys(attempt).filter((key) => key !== 'name')) {
      const alone = await api('a', 'PATCH', `/api/companies/${company.a}`, { [field]: (attempt as Record<string, unknown>)[field] });
      expect({ field, status: alone.status }).toEqual({ field, status: 400 });
    }
    expect(await companyRow('a', '(subscription_plan IS NULL)::text, (stripe_customer_id IS NULL)::text')).toBe('true|true');
  });

  it('accepts each valid field on its own, and lets a company clear its industry and base year', async () => {
    const id = company.a;
    expect((await api('a', 'PATCH', `/api/companies/${id}`, { industry: 'Healthcare' })).status).toBe(200);
    expect((await api('a', 'PATCH', `/api/companies/${id}`, { consolidation_approach: 'equity_share' })).status).toBe(200);
    expect((await api('a', 'PATCH', `/api/companies/${id}`, { base_year: 1990 })).status).toBe(200);
    expect(await companyRow('a', 'industry, consolidation_approach, base_year')).toBe('Healthcare|equity_share|1990');
    expect((await api('a', 'PATCH', `/api/companies/${id}`, { industry: null, base_year: null, consolidation_approach: 'unspecified' })).status).toBe(200);
    expect(await companyRow('a', '(industry IS NULL)::text, consolidation_approach, (base_year IS NULL)::text')).toBe('true|unspecified|true');
  });
});

describe('ownership: one tenant cannot touch another\'s company or facilities', () => {
  let facilityA = '';

  it('B cannot rename, skip or read A\'s company through A\'s id (403), and A is unchanged', async () => {
    facilityA = String((await json(await api('a', 'POST', `/api/companies/${company.a}/facilities`, { name: 'K5 A Plant', type: 'factory', city: 'Fresno' }))).data.id);
    const before = await companyRow('a', 'name, industry, onboarding_skipped_at::text, updated_at::text');
    for (const [method, path, body] of [
      ['PATCH', `/api/companies/${company.a}`, { name: 'B was here' }],
      ['POST', `/api/companies/${company.a}/onboarding/skip`, undefined],
      ['PATCH', `/api/companies/${company.a}/facilities/${facilityA}`, { name: 'B was here' }],
      ['DELETE', `/api/companies/${company.a}/facilities/${facilityA}`, undefined],
    ] as const) {
      const res = await api('b', method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
    }
    expect(await companyRow('a', 'name, industry, onboarding_skipped_at::text, updated_at::text')).toBe(before);
    expect(await count(`public.facilities WHERE id = ${facilityA} AND name = 'K5 A Plant'`)).toBe(1);
  });

  it('B cannot reach A\'s facility through B\'s own company either: it answers 404, exactly like a facility that does not exist', async () => {
    const real = await api('b', 'PATCH', `/api/companies/${company.b}/facilities/${facilityA}`, { name: 'B was here' });
    const missing = await api('b', 'PATCH', `/api/companies/${company.b}/facilities/999999`, { name: 'B was here' });
    expect([real.status, missing.status]).toEqual([404, 404]);
    expect(await json(real)).toEqual(await json(missing));
    const del = await api('b', 'DELETE', `/api/companies/${company.b}/facilities/${facilityA}`);
    const delMissing = await api('b', 'DELETE', `/api/companies/${company.b}/facilities/999999`);
    expect([del.status, delMissing.status]).toEqual([404, 404]);
    expect(await count(`public.facilities WHERE id = ${facilityA} AND name = 'K5 A Plant' AND company_id = ${company.a}`)).toBe(1);
  });

  it('GET /api/company answers with the caller\'s own company only, whatever a query string says', async () => {
    const res = await api('b', 'GET', `/api/company?company_id=${company.a}&id=${company.a}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(String(body.company.id)).toBe(company.b);
    expect(body.company.name).toBe('K5 B Co');
    expect(body.facilities).toEqual([]);
  });

  it('a malformed facility id is a plain 404', async () => {
    for (const id of ['abc', '1e3', '-1', '0x10', '1;DROP', '9'.repeat(30)]) {
      const res = await api('a', 'DELETE', `/api/companies/${company.a}/facilities/${encodeURIComponent(id)}`);
      expect({ id, status: res.status }).toEqual({ id, status: 404 });
    }
  });
});

describe('facilities: add, rename, delete, and the plan cap', () => {
  let facility = '';

  it('the first facility is created; a second one on the Starter trial is 402 with a clear message', async () => {
    const created = await api('flow', 'POST', `/api/companies/${company.flow}/facilities`, { name: 'Plant A', type: 'factory', city: 'Fresno' });
    expect(created.status).toBe(201);
    facility = String((await json(created)).data.id);
    const second = await api('flow', 'POST', `/api/companies/${company.flow}/facilities`, { name: 'Plant B', type: 'office', city: 'Reno' });
    expect(second.status).toBe(402);
    expect(await json(second)).toMatchObject({ code: 'upgrade_required', requiredPlan: 'growth', error: expect.stringMatching(/starter plan includes 1 facility/) });
    expect(await count(`public.facilities WHERE company_id = ${company.flow}`)).toBe(1);
    const body = await overview('flow');
    expect(body.facilities).toEqual([{ id: Number(facility), company_id: Number(company.flow), name: 'Plant A', type: 'factory', city: 'Fresno' }]);
    expect(body.checklist.facility_added).toBe(true);
  });

  it('CSV rows name the facility at last: "facility_name" matches it whatever its capitals, and a name that matches nothing is warned about', async () => {
    // A date on every row, so that the facility is the only thing the file is warned about.
    const csv = 'scope,category,source,amount,unit,date,facility_name\n'
      + 'Scope 1,stationary_combustion,natural_gas,100,therms,2025-03-15,plant a\n'
      + 'Scope 1,stationary_combustion,natural_gas,100,therms,2025-03-15,Plant Z\n';
    const post = (query: string) => fetch(`${base}/api/ingest/csv${query}`, {
      method: 'POST', headers: { authorization: `Bearer ${tokenOf('flow')}`, 'content-type': 'text/csv' }, body: csv,
    });

    // The dry run validates the whole file and stores nothing (K4): line 2 finds Plant A, line 3 names a facility that does not exist.
    const dry = await post('?dry_run=1');
    expect(dry.status).toBe(200);
    const preview = await json(dry);
    expect(preview).toMatchObject({ success: true, dry_run: true, total_rows: 2, valid_rows: 2, error_count: 0, can_commit: true });
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatch(/line 3\b.*facility "Plant Z".*does not exist.*without a facility/);
    expect(preview.warnings[0]).not.toMatch(/plant a/i);
    expect(await count(`public.emission_entries WHERE company_id = ${company.flow}`)).toBe(0);

    // The commit stores both rows and says the same: only the row that names "plant a" is attached to Plant A.
    const committed = await post('');
    expect(committed.status).toBe(200);
    expect(await json(committed)).toMatchObject({ success: true, imported: 2, errors: [], warnings: preview.warnings });
    expect(await count(`public.emission_entries WHERE facility_id = ${facility}`)).toBe(1);
    expect(await count(`public.emission_entries WHERE company_id = ${company.flow} AND facility_id IS NULL`)).toBe(1);
  });

  it('a facility can be renamed and changed; the list shows it', async () => {
    const res = await api('flow', 'PATCH', `/api/companies/${company.flow}/facilities/${facility}`, { name: '  Fresno Plant  ', type: 'Warehouse', city: 'Clovis' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ success: true, data: { id: Number(facility), name: 'Fresno Plant', type: 'warehouse', city: 'Clovis' } });
    expect(await psql(CONTAINER, `SELECT concat_ws('|', name, type, city) FROM public.facilities WHERE id = ${facility}`)).toBe('Fresno Plant|warehouse|Clovis');
    expect((await api('flow', 'GET', `/api/companies/${company.flow}/facilities`)).status).toBe(200);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a type outside office, factory, warehouse', { type: 'castle' }],
    ['a blank city', { city: '  ' }],
    ['a field it does not own', { company_id: 1 }],
    ['nothing', {}],
  ])('%s is 400 and changes nothing', async (_label, body) => {
    const res = await api('flow', 'PATCH', `/api/companies/${company.flow}/facilities/${facility}`, body);
    expect(res.status).toBe(400);
    expect(await psql(CONTAINER, `SELECT concat_ws('|', name, type, city) FROM public.facilities WHERE id = ${facility}`)).toBe('Fresno Plant|warehouse|Clovis');
  });

  it('a facility that entries point at is not deleted (409 with the count); once they are moved or gone it can be', async () => {
    const entry = await api('flow', 'POST', '/api/entries', { ...GAS, facility_id: Number(facility) });
    expect(entry.status).toBe(201);
    const entryId = String((await json(entry)).data.id);
    // Two entries now point at it: the CSV row and this one.
    const refused = await api('flow', 'DELETE', `/api/companies/${company.flow}/facilities/${facility}`);
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({
      code: 'facility_has_entries', entry_count: 2, error: expect.stringMatching(/This facility has 2 emission entries/),
    });
    expect(await count(`public.facilities WHERE id = ${facility}`)).toBe(1);
    expect(await count(`public.emission_entries WHERE facility_id = ${facility}`)).toBe(2);

    // Moving an entry is an entry edit; deleting the other one is an entry delete.
    expect((await api('flow', 'PATCH', `/api/entries/${entryId}`, { facility_id: null })).status).toBe(200);
    const csvRow = await psql(CONTAINER, `SELECT id FROM public.emission_entries WHERE facility_id = ${facility}`);
    expect((await api('flow', 'DELETE', `/api/entries/${csvRow}`)).status).toBe(200);
    const deleted = await api('flow', 'DELETE', `/api/companies/${company.flow}/facilities/${facility}`);
    expect(deleted.status).toBe(200);
    expect(await count(`public.facilities WHERE id = ${facility}`)).toBe(0);
    // The entry that was moved is still there, without a facility.
    expect(await psql(CONTAINER, `SELECT (facility_id IS NULL)::text FROM public.emission_entries WHERE id = ${entryId}`)).toBe('true');
    expect((await api('flow', 'DELETE', `/api/entries/${entryId}`)).status).toBe(200);
  });

  it('deleting a facility frees its slot under the cap: the company can add one again', async () => {
    const again = await api('flow', 'POST', `/api/companies/${company.flow}/facilities`, { name: 'Plant B', type: 'office', city: 'Reno' });
    expect(again.status).toBe(201);
    expect(await count(`public.facilities WHERE company_id = ${company.flow}`)).toBe(1);
  });

  it('deleting the same facility twice is 404 the second time', async () => {
    const id = String((await overview('flow')).facilities[0].id);
    expect((await api('flow', 'DELETE', `/api/companies/${company.flow}/facilities/${id}`)).status).toBe(200);
    expect((await api('flow', 'DELETE', `/api/companies/${company.flow}/facilities/${id}`)).status).toBe(404);
  });
});

describe('the checklist ticks from what is stored', () => {
  it('follows the data: facility, entry and report tick it, and deleting the data un-ticks it', async () => {
    const id = company.flow;
    // Start from no data: the CSV row for "Plant Z" above is still stored.
    for (const left of (await json(await api('flow', 'GET', '/api/entries'))).data as Array<{ id: number }>) {
      expect((await api('flow', 'DELETE', `/api/entries/${left.id}`)).status).toBe(200);
    }
    expect((await overview('flow')).checklist.data_added).toBe(false);
    await api('flow', 'POST', `/api/companies/${id}/facilities`, { name: 'Plant C', type: 'office', city: 'Reno' });
    const entry = await api('flow', 'POST', '/api/entries', GAS);
    const entryId = String((await json(entry)).data.id);
    let body = await overview('flow');
    expect(body.checklist).toEqual({ company_named: true, facility_added: true, data_added: true, report_generated: false, complete: false });

    const report = await api('flow', 'POST', `/api/companies/${id}/reports/generate`, { period: '2025' });
    expect(report.status).toBe(200);
    body = await overview('flow');
    expect(body.checklist).toEqual({ company_named: true, facility_added: true, data_added: true, report_generated: true, complete: true });

    expect((await api('flow', 'DELETE', `/api/entries/${entryId}`)).status).toBe(200);
    body = await overview('flow');
    expect(body.checklist).toMatchObject({ data_added: false, report_generated: true, complete: false });
  });

  it('a brand-new account has nothing ticked', async () => {
    expect((await overview('dash')).checklist).toEqual({ company_named: false, facility_added: false, data_added: false, report_generated: false, complete: false });
  });
});

describe('after the trial ends', () => {
  it('the company and facility routes are 402 like the rest of the app, and nothing changes', async () => {
    const before = await companyRow('expired', 'name, industry, updated_at::text');
    for (const [method, path, body] of [
      ['GET', '/api/company', undefined],
      ['PATCH', `/api/companies/${company.expired}`, { name: 'Late Co' }],
      ['POST', `/api/companies/${company.expired}/onboarding/skip`, undefined],
      ['PATCH', `/api/companies/${company.expired}/facilities/1`, { name: 'Late' }],
      ['DELETE', `/api/companies/${company.expired}/facilities/1`, undefined],
    ] as const) {
      const res = await api('expired', method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 402 });
      expect(await json(res)).toMatchObject({ code: 'upgrade_required' });
    }
    expect(await companyRow('expired', 'name, industry, updated_at::text')).toBe(before);
  });
});

describe('the records the routes leave behind', () => {
  it('every account that was provisioned on its first call is flagged; the ones created by SQL are not', async () => {
    const flagged = await psql(CONTAINER, `SELECT string_agg(user_id::text, ',' ORDER BY user_id::text) FROM public.companies WHERE auto_provisioned`);
    expect(flagged.split(',').sort()).toEqual(PROVISIONED_ON_FIRST_CALL.map((key) => USERS[key].id).sort());
  });
});
