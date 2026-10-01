// @vitest-environment node
/**
 * scripts/restate-legacy-rows.cjs is the owner's dry run before restating
 * older entries onto the current catalog (docs/runbooks/factor-restatement.md).
 * It must show old and new figures per company and year and per row, and it
 * must not be able to write: no --apply, a READ ONLY database session, no
 * INSERT/UPDATE/DELETE statement anywhere in it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildReport } = require('../scripts/restate-legacy-rows.cjs');
const { CATALOG_VERSION } = require('../emission-factors.cjs');
const { rows } = require('./fixtures/legacy-emission-rows.json');
const expected = require('./fixtures/legacy-emission-expected.json');

const withCompany = (rows as Array<Record<string, unknown>>).map((row) => ({ ...row, company_id: 7 }));

describe('restatement dry run', () => {
  const report = buildReport(withCompany);
  const year2026 = report.periods.find((p: { year: string }) => p.year === '2026');

  it('reports each company and year with the figures it shows today as "old"', () => {
    expect(report.dry_run).toBe(true);
    expect(report.current_catalog).toBe(CATALOG_VERSION);
    expect(year2026).toMatchObject({ company_id: '7', rows: 37, excluded: 2 });
    expect(year2026.old.scope1).toBe(expected.summary2026.by_scope.scope1);
    expect(year2026.old.total).toBe(expected.summary2026.total_emissions_tCO2e);
    expect(year2026.old.confidence).toBe(expected.summary2026.confidence_score);
  });

  it('shows what the current catalog would make of them, memo lines included', () => {
    expect(year2026.new.non_kyoto).toBeCloseTo(17.6 + 3.52, 6);
    expect(year2026.new.biogenic_co2).toBeCloseTo(16.4 + 8.2, 6);
    expect(year2026.new.scope1).toBeLessThan(year2026.old.scope1);
  });

  it('gives each restatable row its delta and the pin a restatement would write', () => {
    const fuelOil4 = report.rows.find((r: { id: number }) => r.id === 8);
    expect(fuelOil4).toMatchObject({
      status: 'restatable',
      old: { tco2e: 10.69 },
      new: { tco2e: 10.9962 },
      delta_tco2e: 0.3062,
      proposed_pin: { factor_value: 10.9962, factor_source: 'epa-efh-2025', catalog_version: CATALOG_VERSION, co2e_kg: 10996.2 },
    });
    const wood = report.rows.find((r: { id: number }) => r.id === 29);
    expect(wood).toMatchObject({ status: 'restatable', old: { reporting_bucket: 'scope1', tco2e: 8.2 }, new: { reporting_bucket: 'scope1', biogenic_co2_t: 8.2 } });
  });

  it('lists the rows a person has to map and the typed-in totals it cannot re-price', () => {
    const status = (id: number) => report.rows.find((r: { id: number }) => r.id === id)?.status;
    for (const id of [5, 6, 10, 11, 12, 13, 14, 18, 31]) expect(status(id), String(id)).toBe('needs-mapping');
    for (const id of [26, 27, 36]) expect(status(id), String(id)).toBe('no-activity');
    expect(year2026).toMatchObject({ needs_mapping: 9, no_activity: 3 });
  });

  it('does not modify the rows it is given', () => {
    const copy = JSON.parse(JSON.stringify(withCompany));
    buildReport(copy);
    expect(copy).toEqual(withCompany);
  });
});

describe('the dry run cannot write', () => {
  const source = readFileSync(resolve('scripts/restate-legacy-rows.cjs'), 'utf8');

  it('holds no write statement and opens its database session READ ONLY', () => {
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/);
    expect(source).toMatch(/BEGIN READ ONLY/);
    expect(source).not.toMatch(/writeFile|appendFile/);
  });

  it('refuses --apply', () => {
    const run = spawnSync(process.execPath, [resolve('scripts/restate-legacy-rows.cjs'), '--input', 'x.json', '--apply'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/dry run: there is no --apply/);
  });
});
