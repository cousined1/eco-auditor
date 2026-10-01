// K7 second step (audit AUDIT-RUN-20260929: F-E-02, F-E-09, F-E-10; verifier D-3).
// Where K3's report snapshot meets the 2026-09-30 factor catalog. A signed report
// has to state exactly what the engine computed:
//   - each row is named by the catalog that priced it, and each catalog identity
//     is printed once, in the one spelling the entry API stores (CATALOG_VERSION);
//   - the engine's memo lines (biogenic CO2, non-Kyoto gases), market-based
//     Scope 2, excluded rows and confidence method reach the snapshot and the PDF;
//   - rows priced with the frozen 2026-07-24 catalog keep the disclosures of its
//     older treatments, and only those rows;
//   - a stored schema-1 snapshot still renders exactly as it did.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const snapshotLib = require('../src/lib/reports/report-snapshot.cjs');
const { buildReportText, renderReportPdf } = require('../src/lib/reports/report-generator.cjs');
const { MAX_SNAPSHOT_ENTRY_LINES } = require('../src/lib/reports/report-limits.cjs');
const { summarizeEntries } = require('../emissions-engine.cjs');
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION } = require('../emission-factors.cjs');
const entryApi = require('../server-entries.cjs');
const versions = require('../emission-factors.versions.json');
type Row = Record<string, unknown>;
type Snapshot = Row & {
  schema_version: number;
  total_emissions_tCO2e: number;
  by_scope: Record<string, number>;
  scope2_market_tCO2e: number | null;
  biogenic_co2_t: number;
  non_kyoto_tCO2e: number;
  confidence_score: number;
  confidence_method: string;
  memos: Record<string, number>;
  catalog: { version: string };
  catalogs: Row[];
  datasets: Row[];
  entries: Row[];
  factors: Row[];
  by_facility: Row[];
  by_category: Row[];
  excluded_rows: { count: number; reasons: Row[] };
  excluded_entries: Row[];
};

const v1Snapshot = require('./fixtures/report-snapshot-v1.json') as Snapshot;

const day = (date: string) => ({ created_at: `${date}T00:00:00.000Z`, activity_date: date });
const pinned = { catalog_version: CATALOG_VERSION };

