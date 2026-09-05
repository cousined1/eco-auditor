import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('server.cjs'), 'utf8');
const start = source.indexOf('async function reserveCsvImportQuota(');
const end = source.indexOf('\nasync function loadFacilities(', start);

function fixture(limit: number | null = 10, used = 0, failBatch = 0) {
  const commands: string[] = [];
  const batches: number[] = [];
  let committed = false;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      commands.push(sql);
      if (sql.startsWith('INSERT INTO public.emission_entries')) {
        batches.push(values.length);
        if (batches.length === failBatch) throw new Error('batch failed');
      }
      if (sql === 'COMMIT') committed = true;
      return { rowCount: 1, rows: [{ used }] };
    },
    release() { commands.push('RELEASE'); },
  };
  const reserve: (plan: string, company: number, count: number, persist: (connection: typeof client) => Promise<void>) => Promise<boolean> = runInNewContext(
    source.slice(start, end) + '\nreserveCsvImportQuota',
    { pgPool: { connect: async () => client }, planLimits: () => ({ csvImportsPerMonth: limit }), log: () => {} },
  );
  const persist: (connection: typeof client, entries: Record<string, unknown>[]) => Promise<void> = runInNewContext(
    source.slice(start, end) + '\npersistCsvEntries',
  );
  return { reserve, persist, batches, commands, client, committed: () => committed };
}

describe('CSV quota and persistence transaction', () => {
  it('rolls back the quota if persistence fails', async () => {
    const f = fixture();
    await expect(f.reserve('starter', 1, 2, async () => { throw new Error('insert failed'); }))
      .rejects.toThrow('insert failed');
    expect(f.commands).toContain('ROLLBACK');
    expect(f.committed()).toBe(false);
    expect(f.commands.at(-1)).toBe('RELEASE');
  });

  it.each([10, null])('persists on the same connection before committing (limit %s)', async (limit) => {
    const f = fixture(limit);
    let persisted = false;
    expect(await f.reserve('starter', 1, 2, async (connection) => {
      expect(connection).toBe(f.client);
      expect(f.committed()).toBe(false);
      persisted = true;
    })).toBe(true);
    expect(persisted).toBe(true);
    expect(f.committed()).toBe(true);
  });

  it('does not persist when the locked quota is exhausted', async () => {
    const f = fixture(10, 10);
    let persisted = false;
    expect(await f.reserve('starter', 1, 1, async () => { persisted = true; })).toBe(false);
    expect(persisted).toBe(false);
    expect(f.commands).toContain('ROLLBACK');
  });

  it('batches large uploads below the protocol parameter limit', async () => {
    const f = fixture();
    const entries = Array.from({ length: 5118 }, () => ({ company_id: 1, amount: 0 }));
    await f.reserve('starter', 1, entries.length, (client) => f.persist(client, entries));
    expect(f.batches).toEqual([14000, 14000, 14000, 14000, 14000, 1652]);
    expect(f.commands.at(-2)).toBe('COMMIT');
  });

  it('rolls back earlier batches and quota when a later batch fails', async () => {
    const f = fixture(10, 0, 2);
    const entries = Array.from({ length: 2001 }, () => ({ company_id: 1, amount: 0 }));
    await expect(f.reserve('starter', 1, entries.length, (client) => f.persist(client, entries)))
      .rejects.toThrow('batch failed');
    expect(f.batches).toHaveLength(2);
    expect(f.commands.at(-2)).toBe('ROLLBACK');
    expect(f.committed()).toBe(false);
  });
});
