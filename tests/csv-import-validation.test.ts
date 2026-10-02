// @vitest-environment node
/**
 * K4 (F-C-06, F-E-13, F-R2-01, F-B-16): one pass over a CSV file reports every
 * header problem and every row problem with its line number, prices valid rows
 * exactly like a manual entry (pinned factor, dataset, catalog version) after
 * unit conversion, and warns (never drops) on undated, future-dated and
 * unknown-facility rows. Pure: no server, no database.
 *
 * On the code before K4 the engine's parser threw at the first missing column
 * ("CSV is missing required column: scope") and at the first bad amount (the
 * whole file), a bad unit only dropped its own row, "0x1F" imported as 31,
 * therm/ccf/lb/tons/km were refused, and an undated row went to the import year
 * without a word. server-csv-import.cjs did not exist.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const csv = require('../server-csv-import.cjs');
const { CATALOG_VERSION } = require('../server-entries.cjs');
const { CATALOG } = require('../emission-factors.cjs');

const scopeCategories = (scope: number): string[] =>
  CATALOG.categories.filter((category: { scope: number }) => category.scope === scope).map((category: { key: string }) => category.key);

// Expected factors, worked out by hand from emission-factors.json (catalog 2026-09-30, which prices a new
// row): the CO2 per unit plus the CH4 and N2O grams its `citation` lists, at the AR5 GWP-100 of `gwpBasis`
// (CH4 28, N2O 265), kept to the catalog's 6 significant figures. "was" = catalog 2026-07-24.
const sf6 = (x: number) => Number(x.toPrecision(6));
const GWP_CH4 = 28;
const GWP_N2O = 265;
const GAS_PER_THERM = sf6((53.06 + (1.0 * GWP_CH4 + 0.1 * GWP_N2O) / 1000) / 10); // Table 1 per mmBtu / 10 = 5.31145 (was 5.306, CO2 only)
const GAS_PER_MCF = sf6(1000 * (0.05444 + (0.00103 * GWP_CH4 + 0.0001 * GWP_N2O) / 1000)); // Table 1 per scf x 1,000 = 54.4953 (was 54.44)
const CAR_PER_MILE = sf6(0.297 + (0.0059 * GWP_CH4 + 0.0053 * GWP_N2O) / 1000); // Table 10 passenger car = 0.29857 (was 0.404)
const COAL_BITUMINOUS_PER_SHORT_TON = sf6(2325 + (274 * GWP_CH4 + 40 * GWP_N2O) / 1000); // Table 1 = 2,343.27 (generic "coal" retired)
const LANDFILL_PER_SHORT_TON = 0.58 * 1000; // Table 9 mixed MSW landfilled, 0.58 t per short ton (was 0.586 per kg only)
const R22_PER_KG = 1760; // AR5 GWP-100 of HCFC-22, now reported outside Scope 1 (memo:non-kyoto)
const WOOD_PER_SHORT_TON = (126 * GWP_CH4 + 63 * GWP_N2O) / 1000; // Table 1, CH4 and N2O only = 20.223 (was 1,640 with the CO2)
const WOOD_BIOGENIC_PER_SHORT_TON = 1640; // Table 1 CO2 of wood (`biogenicCO2`), reported outside the scopes
const R410A_PER_KG = 1924; // AR5 GWP-100 of R-410A (unchanged)
const PAPER_PER_KG = 0.94; // purchased_goods paper (unchanged)
const CAMX_PER_KWH = 0.19504; // eGRID2023 CAMX (unchanged)

const NOW = new Date('2026-09-30T12:00:00Z');
const HEADER = 'scope,category,source,amount,unit,date,facility_name,notes';
const file = (...rows: string[]) => [HEADER, ...rows].join('\n');
const check = (text: string, facilities: Array<{ id: string; name: string }> = []) => csv.validateCsvImport(text, { facilities, now: NOW });

describe('every header problem at once (F-C-06)', () => {
  it('names every missing required column in one message', () => {
    const report = check('entry_id,activity_value,unit\n1,2,kg\n');
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^missing required columns: scope, category, source, amount \(line 1\)/);
    expect(report.warnings).toEqual(['Line 1: columns entry_id, activity_value are not used and will be ignored.']);
    expect(report.rows).toEqual([]);
  });

  it('the audit\'s wrong header: category, source, amount missing together', () => {
    expect(check('scope,unit,date\nScope 1,therms,2025-01-01\n').errors[0]).toMatch(/^missing required columns: category, source, amount /);
  });

  it('a repeated column is an error, not a silent choice between two values', () => {
    expect(check('scope,category,source,amount,unit,amount\nScope 1,stationary_combustion,natural_gas,1,therms,2\n').errors)
      .toEqual(['Line 1: column amount appears more than once.']);
  });

  it('an empty file and a header without rows', () => {
    expect(check('').errors).toEqual(['The file is empty.']);
    expect(check(HEADER + '\n').errors).toEqual(['The file has no data rows under the header.']);
  });
});

describe('every row problem, per row, with its line number (F-E-13)', () => {
  const report = check(file(
    'Scope 1,stationary_combustion,natural_gas,100,therms,2025-01-31,,',
    'Scope 1,stationary_combustion,natural_gas,,therms,2025-01-31,,',
    'Scope 1,stationary_combustion,natural_gas,0x1F,therms,2025-01-31,,',
    'Scope 1,stationary_combustion,natural_gas,1e999,therms,2025-01-31,,',
    'Scope 1,stationary_combustion,natural_gas,-3,therms,2025-01-31,,',
    'Scope 2,purchased_electricity,CAMX,100,therms,2025-01-31,,',
    'Scope 1,made_up_category,natural_gas,10,therms,2025-01-31,,',
    'Scope 2,purchased_electricity,RFC East,100,kWh,2025-01-31,,',
    'Scope 1,business_travel,business_travel,100,USD,2025-01-31,,',
    'Scope 4,stationary_combustion,natural_gas,100,therms,2025-01-31,,',
    'Scope 1,stationary_combustion,natural_gas,100,therms,2025-02-30,,',
    'Scope 1,stationary_combustion,natural_gas,100,therms,1985-06-30,,',
  ));
  const line = (n: number) => report.errors.filter((error: string) => error.startsWith(`Line ${n}:`));

  it('a blank, hex, scientific or negative amount fails its own row only', () => {
    expect(line(3)).toEqual(['Line 3: amount is blank.']);
    expect(line(4)[0]).toMatch(/^Line 4: amount "0x1F" is not a plain number/);
    expect(line(5)[0]).toMatch(/^Line 5: amount "1e999" uses scientific notation/);
    expect(line(6)[0]).toMatch(/^Line 6: amount "-3" is negative/);
    expect(report.rows.map((row: { line: number }) => row.line)).toEqual([2]);
    expect(report.totalRows).toBe(12);
    expect(report.errorCount).toBe(11);
  });

  it('names the column at fault: unit, category (with the allowed keys), source (with a suggestion), scope', () => {
    expect(line(7)[0]).toBe('Line 7: unit "therms" cannot be used for purchased_electricity CAMX. Use one of: kWh, MWh.');
    // The engine's own message when it names the valid categories, else the
    // catalog's list: either way every Scope 1 category is offered.
    expect(line(8)[0]).toMatch(/^Line 8: .*made_up_category/);
    for (const key of scopeCategories(1)) expect(line(8)[0]).toContain(key);
    expect(line(9)[0]).toMatch(/^Line 9: .*"RFC East".*\bRFCE\b/);
    expect(line(10)[0]).toBe('Line 10: Business Travel (business_travel) is a Scope 3 category, not Scope 1.');
    expect(line(11)[0]).toBe('Line 11: scope "Scope 4" must be Scope 1, Scope 2 or Scope 3.');
  });

  it('a date that does not exist, or decades back, is an error; a date decides nothing silently', () => {
    expect(line(12)).toEqual(['Line 12: date "2025-02-30" is not a date: use YYYY-MM-DD (or M/D/YYYY).']);
    expect(line(13)).toEqual(['Line 13: date 1985-06-30 is before 1990-01-01.']);
  });

  it('a Scope 3 category marks the file for the plan gate even when mislabelled', () => {
    expect(report.hasScope3).toBe(true);
  });
});

describe('valid rows are priced and pinned like a manual entry (K2 fields), after unit conversion', () => {
  const report = check(file(
    'Scope 1,stationary_combustion,natural_gas,"1,200",therm,2025-01-31,main plant,Jan bill',
    'Scope 1,stationary_combustion,natural_gas,1000,ccf,2025-02-28,,',
    'Scope 1,fugitive_emissions,refrigerant_r410a,10,lb,2025-03-31,,',
    // Paper is priced per kg only, so "tons" still takes the short-ton-to-kg conversion (landfill, used
    // here before, is priced per short ton since catalog 2026-09-30: see the next describe).
    'Scope 3,purchased_goods,paper,2,tons,2025-04-30,,',
    'Scope 3,business_travel,rental_car,100,km,6/30/2025,,',
  ), [{ id: '41', name: 'Main Plant' }]);
  const rows = Object.fromEntries(report.rows.map((row: { line: number; entry: Record<string, unknown> }) => [row.line, row.entry]));

  it('no errors; "1,200" and "therm" are read, the facility matches case-insensitively', () => {
    expect(report.errors).toEqual([]);
    expect(rows[2]).toMatchObject({
      scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas',
      amount: 1200, unit: 'therms', activity_amount: 1200, activity_unit: 'therms',
      factor_value: GAS_PER_THERM, factor: `${GAS_PER_THERM} kg CO2e/therms`, factor_source: 'epa-efh-2025',
      catalog_version: CATALOG_VERSION, co2e_kg: expect.closeTo(1200 * GAS_PER_THERM, 2), confidence: 90, method: 'calculation',
      activity_date: '2025-01-31', facility_id: '41', notes: 'Jan bill',
    });
    expect(CATALOG_VERSION).toMatch(/^2026-09-30\+[0-9a-f]{12}$/);
  });

  it('ccf, lb, tons and km are stored in the catalog unit, with what the file said kept beside it', () => {
    // 10 lb x 0.45359237 = 4.5359237 kg; 2 short tons x 2,000 lb x 0.45359237 = 1,814.36948 kg;
    // 100 km / 1.609344 = 62.1371192237 miles (12 significant digits).
    expect(rows[3]).toMatchObject({ amount: 100, unit: 'MCF', activity_amount: 1000, activity_unit: 'ccf', factor_value: GAS_PER_MCF, co2e_kg: expect.closeTo(100 * GAS_PER_MCF, 2) });
    expect(rows[4]).toMatchObject({ amount: 4.5359237, unit: 'kg', activity_amount: 10, activity_unit: 'lb', factor_value: R410A_PER_KG, co2e_kg: expect.closeTo(4.5359237 * R410A_PER_KG, 2) });
    expect(rows[5]).toMatchObject({ amount: 1814.36948, unit: 'kg', activity_amount: 2, activity_unit: 'tons', factor_value: PAPER_PER_KG, co2e_kg: expect.closeTo(1814.36948 * PAPER_PER_KG, 2) });
    expect(rows[6]).toMatchObject({
      amount: 62.1371192237, unit: 'miles', activity_amount: 100, activity_unit: 'km', activity_date: '2025-06-30',
      factor_value: CAR_PER_MILE, factor_source: 'epa-efh-2025', co2e_kg: expect.closeTo(62.1371192237 * CAR_PER_MILE, 2),
    });
  });

  it('lists the conversions and the "tons" reading', () => {
    expect(report.conversions.map(csv.conversionText)).toEqual([
      '1 row in ccf converted to MCF (x 0.1): line 3',
      '1 row in lb converted to kg (x 0.453592): line 4',
      '1 row in short tons converted to kg (x 907.185): line 5',
      '1 row in km converted to miles (x 0.621371): line 6',
    ]);
    expect(report.warnings).toContain('Line 5: "tons" is read as US short tons (2,000 lb); write "tonnes" for metric tons.');
  });

  it('adds up the tonnes per scope of what would be imported', () => {
    const scope1 = (1200 * GAS_PER_THERM + 100 * GAS_PER_MCF + 4.5359237 * R410A_PER_KG) / 1000; // 20.550387
    const scope3 = (1814.36948 * PAPER_PER_KG + 62.1371192237 * CAR_PER_MILE) / 1000; // 1.724059
    expect(report.tonnes).toEqual({
      scope1: expect.closeTo(scope1, 5),
      scope2: 0,
      scope3: expect.closeTo(scope3, 5),
      total: expect.closeTo(scope1 + scope3, 5),
      scope2_market: 0,
      biogenic_co2: 0,
      non_kyoto: 0,
    });
  });
});

// A file is priced by the catalog of the day it is imported. Rows stored before keep their own catalog
// (a row without a pin is priced by the frozen 2026-07-24 one), so none of this moves an old total; but a
// file that was valid then and is imported again now meets today's list of sources.
describe('a new import is priced and checked by the current catalog (2026-09-30)', () => {
  it('landfill in "tons" is priced per short ton, with no conversion, and still says how "tons" was read', () => {
    const report = check(file('Scope 3,waste,landfill,2,tons,2025-04-30,,'));
    expect(report.errors).toEqual([]);
    expect(report.rows[0].entry).toMatchObject({ amount: 2, unit: 'short tons', activity_amount: 2, activity_unit: 'short tons', factor_value: LANDFILL_PER_SHORT_TON, co2e_kg: 2 * LANDFILL_PER_SHORT_TON });
    expect(report.conversions).toEqual([]);
    expect(report.warnings).toContain('Line 2: "tons" is read as US short tons (2,000 lb); write "tonnes" for metric tons.');
  });

  it('a source the catalog does not have is an error on its own row that names the valid sources (generic "coal" is keyed by rank now)', () => {
    const report = check(file('Scope 1,stationary_combustion,coal,10,short tons,2025-04-30,,', 'Scope 1,stationary_combustion,coal_bituminous,10,short tons,2025-04-30,,'));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^Line 2: source "coal" is not listed for stationary_combustion\. Use one of: natural_gas, .*\bcoal_anthracite, coal_bituminous, coal_subbituminous, lignite_coal, .*, wood\.$/);
    expect(report.rows.map((row: { line: number }) => row.line)).toEqual([3]);
    expect(report.rows[0].entry).toMatchObject({ factor_value: COAL_BITUMINOUS_PER_SHORT_TON, co2e_kg: expect.closeTo(10 * COAL_BITUMINOUS_PER_SHORT_TON, 2) });
  });

  it('a row valid under the frozen catalog, RENEWABLE electricity, is refused now and told where it goes; renewable_electricity takes it', () => {
    const report = check(file('Scope 2,purchased_electricity,RENEWABLE,100000,kWh,2026-06-01,,', 'Scope 2,renewable_electricity,CAMX,100000,kWh,2026-06-01,,'));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^Line 2: source "RENEWABLE" is not listed for purchased_electricity\. Use one of: AKGD, .*, US_AVERAGE\. Electricity bought under a renewable contract \(RECs, PPA, green tariff\) goes under renewable_electricity, with the site's eGRID subregion\.$/);
    // Location-based it is the site's grid factor like any grid electricity; the Dashboard reports it as 0 market-based.
    expect(report.rows[0].entry).toMatchObject({ category: 'renewable_electricity', source: 'CAMX', factor_value: CAMX_PER_KWH, co2e_kg: expect.closeTo(100000 * CAMX_PER_KWH, 2) });
    expect(report.tonnes).toMatchObject({ scope2: expect.closeTo((100000 * CAMX_PER_KWH) / 1000, 6), scope2_market: 0 });
  });

  it('R-22 and wood\'s biogenic CO2 are counted beside the scopes, as on the Dashboard; wood\'s CH4 and N2O in Scope 1', () => {
    const report = check(file(
      'Scope 1,fugitive_emissions,refrigerant_r22,10,kg,2025-05-01,,',
      'Scope 1,stationary_combustion,natural_gas,1000,therms,2025-05-01,,',
      'Scope 1,stationary_combustion,wood,10,short tons,2025-05-01,,',
    ));
    expect(report.errors).toEqual([]);
    const scope1 = (1000 * GAS_PER_THERM + 10 * WOOD_PER_SHORT_TON) / 1000; // 5.31145 + 0.20223 = 5.51368
    expect(report.tonnes).toEqual({
      scope1: expect.closeTo(scope1, 6),
      scope2: 0,
      scope3: 0,
      total: expect.closeTo(scope1, 6),
      scope2_market: 0,
      biogenic_co2: expect.closeTo((10 * WOOD_BIOGENIC_PER_SHORT_TON) / 1000, 6), // 16.4
      non_kyoto: expect.closeTo((10 * R22_PER_KG) / 1000, 6), // 17.6
    });
  });
});

describe('warnings: the rows are imported, and the user is told (F-R2-01, F-B-16)', () => {
  it('rows without a date are counted in the import year, and the check says so, with the lines', () => {
    const report = check(file('Scope 1,stationary_combustion,natural_gas,10,therms,,,', 'Scope 1,stationary_combustion,natural_gas,20,therms,,,'));
    expect(report.errors).toEqual([]);
    expect(report.rows.map((row: { entry: { activity_date: unknown } }) => row.entry.activity_date)).toEqual([null, null]);
    expect(report.warnings).toEqual([
      '2 rows (lines 2 and 3) have no date: counted in 2026, the year of the import. Add a date (for a bill, the end of its period) to count a row in the year the activity happened.',
    ]);
  });

  it('a future date is a warning, not an error', () => {
    const report = check(file('Scope 1,stationary_combustion,natural_gas,10,therms,2026-12-15,,'));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(['1 row (line 2) is dated after today (2026-09-30). Check the date.']);
  });

  it('an unknown facility is named once with every line it appears on', () => {
    const report = check(file('Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,North Plant,', 'Scope 1,stationary_combustion,natural_gas,10,therms,2025-02-01,North Plant,'));
    expect(report.warnings).toEqual(['2 rows (lines 2 and 3) name the facility "North Plant", which does not exist: imported without a facility.']);
    expect(report.rows.every((row: { entry: { facility_id: unknown } }) => row.entry.facility_id === null)).toBe(true);
  });

  it('an implausibly large row is flagged', () => {
    const report = check(file('Scope 2,purchased_electricity,CAMX,"1,000,000,000",kWh,2025-01-01,,'));
    const shown = Math.round((1e9 * CAMX_PER_KWH) / 1000).toLocaleString('en-US'); // 195,040
    expect(report.warnings[0]).toBe(`Line 2: one row of ${shown} tCO2e is unusually large: check the amount and the unit.`);
  });

  it('the template\'s example rows are flagged', () => {
    const report = check(file('Scope 1,stationary_combustion,natural_gas,1200,therms,2025-01-31,,Example row: January gas bill'));
    expect(report.warnings).toEqual(["1 row (line 2) is one of the template's example rows: replace it with your own data or delete it."]);
  });
});

describe('reading the file', () => {
  it('a character that is not UTF-8 is an error with its line (F-B-16)', () => {
    const report = check(file('Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,,Z�rich office'));
    expect(report.errors[0]).toMatch(/^Line 2: the file is not UTF-8 text/);
  });

  it('line numbers count the lines inside a quoted value, and a comma outside quotes is caught', () => {
    const report = check([HEADER, 'Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,,"two\r\nlines"', 'Scope 1,stationary_combustion,natural_gas,x,therms,2025-01-01,,', 'Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,,Invoice 7, part 2'].join('\r\n'));
    expect(report.rows[0].entry.notes).toBe('two\r\nlines');
    expect(report.errors).toEqual([
      'Line 4: amount "x" is not a plain number: use digits, an optional decimal point and optional thousands commas (1,200.5).',
      'Line 5: it has 9 values for 8 columns: put quotes around a value that contains a comma.',
    ]);
  });

  it('an unterminated quote is reported, not truncated', () => {
    expect(check(file('Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,,"unfinished')).errors)
      .toEqual(['Line 2: a quoted value is never closed. Check for a missing closing quote (").']);
  });

  it.each([
    ['2025-06-30', '2025-06-30'],
    ['2025-06-30T00:00:00Z', '2025-06-30'],
    ['2025-06-30 08:15:00', '2025-06-30'],
    ['2025/6/30', '2025-06-30'],
    ['6/30/2025', '2025-06-30'],
    ['30/06/2025', null],
    ['June 30, 2025', null],
    ['2025-13-01', null],
  ])('date "%s" -> %s', (text, iso) => {
    expect(csv.parseCsvDate(text)).toBe(iso);
  });
});

describe('the duplicate check sees the same file, however it was saved (F-E-04)', () => {
  it('CRLF, LF, a BOM and trailing blank lines hash the same; a changed value does not', () => {
    const lf = file('Scope 1,stationary_combustion,natural_gas,10,therms,2025-01-01,,');
    const sha = csv.fileSha256(lf);
    expect(csv.fileSha256(lf.replace(/\n/g, '\r\n'))).toBe(sha);
    expect(csv.fileSha256('﻿' + lf + '\n\n')).toBe(sha);
    expect(csv.fileSha256(lf.replace(',10,', ',11,'))).not.toBe(sha);
    expect(check(lf).fileSha256).toBe(sha);
  });

  it('a row already stored overlaps, whether it was stored with labels (old CSV rows) or keys', () => {
    const report = check(file('Scope 1,stationary_combustion,natural_gas,1000,therms,2025-06-30,,', 'Scope 3,transport_inbound,Acme Freight,500,USD,2025-06-30,,'));
    const legacy = { scope: 'Scope 1', category: 'Stationary Combustion', source: 'Natural Gas', amount: '1000', unit: 'Therms', activity_date: new Date(2025, 5, 30), facility_id: null };
    const otherVendor = { scope: 'Scope 3', category: 'transport_inbound', source: 'Other Freight', amount: '500', unit: 'USD', activity_date: '2025-06-30', facility_id: null };
    expect(csv.overlappingLines(report.rows, [legacy, otherVendor])).toEqual([2]);
    expect(csv.overlapWarning([2])).toMatch(/^1 row \(line 2\) matches an entry already stored: same scope, category, source, amount, unit, date and facility\. Two identical deliveries can be real/);
  });
});
