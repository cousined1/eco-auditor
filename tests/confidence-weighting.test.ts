// @vitest-environment node
/**
 * F-E-09: the inventory confidence score was an unweighted average of row
 * scores, so one USD 10 m spend estimate (65 %, 99.99 % of the emissions) next
 * to ten small metered rows (97 %) scored 94 %. The current catalog scores
 * sum(co2e x confidence) / sum(co2e). One rule for every route: a supplied
 * confidence outside 0-100 is refused in calculateEntry (/api/calculate used to
 * echo 1e9), and a CO2e total typed in directly gets the catalog's own low score
 * instead of its category's.
 *
 * A period whose rows all come from the frozen 2026-07-24 catalog keeps the
 * average it has always shown (tests/legacy-row-invariance.test.ts): the rule
 * changes a period's score only once it holds entries priced by the new catalog.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const engine = require('../emissions-engine.cjs');
const { CATALOG, CATALOG_VERSION } = require('../emission-factors.cjs');

const spend = { scope: 'Scope 3', category: 'purchased_goods', source: 'purchased_goods', amount: 10_000_000, unit: 'USD', confidence: 65 };
const meter = (i: number) => ({ id: i, scope: 'Scope 2', category: 'purchased_electricity', source: 'US_AVERAGE', amount: 100, unit: 'kWh' });
const scenario = [spend, ...Array.from({ length: 10 }, (_, i) => meter(i + 1))];
const pin = (rows: Record<string, unknown>[]) => rows.map((row) => ({ ...row, catalog_version: CATALOG_VERSION }));

describe('the inventory confidence score is weighted by emissions (F-E-09)', () => {
  it('the audit scenario scores 65, not 94', () => {
    expect(engine.summarizeEntries(pin(scenario)).confidence_score).toBe(65);
  });

  it('the same rows stored before the new catalog keep the 94 they showed (no silent change to a past period)', () => {
    expect(engine.summarizeEntries(scenario).confidence_score).toBe(94);
  });

  it('a period that holds any entry priced by the new catalog is weighted throughout', () => {
    const mixed = [spend, ...pin(Array.from({ length: 10 }, (_, i) => meter(i + 1)))];
    expect(engine.summarizeEntries(mixed).confidence_score).toBe(65);
  });

  it('rows on a memo line do not weigh in, and zero-emission rows cannot divide by zero', () => {
    const r22 = { scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r22', amount: 1000, unit: 'kg', confidence: 10 };
    const gas = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' };
    expect(engine.summarizeEntries(pin([r22, gas])).confidence_score).toBe(90);
    const zero = { ...gas, amount: 0, confidence: 40 };
    expect(engine.summarizeEntries(pin([zero, { ...zero, confidence: 60 }])).confidence_score).toBe(50);
    expect(engine.summarizeEntries([]).confidence_score).toBe(0);
  });
});

describe('one confidence rule for every route (F-E-09)', () => {
  const row = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 10, unit: 'therms' };

  it.each([150, -1, 1e9, 'high', Number.NaN])('refuses a supplied confidence of %s', (confidence) => {
    expect(() => engine.calculateEntry({ ...row, confidence })).toThrow(/confidence must be a number between 0 and 100/);
    expect(() => engine.calculateEntry({ ...row, confidence, catalog_version: CATALOG_VERSION })).toThrow(/confidence must be a number between 0 and 100/);
  });

  it('keeps 0, 100 and numeric text, and defaults when none is given', () => {
    expect(engine.calculateEntry({ ...row, confidence: 0 }).confidence).toBe(0);
    expect(engine.calculateEntry({ ...row, confidence: 100 }).confidence).toBe(100);
    expect(engine.calculateEntry({ ...row, confidence: '72' }).confidence).toBe(72);
    expect(engine.calculateEntry(row).confidence).toBe(90);
  });

  it('a summary reports an out-of-range row as excluded instead of averaging it in (the /api/calculate preview path)', () => {
    const s = engine.summarizeEntries(pin([{ ...row, confidence: 1e9 }]));
    expect(s.confidence_score).toBe(0);
    expect(s.excluded_rows.count).toBe(1);
  });

  it('a CO2e total typed in directly gets the catalog\'s own score, not its category\'s', () => {
    const typed = { scope: 'Scope 2', category: 'purchased_electricity', source: 'supplier statement', amount: 12.5, unit: 't CO2e' };
    expect(engine.calculateEntry({ ...typed, catalog_version: CATALOG_VERSION }).confidence).toBe(CATALOG.precomputedConfidence);
    expect(CATALOG.precomputedConfidence).toBeLessThan(65);
    // A stored legacy row keeps the category score it had (97 for electricity).
    expect(engine.calculateEntry(typed).confidence).toBe(97);
    // A supplied score still wins.
    expect(engine.calculateEntry({ ...typed, confidence: 80, catalog_version: CATALOG_VERSION }).confidence).toBe(80);
  });
});
