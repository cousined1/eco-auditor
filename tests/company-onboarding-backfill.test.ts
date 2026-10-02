/**
 * K5: the onboarding migration (migrations/20260930121000_company-onboarding.sql)
 * against a database that already holds companies. Docker: one throwaway
 * container (tests/e2e-helpers.ts); run by explicit path.
 *
 * The rule under test: of the companies that exist when the migration runs, only
 * an UNTOUCHED PLACEHOLDER is sent to onboarding: a name in the shape the server
 * invents ("<email-prefix> Organization", "My Organization") and no facility, no
 * emission entry, no report and no CSV import. A company with a name of its own,
 * or with any data, must never be forced through a first-run screen it has long
 * outgrown.
 *
 * Every migration before it is applied first, the rows are seeded in the shapes
 * the previous code wrote, and only then is the onboarding migration applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  E2eCleanup,
  dockerRunPg,
  psql,
  psqlFile,
  registerExitSafety,
  runCapture,
  uniqueContainerName,
  waitPgReady,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-backfill');
const MIGRATION = '20260930121000_company-onboarding.sql';
const MIGRATIONS = resolve(__dirname, '..', 'migrations');
const BOOTSTRAP = resolve(__dirname, 'fixtures', 'bootstrap-auth-e2e.sql');

const cleanup = new E2eCleanup();

// Most tests here are several `docker exec` round trips; on Windows that outlasts the default 5 s.
vi.setConfig({ testTimeout: 60_000 });

// [name, what the company has, expected auto_provisioned]
const COMPANIES: Array<{ key: string; name: string; data: 'none' | 'facility' | 'entry' | 'report' | 'import'; pending: boolean }> = [
  { key: 'placeholder', name: 'audit+b-1 Organization', data: 'none', pending: true },
  { key: 'webhook', name: 'My Organization', data: 'none', pending: true },
  { key: 'facility', name: 'ph-facility Organization', data: 'facility', pending: false },
  { key: 'entry', name: 'ph-entry Organization', data: 'entry', pending: false },
  { key: 'report', name: 'ph-report Organization', data: 'report', pending: false },
  { key: 'import', name: 'ph-import Organization', data: 'import', pending: false },
  { key: 'named', name: 'Northstar Foods', data: 'none', pending: false },
  { key: 'named-facility', name: 'Northstar Foods West', data: 'facility', pending: false },
  { key: 'bare', name: 'Organization', data: 'none', pending: false },
  { key: 'infix', name: 'Acme Organization Holdings', data: 'none', pending: false },
  { key: 'lowercase', name: 'lower organization', data: 'none', pending: false },
];
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;

async function migrationFiles(): Promise<string[]> {
  return readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
}

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    await dockerRunPg(CONTAINER);
    await waitPgReady(CONTAINER);
    await psqlFile(CONTAINER, readFileSync(BOOTSTRAP, 'utf8'));
    for (const file of await migrationFiles()) {
      if (file >= MIGRATION) continue;
      await psqlFile(CONTAINER, readFileSync(resolve(MIGRATIONS, file), 'utf8'));
    }

    // The previous server wrote companies without the new columns.
    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ${COMPANIES.map((_, i) => `('${uuid(i)}', 'user${i}@example.com')`).join(', ')}`);
    await psql(
      CONTAINER,
      `INSERT INTO public.companies (user_id, name, industry, updated_at, trial_ends_at) VALUES ${COMPANIES.map((c, i) => `('${uuid(i)}', '${c.name}', 'other', now(), now() + interval '14 days')`).join(', ')}`
    );
    for (const [i, c] of COMPANIES.entries()) {
      const id = `(SELECT id FROM public.companies WHERE user_id = '${uuid(i)}')`;
      if (c.data === 'facility') await psql(CONTAINER, `INSERT INTO public.facilities (company_id, name, type, city) VALUES (${id}, 'Plant A', 'factory', 'Fresno')`);
      if (c.data === 'entry') {
        await psql(CONTAINER, `INSERT INTO public.emission_entries (company_id, scope, category, source, amount, unit) VALUES (${id}, 'Scope 1', 'stationary_combustion', 'natural_gas', 100, 'therms')`);
      }
      if (c.data === 'report') await psql(CONTAINER, `INSERT INTO public.reports (company_id, title, type, status) VALUES (${id}, 'Old report', 'carbon', 'final')`);
      if (c.data === 'import') await psql(CONTAINER, `INSERT INTO public.csv_import_events (company_id, row_count) VALUES (${id}, 3)`);
    }
    await psqlFile(CONTAINER, readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8'));
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 180_000);

afterAll(async () => {
  await cleanup.teardown();
});

async function flags(): Promise<Record<string, boolean>> {
  const rows = (await psql(CONTAINER, `SELECT user_id::text || '=' || auto_provisioned::text FROM public.companies ORDER BY user_id`)).split('\n');
  const byUser = Object.fromEntries(rows.map((row) => row.split('=') as [string, string]));
  return Object.fromEntries(COMPANIES.map((c, i) => [c.key, byUser[uuid(i)] === 'true']));
}

describe('the backfill rule', () => {
  it('only an untouched placeholder (placeholder-shaped name, no facility, no entry, no report, no import) is sent to onboarding', async () => {
    expect(await flags()).toEqual(Object.fromEntries(COMPANIES.map((c) => [c.key, c.pending])));
  });

  it('nothing else about an existing company changed: names, onboarding timestamps, defaults', async () => {
    expect(await psql(CONTAINER, `SELECT count(*)::text FROM public.companies`)).toBe(String(COMPANIES.length));
    expect(await psql(CONTAINER, `SELECT string_agg(DISTINCT concat_ws('|', consolidation_approach, base_year::text, (onboarding_completed_at IS NULL)::text, (onboarding_skipped_at IS NULL)::text), ',') FROM public.companies`))
      .toBe('unspecified|true|true');
    // uuid(i) ascends with i, so ORDER BY user_id is the order of COMPANIES.
    expect((await psql(CONTAINER, 'SELECT name FROM public.companies ORDER BY user_id')).split('\n')).toEqual(COMPANIES.map((c) => c.name));
  });

  it('applying the migration a second time is harmless and gives the same answer', async () => {
    await psqlFile(CONTAINER, readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8'));
    expect(await flags()).toEqual(Object.fromEntries(COMPANIES.map((c) => [c.key, c.pending])));
  });

  it('a company the previous server code creates after the migration is not flagged, so it is never sent to onboarding (safe before the new code deploys, and on rollback)', async () => {
    await psql(CONTAINER, `INSERT INTO auth.users (id, email) VALUES ('${uuid(99)}', 'late@example.com')`);
    await psql(CONTAINER, `INSERT INTO public.companies (user_id, name, industry, updated_at, trial_ends_at) VALUES ('${uuid(99)}', 'late Organization', 'other', now(), now() + interval '14 days')`);
    expect(await psql(CONTAINER, `SELECT auto_provisioned::text FROM public.companies WHERE user_id = '${uuid(99)}'`)).toBe('false');
  });

  // O-3 (docs/runbooks/release-order.md, after the deploy): the statement runs once, at migrate time, so a placeholder
  // the old image creates between the migration and the deploy keeps the default. Run alone, the same statement flags it
  // and leaves every other company as it was; a second run flags nothing.
  it('running the backfill statement alone after the deploy flags the placeholder the old code created since, and nothing else', async () => {
    const statement = /UPDATE public\.companies AS c[\s\S]*?;/.exec(readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8'))![0];
    const before = await flags();
    expect(await psql(CONTAINER, statement)).toBe('UPDATE 1'); // the 'late Organization' company of the test above
    expect(await psql(CONTAINER, `SELECT auto_provisioned::text FROM public.companies WHERE user_id = '${uuid(99)}'`)).toBe('true');
    expect(await flags()).toEqual(before);
    expect(await psql(CONTAINER, statement)).toBe('UPDATE 0');
    expect(await flags()).toEqual(before);
  });
});

describe('what the migration adds', () => {
  it('constrains the reporting basis: a known approach, and a base year from 1990 to 2100', async () => {
    const attempt = (set: string) => runCapture(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', `UPDATE public.companies SET ${set} WHERE user_id = '${uuid(6)}'`],
      { timeoutMs: 30_000 },
    );
    expect((await attempt("consolidation_approach = 'equity_share', base_year = 2021")).code).toBe(0);
    for (const bad of ["consolidation_approach = 'bogus'", "consolidation_approach = NULL", 'base_year = 1989', 'base_year = 2101']) {
      const res = await attempt(bad);
      expect({ bad, refused: res.code !== 0 }).toEqual({ bad, refused: true });
    }
    expect(await psql(CONTAINER, `SELECT concat_ws('|', consolidation_approach, base_year) FROM public.companies WHERE user_id = '${uuid(6)}'`)).toBe('equity_share|2021');
  });

  it('keeps the new company columns away from the browser role (only name and industry are writable there)', async () => {
    const privileges = await psql(
      CONTAINER,
      `SELECT concat_ws('|',
         has_column_privilege('authenticated', 'public.companies', 'name', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'industry', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'consolidation_approach', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'base_year', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'auto_provisioned', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'onboarding_completed_at', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'onboarding_skipped_at', 'UPDATE'),
         has_column_privilege('authenticated', 'public.companies', 'subscription_plan', 'UPDATE'))`
    );
    // name and industry keep their column grants; nothing else can be written from the browser.
    expect(privileges).toBe('t|t|f|f|f|f|f|f');
  });

  it('creates the edit trail with row level security on, no policy, and an append-only trigger', async () => {
    expect(await psql(CONTAINER, `SELECT concat_ws('|', relrowsecurity::text, (SELECT count(*) FROM pg_policies WHERE tablename = 'entry_history')::text) FROM pg_class WHERE oid = 'public.entry_history'::regclass`)).toBe('true|0');
    expect(await psql(CONTAINER, `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.entry_history'::regclass AND NOT tgisinternal`)).toBe('entry_history_refuse_update');
    expect(await psql(CONTAINER, `SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'emission_entries' AND column_name = 'updated_at'`)).toBe('1');
  });
});
