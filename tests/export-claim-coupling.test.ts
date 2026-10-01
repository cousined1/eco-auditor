// F-A-20 / F-A-03: the claims register said customers can export "their own
// workspace data", but the JSON export held the company row, the facilities and
// the entry rows (no activity date, notes, factor or CO2e per entry). The register
// says exactly what the export holds, and this test ties the sentence to the query
// that builds the export, so widening or narrowing the export fails here until
// the evidence text is re-read, instead of misdescribing it quietly. F-B-08 gave
// the export its own query (loadEmissionEntriesForExport) with those fields.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getClaim } from '../src/content/claims';
import { dataFacts } from '../src/content/data-facts';

const { COMPANY_FIELDS } = createRequire(import.meta.url)('../server-company.cjs') as { COMPANY_FIELDS: string[] };
const server = readFileSync(resolve('server.cjs'), 'utf8');

// GET /api/account/export builds its entries with loadEmissionEntriesForExport().
const exportLoader = server.slice(server.indexOf('async function loadEmissionEntriesForExport('));
// Digits too: co2e_kg is one of the columns.
const selected = /SELECT ([a-z0-9_, ]+) FROM emission_entries WHERE company_id = \$1/.exec(exportLoader)?.[1] ?? '';
const columns = selected.split(',').map((column) => column.trim()).filter(Boolean);
const evidence = getClaim('no-proprietary-formats')?.evidence ?? '';

describe('the "no proprietary formats" evidence describes the export as it is built', () => {
  it('finds the query the export uses', () => {
    expect(server).toMatch(/let entries = await loadEmissionEntriesForExport\(companyId\)/);
    expect(columns).toEqual(expect.arrayContaining(['id', 'scope', 'category', 'source', 'amount', 'unit', 'created_at']));
  });

  it('exports what a customer entered and what was applied to it (F-B-08)', () => {
    expect(columns).toEqual(expect.arrayContaining([
      'factor', 'co2e_kg', 'activity_date', 'notes', 'activity_amount', 'activity_unit', 'factor_value', 'factor_source', 'catalog_version',
    ]));
    expect(columns).not.toContain('idempotency_key');
  });

  it('names every entry column the export selects', () => {
    for (const column of columns) expect(evidence, `column ${column}`).toContain(column);
  });

  it('does not say the export lacks a field it now selects', () => {
    const now = ['factor', 'co2e_kg', 'activity_date', 'notes'].filter((column) => columns.includes(column));
    if (now.length > 0) {
      expect(evidence, `the export now selects ${now.join(', ')}: update this evidence text`).not.toMatch(/holds no activity date/);
    }
  });

  it('does not describe the export as "their own workspace data"', () => {
    expect(evidence).not.toMatch(/their own workspace data/);
    expect(evidence).toContain('/api/account/export');
  });
});

// ── VF-4 (final web verification): one typed source for the export description ──────────
// The legal pages, Settings and this register all describe what the export holds. They render
// src/content/data-facts.ts instead of retyping it, and the tests below tie that module to the
// code that builds the file: the five queries' SELECT lists, the payload keys and the cap. When
// one of them moves, change the module (and re-read the pages that render it) in the same
// change; do not just edit the test.
const read = (path: string): string => readFileSync(resolve(path), 'utf8');
// A source slice without its comments: a comment that names entry_history is not a query that reads it.
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const exportSource = code(server.slice(server.indexOf('const EXPORT_MAX_ENTRIES'), server.indexOf("app.post('/api/account/delete-data'")));
// The SELECT list of the query that reads `table` (a RegExp source), searching from `from` onwards.
const selectedBy = (from: string, table: string): string[] => {
  const sql = new RegExp(`SELECT ([a-z0-9_, ]+) FROM ${table} WHERE (?:company_id|id) = \\$1`).exec(server.slice(server.indexOf(from)))?.[1] ?? '';
  return sql.split(',').map((column) => column.trim()).filter(Boolean);
};

