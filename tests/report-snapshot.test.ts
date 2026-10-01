// K3 (audit AUDIT-RUN-20260929: F-E-03, F-B-04, F-B-05, F-E-08, F-E-16, F-G-20).
// The pure half of frozen reports: which period a report covers, what the
// stored snapshot holds, and what its PDF says. The HTTP and database half
// (generate -> change data -> download is byte-identical, sign-off 409, tenant
// isolation) is tests/report-snapshots-route.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMISSION_FACTOR_REGISTRY } from '../src/lib/emission-factors/registry';

const require = createRequire(import.meta.url);
const snapshotLib = require('../src/lib/reports/report-snapshot.cjs');
const { buildReportText, renderReportPdf, textWidth, TEXT_WIDTH } = require('../src/lib/reports/report-generator.cjs');
const { summarizeEntries } = require('../emissions-engine.cjs');
const catalog = require('../emission-factors.json');
// The report's identity is the current catalog; a row without a pin (all of
// R2_ROWS) is priced, and so named, by the frozen 2026-07-24 one (K7).
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION } = require('../emission-factors.cjs') as { CATALOG_VERSION: string; LEGACY_CATALOG_VERSION: string };

type Period = { type: string; value: string; start: string; end: string; label: string };
type Row = Record<string, unknown>;
type Snapshot = Row & {
  total_emissions_tCO2e: number;
  by_scope: Record<string, number>;
  entry_count: number;
  period: Row;
  entries: Row[];
  by_facility: Row[];
  by_category: Row[];
  datasets: Array<{ id: string }>;
  excluded_entries: Row[];
  memos: Record<string, number>;
  catalog: Row;
};
const { parseReportPeriod, reportingPeriodBounds, defaultReportingYear, entryPeriodDate, buildReportSnapshot, DATASET_LABELS, CATALOG_SHA256 } =
  snapshotLib as {
    parseReportPeriod: (raw: unknown) => { ok: true; period: Period } | { ok: false; error: string };
    reportingPeriodBounds: (period: unknown) => { start: string; end: string } | null;
    defaultReportingYear: (now?: Date) => string;
    entryPeriodDate: (entry: Row) => string | null;
    buildReportSnapshot: (input: Row) => Snapshot;
    DATASET_LABELS: Record<string, string>;
    CATALOG_SHA256: string;
  };