// Stored rows as loadEmissionEntries returns them. No pin: priced by the frozen catalog.
const LEGACY_ROWS: Row[] = [
  { id: '1', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms', ...day('2026-02-01') },
  { id: '2', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'wood', amount: 2, unit: 'short tons', ...day('2026-02-02') },
  { id: '3', facility_id: '7', scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r22', amount: 3, unit: 'kg', ...day('2026-02-03') },
  { id: '4', facility_id: null, scope: 'Scope 2', category: 'purchased_electricity', source: 'RENEWABLE', amount: 50000, unit: 'kWh', ...day('2026-02-04') },
  { id: '5', facility_id: null, scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 10000, unit: 'kWh', ...day('2026-02-05') },
];
// Rows written through the entry API since the 2026-09-30 catalog (K2 pins).
const NEW_ROWS: Row[] = [
  { id: '11', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms', factor_value: 5.31145, factor_source: 'epa-efh-2025', ...pinned, ...day('2026-06-01') },
  { id: '12', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'wood', amount: 10, unit: 'short tons', factor_value: 20.223, factor_source: 'epa-efh-2025', ...pinned, ...day('2026-06-02') },
  { id: '13', facility_id: '7', scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r22', amount: 10, unit: 'kg', factor_value: 1760, factor_source: 'ipcc-ar5-gwp100', ...pinned, ...day('2026-06-03') },
  { id: '14', facility_id: null, scope: 'Scope 2', category: 'renewable_electricity', source: 'CAMX', amount: 100000, unit: 'kWh', factor_value: 0.19504, factor_source: 'epa-egrid-2023', ...pinned, ...day('2026-06-04') },
  { id: '15', facility_id: null, scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 20000, unit: 'kWh', factor_value: 0.19504, factor_source: 'epa-egrid-2023', ...pinned, ...day('2026-06-05') },
];
const BROKEN: Row[] = [
  { id: '21', facility_id: '7', scope: 'Scope 1', category: 'made_up', source: 'x', amount: 1, unit: 'kg', ...day('2026-06-10') },
  { id: '22', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 5, unit: 'therm', ...day('2026-06-11') },
  { id: '23', facility_id: '7', scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 6, unit: 'therm', ...day('2026-06-12') },
];

const PERIOD = snapshotLib.parseReportPeriod('2026').period;
// Generated on a day that is not a catalog version, so a version string in the text is always a catalog.
const build = (rows: Row[]): Snapshot => snapshotLib.buildReportSnapshot({
  company: { id: '3', name: 'Muster AG' }, period: PERIOD, entries: rows,
  facilities: [{ id: '7', name: 'Werk Nord' }], generatedAt: '2026-10-15T09:00:00.000Z', generatedBy: 'user-1',
});
const textOf = (s: Snapshot): string => buildReportText(s, null, { reportId: '7' });
const flat = (s: Snapshot): string => textOf(s).replace(/\s+/g, ' ');
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
const sum = (rows: Row[], key: string) => Math.round(rows.reduce((acc, r) => acc + Number(r[key]), 0) * 1e6) / 1e6;

describe('one identity per factor catalog (verifier D-3)', () => {
  it('a report over legacy and new rows prints each identity once and never mixes them', () => {
    const s = build([...LEGACY_ROWS, ...NEW_ROWS]);
    const text = textOf(s);
    // The string the entry API stores on a row is the one the report prints.
    expect(entryApi.CATALOG_VERSION).toBe(CATALOG_VERSION);
    expect(occurrences(text, CATALOG_VERSION)).toBe(1);
    expect(occurrences(text, LEGACY_CATALOG_VERSION)).toBe(1);
    // No second spelling of either catalog (the bare version) anywhere else.
    const rest = text.split(CATALOG_VERSION).join('').split(LEGACY_CATALOG_VERSION).join('');
    expect(rest).not.toContain(CATALOG_VERSION.split('+')[0]);
    expect(rest).not.toContain(LEGACY_CATALOG_VERSION.split('+')[0]);
    // Each factor line sits under the catalog that priced it.
    const lines = text.split('\n');
    const at = (needle: string) => lines.findIndex((line) => line.includes(needle));
    expect(at('Natural Gas (therms): 5.31145')).toBeGreaterThan(at(CATALOG_VERSION));
    expect(at('Natural Gas (therms): 5.31145')).toBeLessThan(at(LEGACY_CATALOG_VERSION));
    expect(at('Natural Gas (therms): 5.306')).toBeGreaterThan(at(LEGACY_CATALOG_VERSION));
  });

  it('names every row by the catalog that priced it, with that catalog\'s file hash', () => {
    const s = build([...LEGACY_ROWS, ...NEW_ROWS]);
    const byId = new Map(s.entries.map((line: Row) => [line.entry_id, line]));
    for (const row of LEGACY_ROWS) expect(byId.get(row.id), String(row.id)).toMatchObject({ catalog_version: LEGACY_CATALOG_VERSION });
    for (const row of NEW_ROWS) expect(byId.get(row.id), String(row.id)).toMatchObject({ catalog_version: CATALOG_VERSION });
    expect(s.catalog.version).toBe(CATALOG_VERSION);
    expect(s.catalogs).toEqual([
      { version: CATALOG_VERSION, sha256: versions.catalogs[versions.current].sha256, entries: NEW_ROWS.length },
      { version: LEGACY_CATALOG_VERSION, sha256: versions.catalogs[versions.legacy].sha256, entries: LEGACY_ROWS.length },
    ]);
  });

  it('labels and cites a legacy row from its own catalog, not the current one', () => {
    // 0.255 per passenger-mile was a 2026-07-24 internal estimate; 2026-09-30 cites EPA for this source.
    const s = build([{ id: '31', scope: 'Scope 3', category: 'business_travel', source: 'air_short_haul', amount: 1000, unit: 'passenger-miles', ...day('2026-03-01') }]);
    expect(s.entries[0]).toMatchObject({ kg_co2e_per_unit: 0.255, factor_source: 'internal-estimate', catalog_version: LEGACY_CATALOG_VERSION });
    expect(s.datasets).toEqual([{ id: 'internal-estimate', label: snapshotLib.DATASET_LABELS['internal-estimate'] }]);
  });

  it('hashes every catalog the engine prices with exactly as emission-factors.versions.json records it', () => {
    expect(snapshotLib.CATALOG_SHA256_BY_VERSION.size).toBe(Object.keys(versions.catalogs).length);
    for (const [version, entry] of Object.entries(versions.catalogs) as Array<[string, { file: string; sha256: string }]>) {
      expect(snapshotLib.CATALOG_SHA256_BY_VERSION.get(version), version).toBe(entry.sha256);
      expect(createHash('sha256').update(readFileSync(resolve(entry.file))).digest('hex'), entry.file).toBe(entry.sha256);
    }
    expect(snapshotLib.CATALOG_SHA256).toBe(versions.catalogs[versions.current].sha256);
  });
});

describe('the engine\'s memo lines, market-based Scope 2 and exclusions reach the report (F-E-02, F-E-10)', () => {
  it('new entries: memo lines beside the scopes, a market-based total, and the engine\'s own totals', () => {
    const s = build(NEW_ROWS);
    const engine = summarizeEntries(NEW_ROWS, {});
    expect(s).toMatchObject({
      total_emissions_tCO2e: engine.total_emissions_tCO2e,
      by_scope: engine.by_scope,
      scope2_market_tCO2e: engine.scope2_market_tCO2e,
      biogenic_co2_t: engine.biogenic_co2_t,
      non_kyoto_tCO2e: engine.non_kyoto_tCO2e,
      memo_entries: { biogenic_co2: 1, non_kyoto: 1 },
      memos: { biomass: 0, non_kyoto: 0, zero_rated_electricity: 0 },
    });
    expect(s.by_scope.scope1).toBeCloseTo(5.31145 + 0.20223, 6); // R-22 is not in Scope 1
    expect(s.biogenic_co2_t).toBeCloseTo(16.4, 6);
    expect(s.non_kyoto_tCO2e).toBeCloseTo(17.6, 6);
    expect(s.scope2_market_tCO2e).toBeCloseTo(3.9008, 6); // the renewable contract at zero
    // The breakdowns add up to the scope totals; the memo row is an entry line only.
    expect(sum(s.by_facility, 'total')).toBe(s.total_emissions_tCO2e);
    expect(sum(s.by_category, 'tco2e')).toBe(s.total_emissions_tCO2e);
    expect(s.entries.find((line: Row) => line.entry_id === '13')).toMatchObject({ reporting_bucket: 'memo:non-kyoto', tco2e: 17.6 });
    expect(s.entries.find((line: Row) => line.entry_id === '12')).toMatchObject({ reporting_bucket: 'scope1', biogenic_co2_t: 16.4 });

    const lines = textOf(s).split('\n');
    expect(lines).toContain('Scope 2: 23.405 tCO2e (location-based)');
    expect(lines).toContain('Scope 2, market-based: 3.901 tCO2e (reported beside the total, not added to it)');
    const text = flat(s);
    expect(text).toContain('Biogenic CO2 from biomass combustion (1 entry): 16.4 t CO2, reported separately, outside the scopes. Only the CH4 and N2O from burning it count in Scope 1.');
    expect(text).toContain('HCFC-22 and other gases the Kyoto Protocol does not cover (1 entry): 17.6 tCO2e, reported separately, not included in Scope 1.');
    expect(text).toContain('The market-based total counts electricity bought under a renewable contract at zero and all other electricity at its grid factor, because no residual-mix factor is applied.');
    // Limitations that no longer apply to these entries are gone.
    for (const stale of ['included in Scope 1 in full', 'included in Scope 1 here', 'A market-based Scope 2 total is not reported', 'No separate location-based or market-based']) {
      expect(text, stale).not.toContain(stale);
    }
  });

  it('legacy entries keep the disclosures of their older treatments, and only they do', () => {
    const legacy = build(LEGACY_ROWS);
    expect(legacy).toMatchObject({ memos: { biomass: 1, non_kyoto: 1, zero_rated_electricity: 1 }, memo_entries: { biogenic_co2: 0, non_kyoto: 0 }, scope2_market_tCO2e: null });
    const text = flat(legacy);
    expect(text).toContain('Biogenic CO2 (wood or wood-residual combustion, 1 entry priced with an earlier factor catalog): included in Scope 1 in full, not reported separately.');
    expect(text).toContain('HCFC-22 (R-22, 1 entry priced with an earlier factor catalog): not covered by the Kyoto Protocol, but included in Scope 1 here rather than reported separately.');
    expect(text).toContain('- Scope 2: 1 entry of renewable or zero-carbon electricity, priced with an earlier factor catalog, is counted at zero in the location-based total, which is a market-based treatment. Other purchased electricity uses eGRID grid-average (location-based) factors. A market-based Scope 2 total is not reported.');
    expect(text).not.toContain('Scope 2, market-based');

    // Legacy and new rows together: each set of rows keeps its own treatment.
    const mixed = flat(build([...LEGACY_ROWS, ...NEW_ROWS]));
    expect(mixed).toContain('Biogenic CO2 from biomass combustion (1 entry): 16.4 t CO2');
    expect(mixed).toContain('(wood or wood-residual combustion, 1 entry priced with an earlier factor catalog): included in Scope 1 in full');
    expect(mixed).toContain('Scope 2, market-based:');
    expect(mixed).toContain('is counted at zero in the location-based total, which is a market-based treatment.');
    expect(mixed).not.toContain('A market-based Scope 2 total is not reported');
  });

  it('labels the confidence score the way the engine aggregated it (F-E-09)', () => {
    const legacy = build(LEGACY_ROWS);
    const legacyRows = summarizeEntries(LEGACY_ROWS, {}).entries as Array<{ confidence: number }>;
    expect(legacy.confidence_method).toBe('unweighted');
    expect(legacy.confidence_score).toBe(Math.round(legacyRows.reduce((acc, r) => acc + r.confidence, 0) / legacyRows.length));
    expect(textOf(legacy)).toContain('(unweighted average of the per-entry confidence scores)');

    const mixed = build([...LEGACY_ROWS, ...NEW_ROWS]);
    const inScopes = (summarizeEntries([...LEGACY_ROWS, ...NEW_ROWS], {}).entries as Array<{ reporting_bucket: string; co2e_tonnes: number; confidence: number }>)
      .filter((r) => /^scope[123]$/.test(r.reporting_bucket));
    const weight = inScopes.reduce((acc, r) => acc + r.co2e_tonnes, 0);
    expect(mixed.confidence_method).toBe('emissions_weighted');
    expect(mixed.confidence_score).toBe(Math.round(inScopes.reduce((acc, r) => acc + r.co2e_tonnes * r.confidence, 0) / weight));
    expect(textOf(mixed)).toContain("(per-entry confidence scores weighted by each entry's emissions)");
  });

  it('prints the engine\'s excluded rows as "N entries excluded: <reason>" with their ids', () => {
    const s = build([...NEW_ROWS, ...BROKEN]);
    expect(s.excluded_rows).toEqual(summarizeEntries([...NEW_ROWS, ...BROKEN], {}).excluded_rows);
    const text = flat(s);
    expect(text).toContain('- 3 entries could not be calculated and are excluded from every total:');
    expect(text).toContain('2 entries excluded: Unsupported Scope 1 source/unit: natural_gas therm (entries 22, 23)');
    expect(text).toMatch(/1 entry excluded: Unknown category: made_up\. Scope 1 categories: [^()]+ \(entry 21\)/);
  });

  it('keeps memo lines and excluded reasons inside the snapshot bounds, and the omission sentence stays right', () => {
    const memoRows = Array.from({ length: MAX_SNAPSHOT_ENTRY_LINES + 1 }, (_, i) => ({ ...NEW_ROWS[2]!, id: String(1000 + i) }));
    const s = build(memoRows);
    expect(s.entries).toHaveLength(MAX_SNAPSHOT_ENTRY_LINES);
    expect(s).toMatchObject({ entry_count: MAX_SNAPSHOT_ENTRY_LINES + 1, entry_lines_omitted: 1, memo_entries: { non_kyoto: MAX_SNAPSHOT_ENTRY_LINES + 1 } });
    expect(s.non_kyoto_tCO2e).toBeCloseTo((MAX_SNAPSHOT_ENTRY_LINES + 1) * 17.6, 3);
    expect(flat(s)).toContain('- Entry-level lines omitted above 5,000 entries; see the data export. Every total and breakdown in this report covers all 5,001 entries.');

    // 25 different reasons: the engine groups 20; the rest are counted, not dropped.
    const broken = Array.from({ length: 25 }, (_, i) => ({ id: String(9000 + i), scope: 'Scope 1', category: `made_up_${i}`, source: 'x', amount: 1, unit: 'kg', ...day('2026-06-10') }));
    const e = build([...NEW_ROWS, ...broken]);
    expect(e.excluded_rows.reasons).toHaveLength(20);
    expect(e.excluded_entries).toHaveLength(25);
    expect(flat(e)).toContain('5 entries excluded for other reasons (listed in the stored report data).');
  });
});

describe('a stored schema-1 snapshot (K3, before this change)', () => {
  it('still renders byte for byte as it did: text and PDF', () => {
    // Frozen with K3's schema-1 builder and renderer before the change.
    expect(v1Snapshot.schema_version).toBe(1);
    const expected = readFileSync(resolve('tests/fixtures/report-snapshot-v1.txt'), 'utf8');
    expect(buildReportText(v1Snapshot, null, { reportId: '42' }) + '\n').toBe(expected);
    const pdf = renderReportPdf(v1Snapshot, { reportId: '42' });
    expect(createHash('sha256').update(pdf).digest('hex')).toBe('7256abaaa3d146aad89f644dfec348df5f81bf54e771acc6abe78344f7064d5a');
  });

  it('schema 2 only adds to it: every schema-1 field is still there, the memo keys included', () => {
    const s = build([...LEGACY_ROWS, ...NEW_ROWS]);
    expect(s.schema_version).toBe(2);
    expect(snapshotLib.SNAPSHOT_SCHEMA_VERSION).toBe(2);
    for (const key of Object.keys(v1Snapshot)) expect(s, key).toHaveProperty(key);
    for (const key of Object.keys(v1Snapshot.entries[0]!)) expect(s.entries[0], key).toHaveProperty(key);
    for (const key of Object.keys(v1Snapshot.factors[0]!)) expect(s.factors[0], key).toHaveProperty(key);
    expect(Object.keys(s.memos).sort()).toEqual(Object.keys(v1Snapshot.memos).sort());
  });
});