describe('the typed export description matches the export the server builds (VF-4)', () => {
  const parts = {
    company: selectedBy('async function loadCompanyExportRow(', 'public\\.companies'),
    facilities: selectedBy('async function loadFacilities(', 'facilities'),
    emissionEntries: selectedBy('async function loadEmissionEntriesForExport(', 'emission_entries'),
    reports: selectedBy('async function loadExportHistory(', 'public\\.reports'),
    csvImports: selectedBy('async function loadExportHistory(', 'public\\.csv_import_events'),
  };
  const { contents, leavesOutNote, limitNote } = dataFacts.export;

  it('finds the five queries the export runs', () => {
    for (const [part, selected] of Object.entries(parts)) expect(selected.length, `the SELECT for ${part}`).toBeGreaterThan(2);
  });

  it('lists, part by part, exactly the columns each query selects', () => {
    for (const [part, selected] of Object.entries(parts)) {
      expect([...dataFacts.export.columns[part as keyof typeof parts]], `${part}: change src/content/data-facts.ts together with the query`).toEqual(selected);
    }
  });

  it('describes exactly the parts the payload carries, and the cap the handler applies', () => {
    const payload = /const payload = \{([\s\S]*?)\n\s*\};/.exec(exportSource)?.[1] ?? '';
    expect([...payload.matchAll(/^\s+(\w+):/gm)].map((match) => match[1])).toEqual(['exportedAt', ...Object.keys(dataFacts.export.columns)]);
    const cap = Number((/const EXPORT_MAX_ENTRIES = ([\d_]+);/.exec(exportSource)?.[1] ?? '').replace(/_/g, ''));
    expect(cap).toBeGreaterThan(0);
    expect(limitNote).toContain(cap.toLocaleString('en-US'));
    expect(exportSource, 'the payload says so when it caps').toMatch(/payload\.notes = notes/);
  });

  it('the words that describe the contents are backed by columns the queries select', () => {
    const WORDS: Array<[RegExp, keyof typeof parts, string[]]> = [
      [/name and industry/, 'company', ['name', 'industry']],
      [/reporting basis and base year/, 'company', ['consolidation_approach', 'base_year']],
      [/emissions entries with their activity/, 'emissionEntries', ['activity_amount', 'activity_unit', 'activity_date']],
      [/emission factor/, 'emissionEntries', ['factor_value', 'factor_source', 'catalog_version']],
      [/CO2e/, 'emissionEntries', ['co2e_kg']],
      [/notes/, 'emissionEntries', ['notes']],
      [/title, period, status and sign-off/, 'reports', ['title', 'period', 'status', 'signoff']],
      [/log of CSV imports/, 'csvImports', ['id', 'created_at']],
    ];
    for (const [phrase, part, needed] of WORDS) {
      expect(contents, `the contents no longer say ${phrase}`).toMatch(phrase);
      expect(parts[part], `${part} must select what "${phrase}" promises`).toEqual(expect.arrayContaining(needed));
    }
  });

  it('says the PDF is not in the file only while no query selects the PDF or its snapshot', () => {
    const selectsPdf = parts.reports.some((column) => column === 'pdf' || column === 'snapshot');
    if (selectsPdf) {
      expect(contents, 'the export now carries the report PDF or snapshot: drop "not the PDF"').not.toMatch(/not the PDF/);
      expect(leavesOutNote).not.toMatch(/report PDFs/);
    } else {
      expect(contents).toMatch(/not the PDF/);
      expect(leavesOutNote).toMatch(/report PDFs/);
    }
  });

  it('says the file leaves out the reporting basis and the edit records only while no query reads them', () => {
    const readsBasis = /consolidation_approach|base_year/.test(exportSource);
    const readsEditRecord = /entry_history/.test(exportSource);
    if (readsBasis) expect(leavesOutNote, 'the export now carries the reporting basis').not.toMatch(/reporting basis/);
    else expect(leavesOutNote).toMatch(/reporting basis \(consolidation approach and base year\)/);
    if (readsEditRecord) expect(leavesOutNote, 'the export now carries the edit records').not.toMatch(/edit records/);
    else expect(leavesOutNote).toMatch(/edit records of entries/);
  });

  it('the register evidence lists the same entry columns, and says where the stored PDF comes from', () => {
    expect(evidence).toContain(dataFacts.export.columns.emissionEntries.join(', '));
    expect(evidence, 'the stored report PDF is rendered by renderReportPdf (K3)').toContain('renderReportPdf');
    expect(read('src/lib/reports/report-generator.cjs')).toMatch(/function renderReportPdf\(/);
    expect(server).toMatch(/renderReportPdf\(snapshot/);
    expect(evidence).not.toMatch(/server\.cjs createSimplePdf/);
  });
});

// ── VF-11: evidence text that the code has since overtaken ───────────────────────────────
describe('the register evidence matches the code it cites (VF-11)', () => {
  it('audit-ready: edits are no longer said to overwrite without history while the edit route writes entry_history', () => {
    const auditReady = getClaim('audit-ready');
    expect(/INSERT INTO public\.entry_history/.test(read('server-entry-routes.cjs')), 'the edit route writes entry_history').toBe(true);
    expect(auditReady?.evidence).not.toMatch(/edits overwrite without history/);
    expect(auditReady?.evidence).toMatch(/entry_history/);
    expect(auditReady?.status, 'the history covers one write path only: the claim stays withdrawn').toBe('unverified');
  });

  it('ghg-protocol-aligned: base-year tracking is not denied while the base year is stored and printed on reports', () => {
    const stored = /ADD COLUMN IF NOT EXISTS base_year/.test(read('migrations/20260930121000_company-onboarding.sql'));
    const printed = /Base year: /.test(read('src/lib/reports/report-generator.cjs'));
    const caveat = getClaim('ghg-protocol-aligned')?.caveat ?? '';
    if (stored && printed) {
      expect(caveat).not.toMatch(/no base-year tracking/);
      expect(caveat).toMatch(/base year is stored and printed on reports/);
    } else {
      expect(caveat).toMatch(/no base-year tracking/);
    }
  });
});

// The company row of the export is the profile the customer enters in Settings plus its dates. K5 added two fields
// to what a customer can enter (the reporting basis and the base year, COMPANY_FIELDS in server-company.cjs); the
// copy says "company profile" without listing columns, so only this query decides what the customer gets back.
// The values themselves are checked on real Postgres in tests/entries-write-api.test.ts.
describe('the company row of the export holds what the customer entered in Settings', () => {
  const companyLoader = server.slice(server.indexOf('async function loadCompanyExportRow('), server.indexOf('async function loadEmissionEntriesForExport('));
  const companyColumns = (/SELECT ([a-z0-9_, ]+) FROM public\.companies WHERE id = \$1/.exec(companyLoader)?.[1] ?? '')
    .split(',').map((column) => column.trim()).filter(Boolean);

  it('finds the query the export uses for the company', () => {
    expect(server).toMatch(/const company = await loadCompanyExportRow\(companyId\)/);
    expect(companyColumns).toEqual(expect.arrayContaining(['id', 'created_at', 'updated_at']));
  });

  it('selects every field the customer can change', () => {
    expect(COMPANY_FIELDS).toEqual(['name', 'industry', 'consolidation_approach', 'base_year']);
    expect(companyColumns).toEqual(expect.arrayContaining(COMPANY_FIELDS));
  });

  it('selects no internal state: no user id, billing column, onboarding state or provisioning flag', () => {
    expect(companyColumns.filter((column) => /^(user_id|auto_provisioned|onboarding_|stripe_|subscription_)/.test(column))).toEqual([]);
  });
});
