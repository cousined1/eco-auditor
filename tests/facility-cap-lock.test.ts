// @vitest-environment node
/**
 * F-X1-01: six parallel "add facility" requests at a cap of 1 created six
 * facilities, because the route counted in one statement and inserted in
 * another. insertFacilityWithinCap counts and inserts in one transaction after
 * locking the company row, like reserveCsvImportQuota. These tests drive it with
 * a fake client (no database); tests/entries-write-api.test.ts repeats the race
 * against real Postgres.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { insertFacilityWithinCap } = require('../server-entry-routes.cjs');

const FACILITY = { companyId: '7', name: 'Plant', type: 'factory', city: 'Fresno' };

/** Records every statement; the company exists and already has `used` facilities. */
function recordingPool(used: number, failInsert = false) {
  const commands: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      commands.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('FROM public.companies')) return { rowCount: 1, rows: [{ id: 7 }] };
      if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ used }] };
      if (sql.includes('INSERT INTO public.facilities')) {
        if (failInsert) throw Object.assign(new Error('insert failed'), { code: '23514' });
        return { rowCount: 1, rows: [{ id: '12', company_id: params[0], name: params[1], type: params[2], city: params[3] }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {
      commands.push('RELEASE');
    },
  };
  return { pool: { connect: async () => client }, commands };
}

/**
 * A company row lock that really serialises (SELECT ... FOR UPDATE waits until
 * the holder commits or rolls back) over a shared facility count.
 */
function lockingDatabase() {
  let committed = 0;
  let held: Promise<void> | null = null;
  function connect() {
    let unlock: (() => void) | null = null;
    let inserted = 0;
    return {
      async query(sql: string) {
        if (sql.includes('FROM public.companies')) {
          // Only FOR UPDATE takes the row lock; a plain read does not wait.
          if (sql.includes('FOR UPDATE')) {
            while (held) await held;
            held = new Promise<void>((resolve) => { unlock = resolve; });
          }
          return { rowCount: 1, rows: [{ id: 7 }] };
        }
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ used: committed }] };
        if (sql.includes('INSERT INTO public.facilities')) {
          inserted += 1;
          return { rowCount: 1, rows: [{ id: String(committed + inserted) }] };
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (sql === 'COMMIT') committed += inserted;
          inserted = 0;
          // Ending the transaction releases the lock, if this client holds it.
          const release = unlock as (() => void) | null;
          if (release) {
            unlock = null;
            held = null;
            release();
          }
        }
        return { rowCount: 0, rows: [] };
      },
      release() {},
    };
  }
  return { pool: { connect: async () => connect() }, count: () => committed };
}

describe('insertFacilityWithinCap', () => {
  it('locks the company row, then counts, then inserts, in one transaction', async () => {
    const { pool, commands } = recordingPool(0);
    const outcome = await insertFacilityWithinCap(pool, { ...FACILITY, plan: 'starter' });
    expect(outcome).toEqual({ facility: { id: '12', company_id: '7', name: 'Plant', type: 'factory', city: 'Fresno' } });
    expect(commands.map((sql) => sql.split(' ').slice(0, 5).join(' '))).toEqual([
      'BEGIN',
      'SET LOCAL row_security = off',
      'SELECT id FROM public.companies WHERE',
      'SELECT COUNT(*)::int AS used FROM',
      'INSERT INTO public.facilities (company_id, name,',
      'COMMIT',
      'RELEASE',
    ]);
    expect(commands[2]).toMatch(/WHERE id = \$1 FOR UPDATE$/);
  });

  it('at the cap it refuses with the plan verdict and inserts nothing', async () => {
    const { pool, commands } = recordingPool(1);
    expect(await insertFacilityWithinCap(pool, { ...FACILITY, plan: 'starter' }))
      .toEqual({ refused: { allowed: false, limit: 1, requiredPlan: 'growth' } });
    expect(commands.some((sql) => sql.startsWith('INSERT'))).toBe(false);
    expect(commands.slice(-2)).toEqual(['COMMIT', 'RELEASE']);
  });

  it('follows plan-limits.json: Growth stops at 5, Pro has no cap', async () => {
    expect(await insertFacilityWithinCap(recordingPool(5).pool, { ...FACILITY, plan: 'growth' }))
      .toEqual({ refused: { allowed: false, limit: 5, requiredPlan: 'pro' } });
    expect(await insertFacilityWithinCap(recordingPool(500).pool, { ...FACILITY, plan: 'pro' })).toHaveProperty('facility');
  });

  it('a failed insert rolls back and still releases the connection', async () => {
    const { pool, commands } = recordingPool(0, true);
    await expect(insertFacilityWithinCap(pool, { ...FACILITY, plan: 'starter' })).rejects.toThrow('insert failed');
    expect(commands.slice(-2)).toEqual(['ROLLBACK', 'RELEASE']);
    expect(commands).not.toContain('COMMIT');
  });

  it('six parallel requests at a cap of 1 create exactly one facility', async () => {
    const database = lockingDatabase();
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, i) => insertFacilityWithinCap(database.pool, { ...FACILITY, name: `Plant ${i}`, plan: 'starter' })),
    );
    expect(outcomes.filter((outcome) => outcome.facility)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.refused)).toHaveLength(5);
    expect(database.count()).toBe(1);
  });
});
