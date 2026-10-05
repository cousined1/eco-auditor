/**
 * DATA-02: one malformed row must not void a whole CSV import.
 *
 * parseEmissionCsv threw on the first row whose amount was blank or
 * non-numeric, so a 500-row upload with a typo on line 12 imported NOTHING. That
 * also contradicted the ingest route, which already isolates bad scope, bad
 * confidence and unknown facilities per row and skips only those rows — a blank
 * amount failed the entire customer import while a less serious problem did not.
 * The customer fixed line 12, resubmitted, discovered line 47, and repeated.
 *
 * File-level problems (missing required column, unterminated quoted field) still
 * throw: the whole file is unreadable and there is no honest partial import.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseEmissionCsv, parseEmissionCsvDetailed } = require('../emissions-engine.cjs');

const header = 'scope,category,source,amount,unit\n';
const good = 'Scope 1,stationary_combustion,natural_gas,100,therms\n';
const alsoGood = 'Scope 2,purchased_electricity,CAMX,500,kWh\n';

describe('DATA-02 partial CSV import', () => {
  it('keeps the valid rows and reports the invalid one by line', () => {
    const csv = header + good + 'Scope 1,stationary_combustion,natural_gas,,therms\n' + alsoGood;
    const { rows, errors } = parseEmissionCsvDetailed(csv);

    expect(rows).toHaveLength(2);
    expect(rows.map((r: { amount: number }) => r.amount)).toEqual([100, 500]);
    expect(errors).toEqual([{ row: 3, message: 'CSV row 3 has an invalid amount.' }]);
  });

  it('records the real file line so later diagnostics stay accurate', () => {
    // Line 2 and line 5 are valid; line 3 is dropped. The row object must carry
    // its own line number, otherwise the route's `i + 2` would name line 3 for
    // the entry that is actually on line 5.
    const csv = header + good + 'Scope 1,stationary_combustion,natural_gas,,\n' + alsoGood;
    const { rows } = parseEmissionCsvDetailed(csv);

    expect(rows.map((r: { _rowNumber: number }) => r._rowNumber)).toEqual([2, 4]);
  });

  it('reports every bad row, not just the first', () => {
    const csv =
      header + good +
      'Scope 1,stationary_combustion,natural_gas,abc,therms\n' +
      'Scope 2,purchased_electricity,CAMX,,kWh\n' +
      alsoGood;
    const { rows, errors } = parseEmissionCsvDetailed(csv);

    expect(rows).toHaveLength(2);
    expect(errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
  });

  it('never turns a blank amount into a silent zero', () => {
    // REL-002 regression guard: Number('') === 0, so a blank must be rejected
    // rather than imported as 0 tCO2e.
    const { rows } = parseEmissionCsvDetailed(header + 'Scope 1,stationary_combustion,natural_gas,,therms\n');
    expect(rows).toHaveLength(0);
  });

  it('still throws for file-level problems', () => {
    expect(() => parseEmissionCsvDetailed('scope,category,source\n1,2,3\n')).toThrow(
      /missing required column: amount/,
    );
    // An unterminated quoted field makes the rest of the file unreadable, so it
    // stays fatal rather than becoming a skipped row.
    expect(() =>
      parseEmissionCsvDetailed('scope,category,source,amount,unit,notes\nScope 1,fuel,gas,10,therms,"unfinished'),
    ).toThrow(/unterminated quoted field/);
  });

  it('keeps the strict wrapper all-or-nothing for existing callers', () => {
    const csv = header + good + 'Scope 1,stationary_combustion,natural_gas,,therms\n' + alsoGood;
    expect(() => parseEmissionCsv(csv)).toThrow(/CSV row 3 has an invalid amount/);
    expect(parseEmissionCsv(header + good + alsoGood)).toHaveLength(2);
  });

  it('returns an empty result for a header-only file', () => {
    expect(parseEmissionCsvDetailed(header)).toEqual({ rows: [], errors: [] });
  });
});