const period = (raw: string): Period => {
  const parsed = parseReportPeriod(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.period;
};

// The audit's reproduction tenant (review R2 §4c): FY2025 5.306 t, FY2026 20.525 t.
const R2_ROWS = [
  { id: '101', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms', confidence: 90, created_at: '2025-06-30T00:00:00.000Z', activity_date: '2025-06-30' },
  { id: '102', facility_id: '7', scope: 'Scope 1', category: 'mobile_combustion', source: 'diesel', amount: 100, unit: 'gallons', confidence: 88, created_at: '2026-03-31T00:00:00.000Z', activity_date: '2026-03-31' },
  { id: '103', facility_id: null, scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 100000, unit: 'kWh', confidence: 97, created_at: '2026-05-31T00:00:00.000Z', activity_date: '2026-05-31' },
];
const inPeriod = (rows: Array<Record<string, unknown>>, p: Period) =>
  rows.filter((row) => { const day = entryPeriodDate(row); return day !== null && day >= p.start && day <= p.end; });

const COMPANY = { id: '3', name: 'Müller Umwelt GmbH' };
const FACILITIES = [{ id: '7', name: 'Werk Süd' }];
const GENERATED_AT = '2026-09-30T14:22:05.123Z';
const snapshotFor = (rows: Array<Record<string, unknown>>, p: Period) =>
  buildReportSnapshot({ company: COMPANY, period: p, entries: inPeriod(rows, p), facilities: FACILITIES, generatedAt: GENERATED_AT });

describe('reporting period (F-E-03, F-B-05)', () => {
  it('accepts a calendar year and an inclusive date range, and nothing else', () => {
    expect(period('2025')).toEqual({ type: 'calendar_year', value: '2025', start: '2025-01-01', end: '2025-12-31', label: 'Calendar year 2025' });
    expect(period('2025-04-01/2026-03-31')).toMatchObject({ type: 'custom', value: '2025-04-01/2026-03-31', start: '2025-04-01', end: '2026-03-31' });
    // A range that is exactly a calendar year is stored as that year.
    expect(period('2025-01-01/2025-12-31').value).toBe('2025');
    for (const bad of ['FY2025', 'All time', '', '25', '2025-2026', '2025-02-30/2025-03-31', '2026-03-01/2025-03-01', '1989', '2101', null, {}, ['2025']]) {
      expect(parseReportPeriod(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('caps a date range at 53 weeks, so a custom range cannot bring back "All time"', () => {
    expect(parseReportPeriod('2025-01-01/2026-01-06').ok).toBe(true); // 371 days
    expect(parseReportPeriod('2025-01-01/2026-01-07').ok).toBe(false); // 372 days
    expect(parseReportPeriod('2020-01-01/2026-12-31').ok).toBe(false);
  });

  it('gives the bounds the dashboard query uses, and none for a string that is not a period', () => {
    expect(reportingPeriodBounds('2026')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(reportingPeriodBounds('2025-04-01/2026-03-31')).toEqual({ start: '2025-04-01', end: '2026-03-31' });
    expect(reportingPeriodBounds('FY2025')).toBeNull();
  });

  it('defaults to the calendar year the dashboard opens on', () => {
    expect(defaultReportingYear(new Date(2026, 8, 30))).toBe('2026');
    expect(defaultReportingYear(new Date(2027, 0, 1))).toBe('2027');
  });

  it('places an entry by its activity date, else by the day it was recorded (review R2)', () => {
    expect(entryPeriodDate({ activity_date: '2025-12-31', created_at: '2026-01-05T10:00:00Z' })).toBe('2025-12-31');
    expect(entryPeriodDate({ activity_date: null, created_at: '2026-01-05T10:00:00Z' })).toBe('2026-01-05');
    expect(entryPeriodDate({ created_at: new Date('2026-02-01T23:30:00Z') })).toBe('2026-02-01');
    // node-postgres hands a DATE back as local midnight.
    expect(entryPeriodDate({ activity_date: new Date(2025, 5, 30), created_at: '2026-01-05T10:00:00Z' })).toBe('2025-06-30');
  });
});

describe('report snapshot (F-B-04, F-G-20, F-E-08)', () => {
  it('reports the period the dashboard shows, with the dashboard\'s own numbers', () => {
    const fy2026 = snapshotFor(R2_ROWS, period('2026'));
    const dashboard = summarizeEntries(inPeriod(R2_ROWS, period('2026')), {});
    expect(fy2026.total_emissions_tCO2e).toBe(dashboard.total_emissions_tCO2e);
    expect(fy2026.by_scope).toEqual(dashboard.by_scope);
    expect(fy2026.total_emissions_tCO2e).toBeCloseTo(20.525, 3);
    expect(snapshotFor(R2_ROWS, period('2025')).total_emissions_tCO2e).toBeCloseTo(5.306, 3);
    expect(fy2026.entry_count).toBe(2);
    expect(fy2026.period).toMatchObject({ value: '2026', start: '2026-01-01', end: '2026-12-31' });
  });

  it('stores per-entry, per-facility and per-category lines that add up to the totals', () => {
    const s = snapshotFor(R2_ROWS, period('2026'));
    const sum = (rows: Row[], key: string) => Math.round(rows.reduce((acc, r) => acc + Number(r[key]), 0) * 1e6) / 1e6;
    expect(sum(s.entries, 'tco2e')).toBe(s.total_emissions_tCO2e);
    expect(sum(s.by_facility, 'total')).toBe(s.total_emissions_tCO2e);
    expect(sum(s.by_category, 'tco2e')).toBe(s.total_emissions_tCO2e);
    expect(s.by_facility.map((f) => f.name)).toEqual(['Werk Süd', 'No facility assigned']);
    expect(s.entries[0]).toMatchObject({
      entry_id: '102', date: '2026-03-31', scope: 'Scope 1', source: 'diesel', amount: 100, unit: 'gallons',
      kg_co2e_per_unit: 10.21, factor_source: 'epa-efh-2025', catalog_version: LEGACY_CATALOG_VERSION,
    });
  });

  it('records the factor catalog it was calculated with, by version and by content hash', () => {
    const s = snapshotFor(R2_ROWS, period('2026'));
    const fileHash = createHash('sha256').update(readFileSync(resolve('emission-factors.json'))).digest('hex');
    expect(CATALOG_SHA256).toBe(fileHash);
    expect(s.catalog).toEqual({ version: CATALOG_VERSION, sha256: fileHash, gwp_basis: catalog.gwpBasis, basis: catalog.basis });
    // The catalog that actually priced these rows, by its own version and file hash.
    const legacyHash = createHash('sha256').update(readFileSync(resolve('emission-factors.v1.json'))).digest('hex');
    expect(s.catalogs).toEqual([{ version: LEGACY_CATALOG_VERSION, sha256: legacyHash, entries: 2 }]);
    expect(s.datasets.map((d) => d.id).sort()).toEqual(['epa-efh-2025', 'epa-egrid-2023']);
  });

  it('lists rows that cannot be calculated as exclusions, outside every total', () => {
    const rows = [...R2_ROWS, { id: '104', scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 500, unit: 'therm', created_at: '2026-07-15T00:00:00.000Z' }];
    const s = snapshotFor(rows, period('2026'));
    expect(s.entry_count).toBe(2);
    expect(s.excluded_entries).toEqual([
      expect.objectContaining({ entry_id: '104', date: '2026-07-15', reason: expect.stringContaining('natural_gas therm') }),
    ]);
    expect(s.total_emissions_tCO2e).toBeCloseTo(20.525, 3);
  });

  it('flags the rows whose GHG Protocol treatment the report must disclose', () => {
    const rows = [
      { id: '1', scope: 'Scope 1', category: 'stationary_combustion', source: 'wood', amount: 1, unit: 'short tons', created_at: '2026-02-01T00:00:00Z' },
      { id: '2', scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r_22', amount: 1, unit: 'kg', created_at: '2026-02-01T00:00:00Z' },
      { id: '3', scope: 'Scope 2', category: 'purchased_electricity', source: 'renewable', amount: 100, unit: 'kWh', created_at: '2026-02-01T00:00:00Z' },
    ];
    expect(snapshotFor(rows, period('2026')).memos).toEqual({ biomass: 1, non_kyoto: 1, zero_rated_electricity: 1 });
  });

  it('uses per-row factor pinning when a row carries it, and the catalog otherwise', () => {
    const pinned = { ...R2_ROWS[1]!, factor_value: 10.21, factor_source: 'epa-efh-2025', catalog_version: '2026-07-01' };
    const s = snapshotFor([pinned], period('2026'));
    // An unknown pin is classified by the frozen catalog (emission-factors.cjs
    // catalogFor); the stored string is kept beside the identity that priced it.
    expect(s.entries[0]).toMatchObject({
      factor_source: 'epa-efh-2025', catalog_version: LEGACY_CATALOG_VERSION, pinned_catalog_version: '2026-07-01', pinned_factor_value: 10.21, kg_co2e_per_unit: 10.21,
    });
    expect(snapshotFor([R2_ROWS[1]!], period('2026')).entries[0]).not.toHaveProperty('pinned_factor_value');
  });

  it('stores at most 5,000 entry lines, keeps every total, and the PDF says so (VERIFY-W2A-DATA F5)', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ ...R2_ROWS[1]!, id: String(10_000 + i) }));
    const s = snapshotFor(rows, period('2026'));
    expect(s.entries).toHaveLength(5000);
    expect(s.entries.at(-1)).toMatchObject({ entry_id: '14999' });
    expect(s).toMatchObject({ entry_count: 5001, entry_lines_omitted: 1, excluded_lines_omitted: 0 });
    expect(s.total_emissions_tCO2e).toBeCloseTo(5001 * 1.021, 3);
    expect(s.by_facility).toEqual([expect.objectContaining({ name: 'Werk Süd', entries: 5001 })]);
    expect(s.by_category).toEqual([expect.objectContaining({ entries: 5001 })]);

    const flat = buildReportText(s, null, { reportId: '42' }).replace(/\s+/g, ' ');
    expect(flat).toContain('- Entry-level lines omitted above 5,000 entries; see the data export.');
    expect(flat).toContain('covers all 5,001 entries.');
    expect(buildReportText(snapshotFor(rows.slice(0, 5000), period('2026')), null)).not.toContain('Entry-level lines omitted');
  });

  it('is a pure function of its inputs and survives a JSON round trip unchanged', () => {
    const a = snapshotFor(R2_ROWS, period('2026'));
    const b = snapshotFor(R2_ROWS, period('2026'));
    expect(b).toEqual(a);
    // What the database stores (JSONB) is what the PDF was rendered from.
    const stored = JSON.parse(JSON.stringify(a));
    expect(stored).toEqual(a);
    expect(renderReportPdf(stored, { reportId: '42' }).equals(renderReportPdf(a, { reportId: '42' }))).toBe(true);
  });

  it('names every factor source the catalog cites, in step with the registry', () => {
    const cited = new Set<string>();
    for (const category of catalog.categories) for (const source of category.sources) cited.add(source.factorSource);
    for (const id of cited) expect(DATASET_LABELS[id], id).toBeTruthy();
    for (const entry of EMISSION_FACTOR_REGISTRY.filter((e) => e.verified && cited.has(e.id))) {
      expect(DATASET_LABELS[entry.id], entry.id).toContain(entry.label);
    }
    expect(DATASET_LABELS['internal-estimate']).toMatch(/not a published dataset/);
  });
});

// A structural guard beside the Docker-based behaviour test, so CI without
// Docker still fails if someone brings back re-rendering on download.
describe('server report routes never recompute a stored report (F-B-04)', () => {
  const server = readFileSync(resolve('server.cjs'), 'utf8');
  const route = (marker: string) => {
    const rest = server.slice(server.indexOf(marker));
    return rest.slice(0, rest.indexOf('\napp.', 10));
  };

  it('the download serves the stored bytes: no rendering, no entry reads', () => {
    const download = route("app.get('/api/reports/:id/download'");
    expect(download).toContain('SELECT pdf, pdf_sha256 FROM public.reports');
    expect(download).not.toMatch(/renderReportPdf|buildReportText|createSimplePdf|loadEmissionEntries|summarizeEntries|buildReportSnapshot/);
  });

  it('a report PDF is rendered in exactly one place: when it is generated', () => {
    expect(server.match(/renderReportPdf\(/g)).toHaveLength(1);
    expect(route("app.post('/api/companies/:id/reports/generate'")).toContain('renderReportPdf(');
  });
});

describe('report PDF content (F-E-08, F-E-16)', () => {
  const s = snapshotFor(R2_ROWS, period('2026'));
  const text = buildReportText(s, null, { reportId: '42' });

  it('states what the GHG Protocol requires, as far as the data allows, without inventing any of it', () => {
    for (const line of [
      'Company: Müller Umwelt GmbH',
      'Report ID: 42',
      'Reporting period: Calendar year 2026 (2026-01-01 to 2026-12-31)',
      'Generated: 2026-09-30 14:22 UTC',
      'Total: 20.525 tCO2e',
      'Consolidation approach: not specified',
      'Reported as a CO2e aggregate; per-gas breakdown not available.',
      'Base year: not set',
      'Scopes covered: Scope 1, Scope 2. Scope 3: not reported.',
    ]) {
      expect(text.split('\n'), line).toContain(line);
    }
    expect(text).toContain('FACILITY BREAKDOWN');
    expect(text).toMatch(/Werk Süd: Scope 1 1\.021/);
    expect(text).toContain(`Emission factor catalog: version ${CATALOG_VERSION}, SHA-256 ${CATALOG_SHA256.slice(0, 16)}`);
    expect(text).toMatch(/Factor datasets used: US EPA GHG Emission Factors Hub 2025; US EPA eGRID2023/);
    expect(text).toContain('- Scope 3: not reported.');
    expect(text).toMatch(/not been reviewed or assured by an independent third party/);
  });

  it('makes no claim of assurance or audit-readiness, and never says "All time"', () => {
    expect(text).not.toMatch(/audit[- ]ready|assurance[- ]ready|verified by|certified|third-party assured/i);
    expect(text).not.toContain('All time');
  });

  it('prints a non-ASCII company name in WinAnsi, with UTF-16 metadata, across more than one page', () => {
    const pdf = renderReportPdf(s, { reportId: '42' });
    const latin1 = pdf.toString('latin1');
    expect(latin1).toContain('Company: Müller Umwelt GmbH'); // ü is the single byte 0xFC
    expect(pdf.includes(Buffer.from('Müller', 'utf8'))).toBe(false); // no UTF-8 mojibake
    expect(latin1).toMatch(/\/Encoding \/WinAnsiEncoding/);
    expect(latin1).toContain('/CreationDate (D:20260930142205Z)');
    const title = /\/Title <FEFF([0-9A-F]+)>/.exec(latin1)?.[1] ?? '';
    expect(Buffer.from(title, 'hex').swap16().toString('utf16le')).toBe('Emissions report - Müller Umwelt GmbH - Calendar year 2026');
    expect(Number(/\/Count (\d+)/.exec(latin1)?.[1])).toBeGreaterThanOrEqual(2);
    expect(latin1).toContain('Page 2 of');
  });

  it('wraps every line inside the page, even for long names in wide letters (no clipping)', () => {
    const wide = 'ÆØÅ WMWMWM Œuvre Überseehandel Ålesund GmbH & Co. KG — Werk Nord-Süd Ost '.repeat(3).trim();
    const facilities = [{ id: '7', name: wide.slice(0, 200) }];
    const long = buildReportSnapshot({ company: { id: '3', name: wide.slice(0, 200) }, period: period('2026'), entries: inPeriod(R2_ROWS, period('2026')), facilities, generatedAt: GENERATED_AT });
    const lines = buildReportText(long, null, { reportId: '42' }).split('\n');
    expect(lines.length).toBeGreaterThan(text.split('\n').length);
    for (const line of lines) expect(textWidth(line), line).toBeLessThanOrEqual(TEXT_WIDTH);
  });

  it('keeps at most three decimals (kilogram precision) instead of raw engine floats', () => {
    const odd = { ...s, total_emissions_tCO2e: 153.67442, by_scope: { scope1: 153.67442, scope2: 0, scope3: 0 } };
    expect(buildReportText(odd, null).split('\n')).toContain('Total: 153.674 tCO2e');
  });
});
