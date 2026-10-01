// @vitest-environment node
/**
 * K4 (F-C-06; review R2: "import it in CI so it cannot drift the way the sample
 * report did"): the template Data Intake offers is run through the importer.
 * Every example row is valid, every column it names is one the importer reads,
 * the date column is in it, and a template uploaded unchanged is flagged before
 * anything is stored. Before K4 there was no template, and the public sample CSV
 * was refused ("missing required column: source").
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import catalog from '../emission-factors.json';
import { CATALOG_REFERENCE, CSV_COLUMNS, TEMPLATE_EXAMPLE_ROWS, buildCsvTemplate } from '../src/lib/csvTemplate';

const require = createRequire(import.meta.url);
const csv = require('../server-csv-import.cjs');
const { getCategory } = require('../emission-factors.cjs');

describe('the CSV template', () => {
  const report = csv.validateCsvImport(buildCsvTemplate(), { now: new Date('2026-09-30T12:00:00Z') });

  it('imports without an error: every example row is priced from the catalog', () => {
    expect(report.errors).toEqual([]);
    expect(report.rows).toHaveLength(TEMPLATE_EXAMPLE_ROWS.length);
    expect(report.rows.every((row: { entry: { factor_value: number } }) => row.entry.factor_value > 0)).toBe(true);
  });

  it('is flagged as the template when uploaded unchanged, and needs no Scope 3 plan', () => {
    expect(report.warnings).toEqual([`${TEMPLATE_EXAMPLE_ROWS.length} rows (lines 2, 3 and 4) are the template's example rows: replace them with your own data or delete them.`]);
    expect(report.hasScope3).toBe(false);
  });

  it('carries the required columns and the date column, and names only columns the importer reads', () => {
    const header = buildCsvTemplate().split('\r\n')[0]!.split(',');
    expect(header).toEqual(expect.arrayContaining([...csv.REQUIRED_COLUMNS, 'date']));
    expect([...csv.REQUIRED_COLUMNS, ...csv.OPTIONAL_COLUMNS].sort()).toEqual(CSV_COLUMNS.map((column) => column.name).sort());
    expect(CSV_COLUMNS.filter((column) => column.required).map((column) => column.name)).toEqual(csv.REQUIRED_COLUMNS);
  });

  it('the allowed values on the page are the ones the importer accepts, all of them', () => {
    expect(CATALOG_REFERENCE.map((category) => category.key)).toEqual(catalog.categories.map((category) => category.key));
    // The importer resolves sources through the registry's index (sourcesFrom included).
    const accepted = (key: string) => [...new Set(getCategory(key).sourceIndex.values())] as Array<{ key: string; units: Record<string, number> }>;
    expect(CATALOG_REFERENCE.flatMap((category) => category.sources.map((source) => `${category.key}/${source.key}:${source.units.join('|')}`)))
      .toEqual(catalog.categories.flatMap((category) => accepted(category.key).map((source) => `${category.key}/${source.key}:${Object.keys(source.units).join('|')}`)));
  });

  it('renewable_electricity lists the eGRID subregions it borrows, and purchased_electricity says where a renewable contract goes', () => {
    const byKey = (key: string) => CATALOG_REFERENCE.find((category) => category.key === key)!;
    expect(byKey('renewable_electricity').sources.map((source) => source.key)).toContain('CAMX');
    expect(byKey('renewable_electricity').sources).toEqual(byKey('purchased_electricity').sources);
    expect(byKey('purchased_electricity').hint).toMatch(/renewable_electricity/);
  });
});
