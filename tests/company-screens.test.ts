// K5 structural guards. The SPA and the server each hold a copy of the company
// option lists (the SPA so the form does not offer what the server refuses, the
// server because it is the authority): a drift between them is a form that offers a
// choice that answers 400. And company writes go through PATCH /api/companies/:id
// only: the server's allow-list, ownership check and onboarding state are not
// reachable from a records-API write.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BASE_YEAR_MIN,
  COMPANY_NAME_MAX,
  CONSOLIDATION_OPTIONS,
  FACILITY_FIELD_MAX,
  INDUSTRIES,
  industryValue,
  nextPlanForFacilities,
  parseBaseYear,
} from '../src/lib/company';
import { FACILITY_TYPES } from '../src/lib/entries';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

const require = createRequire(import.meta.url);
const server = require('../server-company.cjs');
const { buildReportSnapshot, parseReportPeriod } = require('../src/lib/reports/report-snapshot.cjs');
const { buildReportText } = require('../src/lib/reports/report-generator.cjs');

describe('the SPA and the server agree on the company options', () => {
  it('industries, consolidation approaches, the base year floor and the field limits are the same', () => {
    expect([...INDUSTRIES]).toEqual(server.INDUSTRIES);
    expect(CONSOLIDATION_OPTIONS.map((option) => option.value).sort()).toEqual([...server.CONSOLIDATION_APPROACHES].sort());
    expect(BASE_YEAR_MIN).toBe(server.BASE_YEAR_MIN);
    expect(COMPANY_NAME_MAX).toBe(200);
    expect(FACILITY_FIELD_MAX).toBe(server.FACILITY_FIELD_MAX);
    expect(FACILITY_TYPES.map((type) => type.value)).toEqual(server.FACILITY_TYPE_LIST);
  });

  it('every approach the form offers is one a report prints by name; "not chosen yet" prints "not specified"', () => {
    const period = parseReportPeriod('2025').period;
    const printed = (approach: string) => String(buildReportText(buildReportSnapshot({
      company: { id: 1, name: 'Acme', consolidation_approach: approach },
      period, entries: [], facilities: [], generatedAt: '2026-09-30T10:00:00.000Z', generatedBy: 'u',
    }), '2025')).split('\n').find((line) => line.startsWith('Consolidation approach: '));
    for (const { value, label } of CONSOLIDATION_OPTIONS) {
      expect(printed(value)).toBe(value === 'unspecified' ? 'Consolidation approach: not specified' : `Consolidation approach: ${label}`);
    }
  });

  it('a report prints the base year the company set, and says "not set" until it does', () => {
    const period = parseReportPeriod('2025').period;
    const printed = (base_year: number | null) => String(buildReportText(buildReportSnapshot({
      company: { id: 1, name: 'Acme', base_year },
      period, entries: [], facilities: [], generatedAt: '2026-09-30T10:00:00.000Z', generatedBy: 'u',
    }), '2025')).split('\n').find((line) => line.startsWith('Base year: '));
    expect(printed(2019)).toBe('Base year: 2019');
    expect(printed(null)).toBe('Base year: not set');
  });

  it('every industry the form offers passes the server\'s validation, and the server\'s own "other" reads as Other', () => {
    for (const industry of INDUSTRIES) expect(server.validateCompanyUpdate({ industry }, new Date())).toMatchObject({ ok: true });
    expect(industryValue('other')).toBe('Other');
    expect(industryValue('Healthcare')).toBe('Healthcare');
    expect(industryValue(null)).toBe('');
    expect(industryValue('something old')).toBe('');
  });

  it('the base year check is the server\'s: empty, or a four-digit year from 1990 to the current UTC year', () => {
    const now = new Date('2026-01-01T00:30:00Z');
    expect(parseBaseYear('', now)).toEqual({ ok: true, value: null });
    expect(parseBaseYear(' 2019 ', now)).toEqual({ ok: true, value: 2019 });
    // Text the form refuses because it is not a four-digit year (the server takes a number).
    for (const bad of ['abc', '0x7E3', '١٩٩٠', '20e2']) expect(parseBaseYear(bad, now), bad).toMatchObject({ ok: false });
    // Numbers both refuse.
    for (const bad of ['1989', '2027', '20', '2019.5']) {
      expect(parseBaseYear(bad, now), bad).toMatchObject({ ok: false });
      expect(server.validateCompanyUpdate({ base_year: Number(bad) }, now), bad).toMatchObject({ ok: false });
    }
    // Same boundary as the server: the UTC year, not the viewer's.
    expect(parseBaseYear('2026', now)).toMatchObject({ ok: true });
    expect(server.validateCompanyUpdate({ base_year: 2026 }, now)).toMatchObject({ ok: true });
  });

  it('the plan that raises the facility cap is the next one up', () => {
    expect(nextPlanForFacilities('starter')).toBe('growth');
    expect(nextPlanForFacilities('growth')).toBe('pro');
    expect(nextPlanForFacilities('pro')).toBe('pro');
  });
});

const WRITE_CALL = /\.(insert|update|upsert|delete)\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [relative(process.cwd(), path).split('\\').join('/')] : [];
  });
}

/** Every `.from('companies')` query chain (up to the end of its statement) that writes. */
function companyWrites(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\.from\(\s*['"`]companies['"`]\s*\)/g)) {
    const end = source.indexOf(';', match.index);
    const write = WRITE_CALL.exec(source.slice(match.index, end === -1 ? undefined : end));
    if (write) found.push(`companies.${write[1]}`);
  }
  return found;
}

describe('the browser never writes a company through the records API', () => {
  it('finds the chains it inspects (sanity check on the scanner)', () => {
    expect(companyWrites("await insforge.database.from('companies').update({ name }).eq('id', 1);")).toEqual(['companies.update']);
    expect(companyWrites("insforge.database\n  .from(\"companies\")\n  .insert([{ name }]);")).toEqual(['companies.insert']);
    expect(companyWrites("insforge.database.from('companies').select('*').eq('user_id', id).maybeSingle();")).toEqual([]);
  });

  it('no file in src/ inserts, updates, upserts or deletes companies through the SDK: a rename is PATCH /api/companies/:id', () => {
    const offenders = sourceFiles(resolve('src'))
      .map((file) => ({ file, writes: companyWrites(readFileSync(file, 'utf8')) }))
      .filter((result) => result.writes.length > 0);
    expect(offenders).toEqual([]);
  });
});
