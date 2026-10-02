// k10 follow-up: migrations/20260930140000_consent-decided-at.sql is ADDITIVE. The
// run that produced it was told never to put a destructive statement, or the
// deferred REVOKE, in migrations/: a migration runs against production, and one
// that narrows access or drops something cannot be taken back by rolling the code
// back. The behaviour (the column, the route, the window) is tested against a real
// Postgres in tests/consent-decided-at-route.test.ts; this reads the file itself, so
// it runs with the ordinary suite.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = 'migrations/20260930140000_consent-decided-at.sql';
const sql = readFileSync(resolve(FILE), 'utf8');
// The statements, without the comments that explain (and quote) the rollback.
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const server = readFileSync(resolve('server.cjs'), 'utf8');

describe(FILE, () => {
  it('is the only migration with its timestamp', () => {
    const same = readdirSync(resolve('migrations')).filter((name) => name.startsWith('20260930140000'));
    expect(same).toEqual(['20260930140000_consent-decided-at.sql']);
  });

  it('adds one nullable column, re-runnably, and does nothing else to a table', () => {
    expect(statements).toMatch(/ALTER TABLE public\.consent_records\s+ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ\s*;/);
    const column = /ADD COLUMN IF NOT EXISTS decided_at ([^;]*);/.exec(statements)?.[1] ?? '';
    expect(column.trim()).toBe('TIMESTAMPTZ'); // no NOT NULL, no default, no constraint
    expect((statements.match(/ADD COLUMN/g) ?? []).length).toBe(1);
    expect((statements.match(/\b(?:CREATE|ALTER)\s+(?:TABLE|INDEX|TRIGGER|POLICY|FUNCTION)/gi) ?? []).length).toBe(1);
  });

  it.each(['REVOKE', 'GRANT', 'DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT', 'DISABLE', 'CASCADE'])('holds no %s statement', (word) => {
    expect(statements).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });

  it('says how to verify it and how to undo it, as the other migrations of this run do', () => {
    expect(sql).toMatch(/^-- Verify after applying:/m);
    expect(sql).toMatch(/^-- rollback /m);
    expect(sql).toMatch(/^-- ALTER TABLE public\.consent_records DROP COLUMN IF EXISTS decided_at;/m);
  });
});

describe('the server writes only columns a migration gives consent_records', () => {
  it('names decided_at in its INSERT and in the runtime table definition, and every inserted column exists', () => {
    const insert = /INSERT INTO public\.consent_records \(([^)]+)\)/.exec(server);
    expect(insert, 'the consent_records INSERT in server.cjs').toBeTruthy();
    const inserted = (insert?.[1] ?? '').split(',').map((column) => column.trim());
    expect(inserted).toContain('decided_at');

    const fromMigrations = new Set<string>();
    for (const name of readdirSync(resolve('migrations')).filter((file) => file.endsWith('.sql'))) {
      const text = readFileSync(resolve('migrations', name), 'utf8');
      const create = /CREATE TABLE IF NOT EXISTS public\.consent_records \(([\s\S]*?)\n\);/.exec(text);
      for (const line of (create?.[1] ?? '').split('\n')) {
        const column = /^\s*([a-z_]+)\s+[A-Z]/.exec(line)?.[1];
        if (column) fromMigrations.add(column);
      }
      for (const added of text.matchAll(/ALTER TABLE public\.consent_records\s+ADD COLUMN IF NOT EXISTS (\w+)/g)) fromMigrations.add(added[1] ?? '');
    }
    expect(inserted.filter((column) => !fromMigrations.has(column))).toEqual([]);

    const runtime = /CREATE TABLE IF NOT EXISTS public\.consent_records \(([\s\S]*?)\n\s*\);/.exec(server)?.[1] ?? '';
    expect(runtime).toMatch(/\bdecided_at TIMESTAMPTZ\b/);
  });
});
