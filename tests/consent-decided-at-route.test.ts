/**
 * k10 follow-up: POST /api/consent-audit keeps the time the visitor chose
 * (consent_records.decided_at) next to the time the server received the record
 * (created_at). A choice answered with a 429 waits in the browser's outbox and is
 * delivered on a later visit, so created_at alone would read as decided then.
 *
 * The browser's clock is not evidence, so the server takes the time it is sent
 * only inside a window (at most 5 minutes after receipt, at most 30 days before
 * it) and otherwise ignores it: the record is still stored and answered 202,
 * because losing consent evidence over a wrong clock would be worse than losing
 * the time. The exact edges are tested against the function itself
 * (tests/server-security.test.ts); this proves the route, the column and the
 * migration together on a real Postgres.
 *
 * Docker-based (tests/e2e-helpers.ts): a throwaway Postgres with every migration
 * applied, and one spawned server. Run it by its path, on its own. The route
 * allows 10 records a minute per address, so the suite posts 8.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  E2eCleanup,
  applySchema,
  dockerRunPg,
  e2eEnv,
  freePort,
  pgUrl,
  psql,
  psqlFile,
  registerExitSafety,
  spawnServer,
  uniqueContainerName,
  waitForServer,
} from './e2e-helpers';

const CONTAINER = uniqueContainerName('fix-tests-pg-consent');
const MIGRATION = resolve(__dirname, '..', 'migrations', '20260930140000_consent-decided-at.sql');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const cleanup = new E2eCleanup();
let base = '';

beforeAll(async () => {
  registerExitSafety(cleanup);
  try {
    cleanup.container(CONTAINER);
    const pgPort = await dockerRunPg(CONTAINER);
    await applySchema(CONTAINER);
    const server = spawnServer(await freePort(), e2eEnv({ NODE_ENV: 'production', DATABASE_URL: pgUrl(pgPort) }));
    cleanup.track(server.child);
    await waitForServer(server);
    base = server.base;
  } catch (err) {
    await cleanup.teardown();
    throw err;
  }
}, 180_000);

afterAll(async () => {
  await cleanup.teardown();
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function post(visitorId: string, extra: Record<string, unknown> = {}) {
  return fetch(`${base}/api/consent-audit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      consent: { strictlyNecessary: true, analytics: true, preferences: true, marketing: false },
      policyVersion: '1.0.0',
      method: 'accept_all',
      gpc: false,
      dnt: false,
      ...extra,
    }),
  });
}

type Stored = { decided: string | null; received: string };

async function stored(visitorId: string): Promise<Stored> {
  const iso = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
  const row = await psql(
    CONTAINER,
    `SELECT json_build_object('decided', to_char(decided_at AT TIME ZONE 'UTC', ${iso}), 'received', to_char(created_at AT TIME ZONE 'UTC', ${iso}))
       FROM public.consent_records WHERE visitor_id = '${visitorId}'`,
  );
  return JSON.parse(row) as Stored;
}

describe('the migration', () => {
  it('adds one nullable timestamptz column, leaves the rest of the table alone, and can be applied twice', async () => {
    const columns = await psql(
      CONTAINER,
      `SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'consent_records' ORDER BY ordinal_position`,
    );
    expect(columns.split('\n')).toEqual([
      'id:bigint:NO',
      'visitor_id:text:YES',
      'consent:jsonb:NO',
      'policy_version:text:NO',
      'method:text:NO',
      'gpc:boolean:NO',
      'dnt:boolean:NO',
      'user_agent:text:YES',
      'ip_hash:text:YES',
      'created_at:timestamp with time zone:NO',
      'decided_at:timestamp with time zone:YES',
    ]);

    await psqlFile(CONTAINER, readFileSync(MIGRATION, 'utf8')); // IF NOT EXISTS: a second run is a no-op
    expect(await psql(CONTAINER, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'consent_records' AND column_name = 'decided_at'`)).toBe('1');
  });
});

describe('POST /api/consent-audit keeps the decision time (k10 follow-up)', () => {
  it('stores the time of a choice that waited in the outbox for two days, next to the time it was received', async () => {
    const decidedAt = ago(2 * DAY);

    const res = await post('decided-2d', { decidedAt });

    expect(res.status).toBe(202);
    const row = await stored('decided-2d');
    expect(row.decided).toBe(decidedAt);
    // Both times are kept, and they are not the same time. created_at is the
    // database's clock and the test's is the host's (a Docker VM's can drift), so
    // only the two days between them are asserted, with a day of slack.
    expect(Date.parse(row.received) - Date.parse(row.decided ?? '')).toBeGreaterThan(DAY);
  });

  it('takes a browser clock that is a little fast, and a choice 29 days old', async () => {
    const fast = new Date(Date.now() + 4 * MINUTE).toISOString();
    const old = ago(29 * DAY);

    expect((await post('decided-fast', { decidedAt: fast })).status).toBe(202);
    expect((await post('decided-29d', { decidedAt: old })).status).toBe(202);

    expect((await stored('decided-fast')).decided).toBe(fast);
    expect((await stored('decided-29d')).decided).toBe(old);
  });

  it('ignores a time more than 5 minutes ahead, and one older than 30 days, and still stores the record', async () => {
    const ahead = new Date(Date.now() + 6 * MINUTE).toISOString();
    const stale = ago(31 * DAY);

    expect((await post('decided-ahead', { decidedAt: ahead })).status).toBe(202);
    expect((await post('decided-stale', { decidedAt: stale })).status).toBe(202);

    for (const visitor of ['decided-ahead', 'decided-stale']) {
      const row = await stored(visitor);
      expect(row.decided, visitor).toBeNull();
      expect(row.received, visitor).toBeTruthy(); // the record stands on its receipt time
    }
  });

  it('ignores a value that is not a UTC timestamp, whatever it is, and still stores the record', async () => {
    expect((await post('decided-text', { decidedAt: 'yesterday' })).status).toBe(202);
    expect((await post('decided-number', { decidedAt: Date.now() })).status).toBe(202);

    expect((await stored('decided-text')).decided).toBeNull();
    expect((await stored('decided-number')).decided).toBeNull();
  });

  it('stores a record from an older client, which sends no time, with none', async () => {
    expect((await post('decided-absent')).status).toBe(202);

    const row = await stored('decided-absent');
    expect(row.decided).toBeNull();
    expect(row.received).toBeTruthy();
  });
});
