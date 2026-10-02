// @vitest-environment node
/**
 * K2 (F-E-05, F-D-01): a manual entry is validated and computed on the server
 * from the activity alone, and stored rows are summarised with the factor they
 * were computed with. Pure functions, no server, no database. The same rules run
 * against real Postgres in tests/entries-write-api.test.ts (Docker).
 *
 * On the code before K2 these functions did not exist: the browser computed
 * CO2e, stored confidence 85 and "EPA emission factor" for every row, put the
 * activity in a free-text `factor`, and stored no activity date.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const entries = require('../server-entries.cjs');
const engine = require('../emissions-engine.cjs');

const NOW = new Date('2026-09-30T12:00:00Z');
const camx = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-03-15' };

function valid(input: Record<string, unknown>) {
  const result = entries.validateEntryInput(input, NOW);
  if (!result.ok) throw new Error(`expected a valid entry, got: ${result.error}`);
  return result.row;
}

function invalid(input: Record<string, unknown>): string {
  const result = entries.validateEntryInput(input, NOW);
  if (result.ok) throw new Error('expected a validation error');
  return result.error;
}

describe('the server computes every stored value from the catalog (F-E-05)', () => {
  it('stores the activity, the factor applied, its dataset, the catalog version and the category confidence', () => {
    expect(valid(camx)).toEqual({
      scope: 'Scope 2',
      category: 'purchased_electricity',
      source: 'CAMX',
      amount: 1000,
      unit: 'kWh',
      activity_amount: 1000,
      activity_unit: 'kWh',
      factor_value: 0.19504,
      factor: '0.19504 kg CO2e/kWh',
      factor_source: 'epa-egrid-2023',
      catalog_version: entries.CATALOG_VERSION,
      method: 'calculation',
      confidence: 97, // electricity's category score, not the constant 85
      co2e_kg: 195.04,
      activity_date: '2025-03-15',
      facility_id: null,
      notes: null,
    });
    // New entries are pinned to the current catalog (K7: 2026-09-30); entries
    // written before it carry 2026-07-24+... and keep resolving to that catalog.
    expect(entries.CATALOG_VERSION).toMatch(/^2026-09-30\+[0-9a-f]{12}$/);
  });

  it('ignores the numbers a client sends: amount 1 with co2e_kg 999,999 is stored as 1 kWh worth of CO2e', () => {
    const row = valid({
      ...camx,
      amount: 1,
      co2e_kg: 999_999,
      factor: '1000000 kWh',
      method: 'EPA emission factor',
      confidence: 100,
      factor_value: 50,
      factor_source: 'epa-efh-2025',
      company_id: 99,
    });
    expect(row).toMatchObject({ co2e_kg: 0.195, factor_value: 0.19504, factor_source: 'epa-egrid-2023', confidence: 97, method: 'calculation' });
    expect(row).not.toHaveProperty('company_id');
  });

  it('labels spend-based and internal-estimate factors as what they are, with their own confidence', () => {
    const row = valid({ scope: 'Scope 3', category: 'purchased_goods', source: 'purchased_goods', amount: 10_000, unit: 'USD', activity_date: '2025-12-31' });
    expect(row).toMatchObject({ factor_source: 'internal-estimate', method: 'spend_based', confidence: 65 });
  });

  it('normalises a unit spelling to the catalog\'s and keeps the category key', () => {
    expect(valid({ ...camx, unit: 'kwh', category: 'Purchased Electricity' })).toMatchObject({ unit: 'kWh', category: 'purchased_electricity' });
  });
});

describe('what the server refuses (400)', () => {
  it('a Scope 3 category relabelled as Scope 1: the scope comes from the catalog, so the paywall cannot be sidestepped', () => {
    expect(invalid({ scope: 'Scope 1', category: 'business_travel', source: 'business_travel', amount: 10, unit: 'USD', activity_date: '2025-01-01' }))
      .toBe('Business Travel is a Scope 3 category.');
  });

  it.each([
    ['no activity date', { activity_date: undefined }, /activity_date is required/],
    ['a timestamp instead of a date', { activity_date: '2025-03-15T00:00:00Z' }, /activity_date is required/],
    ['a date that does not exist', { activity_date: '2025-02-30' }, /not a calendar date/],
    ['a future date', { activity_date: '2026-10-02' }, /cannot be in the future/],
    ['a typo decades back', { activity_date: '0202-03-01' }, /on or after 1990-01-01/],
    ['an amount as text', { amount: '1,200' }, /amount must be a number greater than 0/],
    ['a hex string amount', { amount: '0x1F' }, /amount must be a number greater than 0/],
    ['a zero amount', { amount: 0 }, /amount must be a number greater than 0/],
    ['a unit the source does not have', { unit: 'therms' }, /unit must be one of: kWh, MWh/],
    ['a source outside the category', { source: 'NOT-A-GRID' }, /source must be a source listed for Purchased Electricity/],
    ['a category outside the catalog', { category: 'made_up' }, /category must be a category from the emission factor catalog/],
    ['an unknown scope', { scope: 'Scope 4' }, /scope must be Scope 1, Scope 2 or Scope 3/],
    ['a facility id that is an object', { facility_id: { id: 1 } }, /facility_id must be one of your facility ids/],
  ])('%s', (_label, change, message) => {
    expect(invalid({ ...camx, ...change })).toMatch(message);
  });

  it('accepts today\'s date, and tomorrow\'s for customers east of UTC', () => {
    expect(valid({ ...camx, activity_date: '2026-09-30' }).activity_date).toBe('2026-09-30');
    expect(valid({ ...camx, activity_date: '2026-10-01' }).activity_date).toBe('2026-10-01');
  });
});

describe('plan gate and idempotency helpers', () => {
  it('Scope 3 on Starter is a 402 naming Growth; Growth and Pro pass; Scope 1/2 always pass', () => {
    expect(entries.scope3Refusal('starter', 'Scope 3')).toEqual({
      success: false,
      code: 'upgrade_required',
      requiredPlan: 'growth',
      error: 'Scope 3 workflows are included from the growth plan up.',
    });
    expect(entries.scope3Refusal('growth', 'Scope 3')).toBeNull();
    expect(entries.scope3Refusal('pro', 'Scope 3')).toBeNull();
    expect(entries.scope3Refusal('starter', 'Scope 2')).toBeNull();
  });

  it('accepts a UUID key, allows no key, refuses anything else', () => {
    expect(entries.readIdempotencyKey('4f9c2d7e-0b1a-4c3d-9e8f-123456789abc')).toEqual({ key: '4f9c2d7e-0b1a-4c3d-9e8f-123456789abc' });
    expect(entries.readIdempotencyKey(undefined)).toEqual({ key: null });
    expect(entries.readIdempotencyKey('short').error).toMatch(/8 to 128 characters/);
    expect(entries.readIdempotencyKey('has spaces in it').error).toBeDefined();
  });

  it('a replay matches the stored row only when the payload is the same', () => {
    const row = valid(camx);
    const stored = { ...row, activity_amount: '1000', activity_date: new Date(2025, 2, 15), facility_id: null };
    expect(entries.sameEntryRequest(stored, row)).toBe(true);
    expect(entries.sameEntryRequest({ ...stored, activity_amount: '1300' }, row)).toBe(false);
  });
});

describe('summaries use the factor a row was stored with (R2 pinning)', () => {
  const stored = { ...valid(camx), id: '41', company_id: '7', created_at: '2026-09-30T10:00:00.000Z' };

  it('a pinned factor wins over today\'s catalog value', () => {
    const repriced = { ...stored, factor_value: 0.5 };
    expect(engine.summarizeEntries([repriced]).by_scope.scope2).toBe(0.5);
    expect(engine.summarizeEntries([stored]).by_scope.scope2).toBe(0.19504);
  });

  it('an edit of the date, facility or notes keeps the pinned factor; a changed activity is priced at the current catalog', () => {
    // As if the catalog had moved on since the row was stored at 0.5 kg/kWh.
    const priced = { ...stored, factor_value: '0.5', factor: '0.5 kg CO2e/kWh', co2e_kg: '500', catalog_version: 'older+000000000000', activity_amount: '1000', confidence: '97' };
    const notesOnly = entries.keepPinnedCalculation(priced, valid({ ...camx, activity_date: '2025-04-01', notes: 'meter swap' }));
    expect(notesOnly).toMatchObject({ factor_value: 0.5, co2e_kg: 500, catalog_version: 'older+000000000000', activity_date: '2025-04-01', notes: 'meter swap' });
    const newAmount = entries.keepPinnedCalculation(priced, valid({ ...camx, amount: 1300 }));
    expect(newAmount).toMatchObject({ factor_value: 0.19504, co2e_kg: 253.552, catalog_version: entries.CATALOG_VERSION });
  });

  it('rows without a pinned factor summarise exactly as before: a legacy calculator row and a CSV row', () => {
    const legacyCalculator = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 6367.2, unit: 'kg CO2e', factor: '1200 therms', method: 'EPA emission factor', confidence: 85, factor_value: null, activity_date: null };
    const csvRow = { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms', factor: '0.005306', confidence: 90, factor_value: null, activity_date: '2025-06-30' };
    const summary = engine.summarizeEntries([legacyCalculator, csvRow]);
    expect(summary.by_scope.scope1).toBe(11.6732);
    expect(summary.confidence_score).toBe(88);
  });

  it('the entry list shows the CO2e the totals count: a tampered legacy row reads 1 kg, not 999,999', () => {
    const tampered = { id: '9', scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: '1', unit: 'kg CO2e', co2e_kg: '999999', factor: '1000000 kWh', confidence: '85', created_at: new Date('2026-09-30T02:53:52Z') };
    const shown = entries.presentEntry(tampered);
    expect(shown).toMatchObject({ id: 9, co2e_kg: 1, factor_source: null, activity_date: null, created_at: '2026-09-30T02:53:52.000Z' });
    expect(engine.summarizeEntries([entries.engineRow(tampered)]).total_emissions_tCO2e).toBe(0.001);
  });

  it('an unresolvable row is flagged, not given a number', () => {
    const shown = entries.presentEntry({ id: '3', scope: 'Scope 1', category: 'stationary_combustion', source: 'unobtainium', amount: '5', unit: 'kg', created_at: '2026-01-01T00:00:00Z' });
    expect(shown.co2e_kg).toBeNull();
    expect(shown.calculation_error).toMatch(/Unsupported Scope 1 source\/unit/);
  });
});

describe('the activity date decides the period (F-E-05)', () => {
  it('buildTrend books a row by its activity date; rows without one keep created_at', () => {
    const dated = { ...valid({ ...camx, activity_date: '2025-03-15' }), created_at: '2026-09-30T10:00:00.000Z' };
    const legacy = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', created_at: '2026-09-30T10:00:00.000Z' };
    const y2025 = engine.buildTrend([dated, legacy], { year: 2025 }) as Array<{ month: string; scope2: number }>;
    const y2026 = engine.buildTrend([dated, legacy], { year: 2026 }) as Array<{ month: string; scope2: number }>;
    expect(y2025.find((m) => m.month === 'Mar')?.scope2).toBe(0.19504);
    expect(y2025.reduce((sum, m) => sum + m.scope2, 0)).toBe(0.19504);
    expect(y2026.find((m) => m.month === 'Sep')?.scope2).toBe(0.19504);
    expect(y2026.reduce((sum, m) => sum + m.scope2, 0)).toBe(0.19504);
  });

  it('a DATE column read by node-postgres (local midnight) keeps its calendar day', () => {
    expect(entries.toDateOnly(new Date(2025, 2, 15))).toBe('2025-03-15');
    expect(entries.toDateOnly('2025-12-31')).toBe('2025-12-31');
    expect(entries.toDateOnly(null)).toBeNull();
  });
});
