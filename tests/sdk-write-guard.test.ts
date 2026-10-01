// K2 structural guard: the SPA writes emission_entries and facilities through
// the server API only (src/lib/entries.ts -> server.cjs), where the plan, the
// trial end, the Scope 3 gate, the facility cap and the factor computation run.
// A records-API write from the browser skips all of them, which is exactly what
// the calculator and onboarding used to do (audit F-D-01, F-E-05). Reading
// through the records API is still allowed.
//
// The database-level backstop is the deferred REVOKE in
// docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql; until
// it is applied, this test is what keeps a new code path from reopening the hole.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SERVER_OWNED_TABLES = ['emission_entries', 'facilities'];
const WRITE_CALL = /\.(insert|update|upsert|delete)\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [relative(process.cwd(), path).split('\\').join('/')] : [];
  });
}

/** Every `.from('<table>')` query chain in a file (up to the end of its statement) that writes. */
function sdkWrites(source: string): string[] {
  const found: string[] = [];
  const from = /\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g;
  for (const match of source.matchAll(from)) {
    if (!SERVER_OWNED_TABLES.includes(match[1] ?? '')) continue;
    const chain = source.slice(match.index, source.indexOf(';', match.index) === -1 ? undefined : source.indexOf(';', match.index));
    const write = WRITE_CALL.exec(chain);
    if (write) found.push(`${match[1]}.${write[1]}`);
  }
  return found;
}

describe('the browser never writes server-owned tables through the records API', () => {
  it('finds the query chains it inspects (sanity check on the scanner)', () => {
    expect(sdkWrites("await insforge.database\n  .from('emission_entries')\n  .insert([{ amount: 1 }]);")).toEqual(['emission_entries.insert']);
    expect(sdkWrites("insforge.database.from(\"facilities\").delete().eq('id', 1);")).toEqual(['facilities.delete']);
    expect(sdkWrites("insforge.database.from('facilities').select('*').eq('company_id', 1);")).toEqual([]);
    expect(sdkWrites("insforge.database.from('companies').update({ name });")).toEqual([]);
  });

  it('no file in src/ inserts, updates, upserts or deletes emission_entries or facilities through the SDK', () => {
    const offenders = sourceFiles(resolve('src'))
      .map((file) => ({ file, writes: sdkWrites(readFileSync(file, 'utf8')) }))
      .filter((result) => result.writes.length > 0);
    expect(offenders).toEqual([]);
  });
});
