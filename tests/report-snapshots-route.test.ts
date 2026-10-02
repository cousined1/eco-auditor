/**
 * K3 (audit AUDIT-RUN-20260929: F-B-04, F-G-20, F-E-03, F-B-05, F-B-09) through
 * the real Express routes, a real Postgres with every repo migration, and real
 * bearer-token auth.
 *
 * The audit's reproduction (review R2 §4c): a report generated at 20.525 t was
 * re-rendered from live rows on every download, so after sign-off and one more
 * import the same id read 23.178 t, later 84.2 t, while the row said
 * 'final' / 100. Here: generate -> change the data -> download is byte for byte
 * the same; sign-off freezes (409 afterwards, and the DB trigger refuses a
 * direct UPDATE); the period is a calendar year or a date range and defaults to
 * the Dashboard's year; an empty period saves nothing; another tenant sees 404.
 *
 * Setup: one throwaway Postgres (e2e-helpers), a local stand-in for InsForge
 * auth, one server with NODE_ENV=production, as deployed. Dates are relative to
 * the current year, so the suite does not expire.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
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

const { GENERATE_LIMIT, MAX_DRAFT_REPORTS } = createRequire(import.meta.url)('../src/lib/reports/report-limits.cjs') as {
  GENERATE_LIMIT: number;
  MAX_DRAFT_REPORTS: number;
};

const CONTAINER = uniqueContainerName('fix-tests-pg-reports');
const THIS_YEAR = new Date().getFullYear();
const LAST_YEAR = THIS_YEAR - 1;

const USERS = {
  a: { id: 'a1000000-0000-4000-8000-00000000000a', email: 'reports-a@example.com' },
  b: { id: 'b1000000-0000-4000-8000-00000000000b', email: 'reports-b@example.com' },
  expired: { id: 'e1000000-0000-4000-8000-00000000000e', email: 'reports-expired@example.com' },
} as const;
type UserKey = keyof typeof USERS;
const tokenOf = (user: UserKey) => `reports-token-${user}`;

const cleanup = new E2eCleanup();
let mockInsforge: http.Server | null = null;
let base = '';
const company = {} as Record<UserKey, string>;

type Report = { id: string; status: string; period: string; period_label: string; total_tco2e: number | null; pdf_sha256: string | null; download_url: string | null; signed_off_by: string | null; signed_off_at: string | null };
let first: Report;
let firstPdf: Buffer;

const CSV_HEADER = 'scope,category,source,amount,unit,facility_name,date';
const csv = (...rows: string[]) => [CSV_HEADER, ...rows].join('\n') + '\n';

function api(user: UserKey, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${tokenOf(user)}` };
  let payload: string | undefined;
  if (typeof body === 'string') {
    headers['content-type'] = 'text/csv';
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${base}${path}`, { method, headers, body: payload });
}

async function must<T>(res: Response, status: number, step: string): Promise<T> {
  const text = await res.text();
  if (res.status !== status) throw new Error(`${step}: expected ${status}, got ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function generate(user: UserKey, body: unknown, step: string): Promise<Report> {
  const res = await must<{ report: Report }>(await api(user, 'POST', `/api/companies/${company[user]}/reports/generate`, body), 200, step);
  return res.report;
}

async function download(user: UserKey, id: string): Promise<{ res: Response; bytes: Buffer }> {
  const res = await api(user, 'GET', `/api/reports/${id}/download`);
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function dashboardTotal(user: UserKey, year: number): Promise<number> {
  const body = await must<{ data: { total_co2e_tonnes: number } }>(await api(user, 'GET', `/api/emissions/summary?period=${year}`), 200, `summary ${year}`);
  return body.data.total_co2e_tonnes;
}

const reportCount = async (companyId: string) =>
  Number(await psql(CONTAINER, `SELECT count(*)::int::text FROM public.reports WHERE company_id = ${Number(companyId)}`));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// The lines a PDF shows (WinAnsi bytes 0xA0-0xFF read as Latin-1, escapes undone).
const pdfLines = (bytes: Buffer) =>
  [...bytes.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => (m[1] ?? '').replace(/\\([()\\])/g, '$1'));

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);

    const users = Object.values(USERS);
    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${users.map((u) => `('${u.id}', '${u.email}')`).join(', ')}`);
    // U&'' keeps the command line ASCII; the company name is "Müller Umwelt GmbH".
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, trial_ends_at) VALUES
         ('${USERS.a.id}', U&'M\\00FCller Umwelt GmbH', 'other', now() + interval '14 days'),
         ('${USERS.b.id}', 'Tenant B Co', 'other', now() + interval '14 days'),
         ('${USERS.expired.id}', 'Expired Co', 'other', now() - interval '1 day')`
    );
    for (const line of (await psql(CONTAINER, `SELECT user_id::text || '=' || id::text FROM public.companies`)).split('\n')) {
      const [userId, id] = line.split('=');
      const key = (Object.keys(USERS) as UserKey[]).find((k) => USERS[k].id === userId);
      if (key && id) company[key] = id;
    }

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

    await must(await api('a', 'POST', `/api/companies/${company.a}/facilities`, { name: 'Werk Süd', type: 'factory', city: 'Fresno' }), 201, 'A creates a facility');
    // The R2 reproduction rows. A CSV row is pinned to the current catalog since K4
    // (server-entries.cjs pinActivity), so it is priced with emission-factors.json
    // 2026-09-30, kg CO2e per unit: natural_gas 5.31145 per therm (EPA Hub 2025
    // Table 1: 53.06 kg CO2 + 1.0 g CH4 x 28 + 0.10 g N2O x 265 = 53.1145 per mmBtu,
    // / 10), mobile diesel 10.21 per gallon and CAMX 0.19504 per kWh (both unchanged
    // from 2026-07-24). Last year 1,000 x 5.31145 = 5,311.45 kg = 5.31145 t; this
    // year 100 x 10.21 + 100,000 x 0.19504 = 1,021 + 19,504 kg = 20.525 t.
    const ingest = await must<{ imported: number }>(await api('a', 'POST', '/api/ingest/csv', csv(
      `Scope 1,stationary_combustion,natural_gas,1000,therms,Werk Süd,${LAST_YEAR}-06-30`,
      `Scope 1,mobile_combustion,diesel,100,gallons,Werk Süd,${THIS_YEAR}-01-02`,
      `Scope 2,purchased_electricity,CAMX,100000,kWh,,${THIS_YEAR}-01-03`,
    )), 200, 'A imports a CSV');
    if (ingest.imported !== 3) throw new Error(`A's import stored ${ingest.imported} rows, expected 3`);
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

describe('K3 — a generated report is a frozen snapshot', () => {
  it('without a period, covers the year the Dashboard opens on, with the Dashboard\'s total (F-B-05)', async () => {
    const dashboard = await must<{ data: { total_co2e_tonnes: number } }>(await api('a', 'GET', '/api/emissions/summary'), 200, 'default summary');
    first = await generate('a', {}, 'generate without a period');
    expect(first).toMatchObject({ status: 'draft', period: String(THIS_YEAR), period_label: `Calendar year ${THIS_YEAR}` });
    expect(first.total_tco2e).toBe(dashboard.data.total_co2e_tonnes);
    expect(first.total_tco2e).toBeCloseTo(20.525, 3);

    const { res, bytes } = await download('a', first.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('x-report-sha256')).toBe(sha256(bytes));
    expect(first.pdf_sha256).toBe(sha256(bytes));
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(bytes.includes(Buffer.from('Müller', 'utf8'))).toBe(false); // WinAnsi 0xFC, not UTF-8 mojibake
    const lines = pdfLines(bytes);
    expect(lines).toContain(`Reporting period: Calendar year ${THIS_YEAR} (${THIS_YEAR}-01-01 to ${THIS_YEAR}-12-31)`);
    expect(lines).toContain('Company: Müller Umwelt GmbH');
    expect(lines).toContain(`Report ID: ${first.id}`);
    expect(lines).toContain('Total: 20.525 tCO2e');
    expect(lines.some((line) => line.includes('Werk Süd: Scope 1 1.021'))).toBe(true);
    expect(Number(/\/Count (\d+)/.exec(text)?.[1])).toBeGreaterThanOrEqual(2);
    firstPdf = bytes;
  }, 60_000);

  it('does not change when the data changes: same id, same bytes (the 20.525 -> 23.178 repro)', async () => {
    await must(await api('a', 'POST', '/api/ingest/csv', csv(`Scope 1,stationary_combustion,natural_gas,500,therms,Werk Süd,${THIS_YEAR}-01-04`)), 200, 'A imports one more row');
    // 20.525 t + 500 therms x 5.31145 kg = 20.525 + 2.655725 = 23.180725 t.
    expect(await dashboardTotal('a', THIS_YEAR)).toBeCloseTo(23.180725, 6);

    const again = await download('a', first.id);
    expect(again.res.status).toBe(200);
    expect(again.bytes.equals(firstPdf)).toBe(true);
    const listed = await must<{ reports: Report[] }>(await api('a', 'GET', '/api/reports'), 200, 'list');
    expect(listed.reports.find((r) => r.id === first.id)?.total_tco2e).toBeCloseTo(20.525, 3);

    // A new report is the way to include the new data, under a new id.
    const second = await generate('a', { period: String(THIS_YEAR) }, 'generate again');
    expect(second.id).not.toBe(first.id);
    expect(second.total_tco2e).toBeCloseTo(23.180725, 6);
  }, 60_000);

  it('sign-off binds to the reviewed PDF, freezes the report, and any later change is refused (409)', async () => {
    const mismatch = await api('a', 'POST', `/api/reports/${first.id}/signoff`, { pdf_sha256: '0'.repeat(64) });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: 'pdf_mismatch' });

    const signed = await must<{ report: Report }>(
      await api('a', 'POST', `/api/reports/${first.id}/signoff`, { pdf_sha256: first.pdf_sha256 }), 200, 'sign off');
    expect(signed.report).toMatchObject({ id: first.id, status: 'final', signed_off_by: USERS.a.id });
    expect(signed.report.signed_off_at).toBeTruthy();

    const twice = await api('a', 'POST', `/api/reports/${first.id}/signoff`, {});
    expect(twice.status).toBe(409);
    expect(await twice.json()).toMatchObject({ success: false, code: 'report_final' });
    expect((await download('a', first.id)).bytes.equals(firstPdf)).toBe(true);
    expect(await psql(CONTAINER, `SELECT status || '|' || signoff FROM public.reports WHERE id = ${Number(first.id)}`)).toBe('final|completed');

    // The server writes with row_security off, so the freeze is also a trigger.
    await expect(psql(CONTAINER, `UPDATE public.reports SET snapshot = '{}'::jsonb WHERE id = ${Number(first.id)}`))
      .rejects.toThrow(/signed off and cannot be changed/);
    await expect(psql(CONTAINER, `UPDATE public.reports SET status = 'draft' WHERE id = ${Number(first.id)}`))
      .rejects.toThrow(/signed off and cannot be changed/);
    const draftId = await psql(CONTAINER, `SELECT id::text FROM public.reports WHERE company_id = ${Number(company.a)} AND status = 'draft' ORDER BY id LIMIT 1`);
    await expect(psql(CONTAINER, `UPDATE public.reports SET pdf = 'x'::bytea, pdf_sha256 = repeat('0', 64) WHERE id = ${Number(draftId)}`))
      .rejects.toThrow(/frozen: only its sign-off can change/);
    // VERIFY-W2A D-6: a draft names its signer only in the UPDATE that makes it final.
    for (const change of [`signed_off_by = 'someone'`, 'signed_off_at = now()']) {
      await expect(psql(CONTAINER, `UPDATE public.reports SET ${change} WHERE id = ${Number(draftId)}`))
        .rejects.toThrow(/is a draft: its sign-off is recorded only together with the move to final/);
    }
    expect(await psql(CONTAINER, `SELECT status || '|' || coalesce(signed_off_by, '-') FROM public.reports WHERE id = ${Number(draftId)}`)).toBe('draft|-');
  }, 60_000);

  it('takes a calendar year or a date range, nothing else (F-E-03)', async () => {
    const before = await reportCount(company.a);
    const bad = await api('a', 'POST', `/api/companies/${company.a}/reports/generate`, { period: `FY${LAST_YEAR}` });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ success: false, code: 'invalid_period' });
    const tooLong = await api('a', 'POST', `/api/companies/${company.a}/reports/generate`, { period: `${LAST_YEAR}-01-01/${THIS_YEAR}-12-31` });
    expect(tooLong.status).toBe(400);
    expect(await reportCount(company.a)).toBe(before);

    // 1,000 therms x 5.31145 kg = 5.31145 t.
    expect((await generate('a', { period: String(LAST_YEAR) }, 'last year')).total_tco2e).toBeCloseTo(5.31145, 6);
    const range = await generate('a', { period: `${LAST_YEAR}-06-01/${THIS_YEAR}-01-02` }, 'custom range');
    expect(range).toMatchObject({ period: `${LAST_YEAR}-06-01/${THIS_YEAR}-01-02`, period_label: `${LAST_YEAR}-06-01 to ${THIS_YEAR}-01-02` });
    // Last year's natural gas (June 30) and this year's diesel (January 2): 5.31145 + 1.021 = 6.33245 t.
    expect(range.total_tco2e).toBeCloseTo(6.33245, 6);
    expect((await generate('a', { period: `${THIS_YEAR}-01-01/${THIS_YEAR}-12-31` }, 'whole-year range')).period).toBe(String(THIS_YEAR));
  }, 60_000);

  it('places an entry by its activity date on the Dashboard and in reports alike (review R2)', async () => {
    // Recorded today, but the activity was on the last day of last year.
    await psql(CONTAINER, `INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit, activity_date, created_at)
      VALUES (${Number(company.a)}, 'Scope 1', 'mobile_combustion', 'diesel', 10, 'gallons', '${LAST_YEAR}-12-31', now())`);
    // That row has no catalog_version, so the frozen 2026-07-24 catalog prices it: mobile
    // diesel 10.21 kg per gallon, 10 x 10.21 = 102.1 kg. Last year 5.31145 + 0.1021 = 5.41355 t.
    expect(await dashboardTotal('a', LAST_YEAR)).toBeCloseTo(5.41355, 6);
    expect(await dashboardTotal('a', THIS_YEAR)).toBeCloseTo(23.180725, 6);
    expect((await generate('a', { period: String(LAST_YEAR) }, 'last year again')).total_tco2e).toBeCloseTo(5.41355, 6);
  }, 60_000);

  it('says so for a period with no entries and saves nothing', async () => {
    const before = await reportCount(company.a);
    const res = await api('a', 'POST', `/api/companies/${company.a}/reports/generate`, { period: '2019' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      code: 'empty_period',
      error: 'There are no emission entries in Calendar year 2019, so no report was created.',
    });
    expect(await reportCount(company.a)).toBe(before);
  }, 60_000);

  it('keeps each company\'s reports to itself: list, download and sign-off (identical 404s)', async () => {
    const listB = await must<{ company: { id: string }; reports: Report[] }>(await api('b', 'GET', '/api/reports'), 200, 'B lists');
    expect(listB.company.id).toBe(company.b);
    expect(listB.reports).toEqual([]);
    const listA = await must<{ reports: Report[] }>(await api('a', 'GET', '/api/reports'), 200, 'A lists');
    const draft = listA.reports.find((r) => r.status === 'draft')!;

    for (const [method, path] of [['GET', `/api/reports/${first.id}/download`], ['GET', `/api/reports/${draft.id}/download`],
      ['POST', `/api/reports/${draft.id}/signoff`], ['GET', '/api/reports/999999/download'], ['GET', '/api/reports/not-a-number/download']] as const) {
      const res = await api('b', method, path, method === 'POST' ? {} : undefined);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    expect((await api('b', 'GET', `/api/reports?company_id=${company.a}`)).status).toBe(403);
    expect((await api('b', 'POST', `/api/companies/${company.a}/reports/generate`, { period: String(THIS_YEAR) })).status).toBe(403);
    expect(await psql(CONTAINER, `SELECT status FROM public.reports WHERE id = ${Number(draft.id)}`)).toBe('draft');
  }, 60_000);

  it('lists a report made before snapshots as legacy, and never serves or signs it', async () => {
    // Exactly what the previous server code inserted.
    await psql(CONTAINER, `INSERT INTO public.reports (company_id, title, type, status, last_updated, completeness, signoff, period)
      VALUES (${Number(company.a)}, 'Carbon Report 2026-07-01', 'carbon', 'final', now(), 100, 'pending', NULL)`);
    const legacyId = await psql(CONTAINER, `SELECT max(id)::text FROM public.reports WHERE company_id = ${Number(company.a)} AND pdf_sha256 IS NULL`);
    const list = await must<{ reports: Report[] }>(await api('a', 'GET', '/api/reports'), 200, 'list with legacy');
    expect(list.reports.find((r) => r.id === legacyId)).toMatchObject({ status: 'legacy', download_url: null, total_tco2e: null, period_label: 'All time' });

    for (const res of [await api('a', 'GET', `/api/reports/${legacyId}/download`), await api('a', 'POST', `/api/reports/${legacyId}/signoff`, {})]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ success: false, code: 'legacy_report' });
    }
  }, 60_000);

  it(`keeps at most ${MAX_DRAFT_REPORTS} unsigned drafts per company; finals and legacy rows stay (VERIFY-W2A F5)`, async () => {
    // Straight into the table: the bound is the AFTER INSERT trigger, for every writer.
    const cid = Number(company.expired);
    const draftsOfA = await psql(CONTAINER, `SELECT count(*)::text FROM public.reports WHERE company_id = ${Number(company.a)} AND status = 'draft'`);
    const frozen = `(company_id, title, type, status, last_updated, signoff, period, period_start, period_end, snapshot, pdf, pdf_sha256, signed_off_by, signed_off_at, created_at)`;
    await psql(CONTAINER, `INSERT INTO public.reports ${frozen} VALUES
      (${cid}, 'Signed', 'carbon', 'final', now(), 'completed', '2025', '2025-01-01', '2025-12-31', '{}'::jsonb, 'x'::bytea, repeat('b', 64), 'user-x', now(), now() - interval '2 days')`);
    await psql(CONTAINER, `INSERT INTO public.reports (company_id, title, type, status, last_updated, completeness, signoff, period)
      VALUES (${cid}, 'Legacy', 'carbon', 'final', now() - interval '3 days', 100, 'pending', NULL)`);
    await psql(CONTAINER, `INSERT INTO public.reports ${frozen}
      SELECT ${cid}, 'Draft ' || g, 'carbon', 'draft', now(), 'pending', '2025', '2025-01-01', '2025-12-31', '{}'::jsonb, 'x'::bytea, repeat('a', 64), NULL, NULL,
             now() - (100 - g) * interval '1 minute'
        FROM generate_series(1, ${MAX_DRAFT_REPORTS + 1}) AS g`);

    expect(await psql(CONTAINER, `SELECT count(*)::text FROM public.reports WHERE company_id = ${cid} AND status = 'draft'`)).toBe(String(MAX_DRAFT_REPORTS));
    expect(await psql(CONTAINER, `SELECT count(*)::text FROM public.reports WHERE company_id = ${cid} AND title = 'Draft 1'`)).toBe('0'); // the oldest
    expect(await psql(CONTAINER, `SELECT string_agg(title, ',' ORDER BY title) FROM public.reports WHERE company_id = ${cid} AND status = 'final'`)).toBe('Legacy,Signed');
    expect(await psql(CONTAINER, `SELECT count(*)::text FROM public.reports WHERE company_id = ${Number(company.a)} AND status = 'draft'`)).toBe(draftsOfA);
  }, 60_000);

  it(`limits generating to ${GENERATE_LIMIT} an hour per company, counted once a report will be made (VERIFY-W2A F5, VERIFY-FINAL-DATA D-4)`, async () => {
    // B has data to report on, so its generates can succeed.
    await must(await api('b', 'POST', '/api/ingest/csv', csv(`Scope 2,purchased_electricity,CAMX,1000,kWh,,${THIS_YEAR}-01-03`)), 200, 'B imports one row');
    // Another tenant's refused attempts do not spend B's quota.
    for (let i = 0; i < 3; i++) expect((await api('a', 'POST', `/api/companies/${company.b}/reports/generate`, {})).status).toBe(403);
    // Nor do B's own refused attempts: an invalid period (400) and a period with no entries (422) store
    // nothing. They used to count, so after 14 of them only 6 valid generates were left.
    for (let i = 0; i < 11; i++) {
      expect((await api('b', 'POST', `/api/companies/${company.b}/reports/generate`, { period: `FY${THIS_YEAR}` })).status, `invalid period ${i + 1}`).toBe(400);
    }
    for (let i = 0; i < 3; i++) {
      expect((await api('b', 'POST', `/api/companies/${company.b}/reports/generate`, { period: '2019' })).status, `empty period ${i + 1}`).toBe(422);
    }
    // So the whole hour's quota is still there: GENERATE_LIMIT reports, then the 429.
    for (let i = 0; i < GENERATE_LIMIT; i++) {
      expect((await api('b', 'POST', `/api/companies/${company.b}/reports/generate`, { period: String(THIS_YEAR) })).status, `generate ${i + 1}`).toBe(200);
    }
    const limited = await api('b', 'POST', `/api/companies/${company.b}/reports/generate`, { period: String(THIS_YEAR) });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(3500);
    expect(Number(limited.headers.get('retry-after'))).toBeLessThanOrEqual(3600);
    expect(await reportCount(company.b)).toBe(GENERATE_LIMIT);
    // Company A has its own count.
    expect((await generate('a', { period: String(THIS_YEAR) }, 'A generates while B is limited')).status).toBe('draft');
  }, 120_000);

  it('pauses reports for an expired trial, like the rest of the paid data (402)', async () => {
    for (const [method, path, body] of [['GET', '/api/reports', undefined], ['POST', `/api/companies/${company.expired}/reports/generate`, {}]] as const) {
      const res = await api('expired', method, path, body);
      expect({ path, status: res.status, code: (await res.json() as { code?: string }).code }).toEqual({ path, status: 402, code: 'upgrade_required' });
    }
  }, 60_000);
});
