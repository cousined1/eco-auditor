// @vitest-environment node
/**
 * K4 (F-E-13): units a bill states (therm, ccf, lb, tons, km, L ...) are
 * converted into a unit the catalog has a factor for BEFORE the factor is looked
 * up, and amounts written as text are parsed strictly. On the code before K4
 * units.cjs did not exist: the catalog matched units exactly, so every one of
 * these rows was refused, and Number() read "0x1F" as 31 and "1e999" as Infinity.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { UNIT_GROUPS } from '../src/lib/csvTemplate';

const require = createRequire(import.meta.url);
const units = require('../units.cjs');
const { getSource } = require('../emission-factors.cjs');
const engine = require('../emissions-engine.cjs');
const { CATALOG_VERSION } = require('../server-entries.cjs');

const unitsOf = (category: string, source: string) => Object.keys(getSource(category, source).units);

describe('conversion into a unit the source is priced in', () => {
  it.each([
    // [category, source, typed, catalog unit, ratio]
    ['stationary_combustion', 'natural_gas', 'therm', 'therms', 1],
    ['stationary_combustion', 'natural_gas', 'Therms', 'therms', 1],
    ['stationary_combustion', 'natural_gas', 'ccf', 'MCF', 0.1],
    ['stationary_combustion', 'natural_gas', 'CCF', 'MCF', 0.1],
    ['stationary_combustion', 'natural_gas', 'scf', 'MCF', 0.001],
    ['stationary_combustion', 'natural_gas', 'Dth', 'MMBtu', 1],
    ['fugitive_emissions', 'refrigerant_r410a', 'lb', 'kg', 0.45359237],
    ['fugitive_emissions', 'refrigerant_r410a', 'lbs', 'kg', 0.45359237],
    ['waste', 'landfill', 'tonnes', 'kg', 1000],
    ['stationary_combustion', 'diesel', 'L', 'liters', 1],
    ['mobile_combustion', 'diesel', 'L', 'gallons', 1 / 3.785411784],
    ['business_travel', 'rental_car', 'km', 'miles', 1 / 1.609344],
    ['business_travel', 'air_short_haul', 'passenger-km', 'passenger-miles', 1 / 1.609344],
    ['purchased_electricity', 'CAMX', 'MWh', 'MWh', 1],
  ])('%s %s: %s -> %s', (category, source, typed, unit, ratio) => {
    const resolved = units.resolveUnit(unitsOf(category, source), typed);
    expect(resolved).toMatchObject({ unit });
    expect(resolved.ratio).toBeCloseTo(ratio, 12);
  });

  it('"tonnes" and "t" are the catalog\'s "metric tons", unconverted', () => {
    for (const typed of ['tonnes', 't', 'Metric Tons']) {
      expect(units.resolveUnit(['metric tons'], typed)).toEqual({ unit: 'metric tons', ratio: 1, converted: false });
    }
  });

  it('kWh on a gas bill becomes energy (MMBtu), exactly: 1 kWh = 3.6 MJ, 1 Btu = 1055.05585262 J', () => {
    const resolved = units.resolveUnit(unitsOf('stationary_combustion', 'natural_gas'), 'kWh');
    expect(resolved).toMatchObject({ unit: 'MMBtu', converted: true });
    expect(resolved.ratio).toBeCloseTo(3.6e6 / 1055.05585262 / 1e6, 15);
  });

  it('m3 is a gas volume for gas and a liquid volume for diesel', () => {
    expect(units.resolveUnit(unitsOf('stationary_combustion', 'natural_gas'), 'm3').unit).toBe('MCF');
    expect(units.resolveUnit(unitsOf('stationary_combustion', 'natural_gas'), 'm3').ratio).toBeCloseTo(35.3146667214886 / 1000, 12);
    expect(units.resolveUnit(unitsOf('stationary_combustion', 'diesel'), 'm3')).toMatchObject({ unit: 'gallons' });
  });

  it('"tons" is read as US short tons and says so: converted to kg for a source priced per kg', () => {
    // purchased_goods paper is priced per kg only: 1 short ton = 2,000 lb x 0.45359237 kg = 907.18474 kg.
    const resolved = units.resolveUnit(unitsOf('purchased_goods', 'paper'), 'tons');
    expect(resolved).toMatchObject({ unit: 'kg', converted: true });
    expect(resolved.ratio).toBeCloseTo(2000 * 0.45359237, 9);
    expect(resolved.warning).toMatch(/US short tons .*"tonnes" for metric tons/);
  });

  it('"tons" for a source priced per short ton (landfill since catalog 2026-09-30) is not converted, and still says how it was read', () => {
    const resolved = units.resolveUnit(unitsOf('waste', 'landfill'), 'tons');
    expect(resolved).toMatchObject({ unit: 'short tons', ratio: 1, converted: false });
    expect(resolved.warning).toMatch(/US short tons .*"tonnes" for metric tons/);
  });

  it.each([
    ['purchased_electricity', 'CAMX', 'therms'], // energy, but never kWh of electricity
    ['purchased_electricity', 'CAMX', 'GJ'],
    ['stationary_combustion', 'natural_gas', 'gallons'], // a liquid volume is not a gas volume
    ['business_travel', 'air_short_haul', 'miles'], // vehicle distance is not passenger distance
    ['purchased_goods', 'purchased_goods', 'EUR'],
    ['business_travel', 'hotel', 'nights'],
    ['stationary_combustion', 'natural_gas', ''],
  ])('refuses %s %s in "%s"', (category, source, typed) => {
    expect(units.resolveUnit(unitsOf(category, source), typed)).toBeNull();
  });

  it('lists what a source accepts: its catalog units, then the units converted into them', () => {
    expect(units.acceptedUnits(unitsOf('stationary_combustion', 'natural_gas')))
      .toEqual(['MMBtu', 'therms', 'MCF', 'GJ', 'kWh', 'MWh', 'Dth', 'scf', 'ccf', 'm3']);
    expect(units.acceptedUnits(unitsOf('purchased_electricity', 'CAMX'))).toEqual(['kWh', 'MWh']);
    expect(units.unitHint(['kWh', 'MWh'])).toBe('one of: kWh, MWh');
  });

  it('a converted amount keeps 12 significant digits (1234.5 ccf is 123.45 MCF, not 123.45000000000002)', () => {
    expect(units.convertAmount(1234.5, 0.1)).toBe(123.45);
  });
});

describe('a conversion never changes a factor: the result equals the catalog\'s own factor for that unit', () => {
  // Priced with today's catalog, as a CSV row is (a row without a catalog_version is a legacy row).
  const kg = (category: string, source: string, amount: number, unit: string) =>
    engine.calculateEntry({ scope: getSourceScope(category), category, source, amount, unit, catalog_version: CATALOG_VERSION }).co2e_tonnes * 1000;
  function getSourceScope(category: string) {
    return category === 'purchased_electricity' ? 'Scope 2' : category === 'waste' ? 'Scope 3' : 'Scope 1';
  }

  it('diesel in litres: via gallons equals the catalog\'s per-litre factor (within 0.01 %)', () => {
    // Stationary diesel, Hub Table 1 (citation): 10.21 kg CO2 + 0.41 g CH4 x 28 + 0.08 g N2O x 265 per gallon
    // = 10.24268 (catalog 10.2427), per litre / 3.785411784 = 2.70583. Mobile diesel is CO2 only (10.21: EPA
    // gives its CH4 and N2O per vehicle-mile), so since catalog 2026-09-30 the check stays within one source.
    const resolved = units.resolveUnit(['gallons'], 'liters');
    const viaGallons = kg('stationary_combustion', 'diesel', units.convertAmount(1000, resolved.ratio), 'gallons');
    expect(Math.abs(viaGallons - kg('stationary_combustion', 'diesel', 1000, 'liters')) / viaGallons).toBeLessThan(1e-4);
    expect(viaGallons).toBeCloseTo((1000 / 3.785411784) * (10.21 + (0.41 * 28 + 0.08 * 265) / 1000), 0);
  });

  it('a gallons-only source (mobile diesel, 10.21 kg CO2 per gallon) priced from litres: factor per gallon / 3.785411784 x litres', () => {
    const resolved = units.resolveUnit(unitsOf('mobile_combustion', 'diesel'), 'liters');
    expect(resolved).toMatchObject({ unit: 'gallons', converted: true });
    expect(kg('mobile_combustion', 'diesel', units.convertAmount(1000, resolved.ratio), resolved.unit)).toBeCloseTo((10.21 / 3.785411784) * 1000, 2);
  });

  it('natural gas in GJ: via MMBtu equals the catalog\'s per-GJ factor (within 0.01 %)', () => {
    const resolved = units.resolveUnit(['MMBtu'], 'GJ');
    const viaMmbtu = kg('stationary_combustion', 'natural_gas', units.convertAmount(100, resolved.ratio), 'MMBtu');
    expect(Math.abs(viaMmbtu - kg('stationary_combustion', 'natural_gas', 100, 'GJ')) / viaMmbtu).toBeLessThan(1e-4);
  });

  it('therms and MMBtu: 10 therms are 1 MMBtu, as the catalog prices them (5.31145 = 53.1145 / 10)', () => {
    // Hub Table 1 (citation): 53.06 kg CO2 + 1.0 g CH4 x 28 + 0.10 g N2O x 265 = 53.1145 kg per mmBtu.
    expect(units.resolveUnit(['MMBtu'], 'therm').ratio).toBe(0.1);
    expect(kg('stationary_combustion', 'natural_gas', 1000, 'therms')).toBeCloseTo((1000 * (53.06 + (1.0 * 28 + 0.1 * 265) / 1000)) / 10, 3);
    expect(kg('stationary_combustion', 'natural_gas', 10, 'therms')).toBeCloseTo(kg('stationary_combustion', 'natural_gas', 1, 'MMBtu'), 9);
  });
});

describe('strict amounts (Number() read "0x1F" as 31 and "1e999" as Infinity)', () => {
  it.each([
    ['1200', 1200],
    ['1,200', 1200],
    ['1,200.50', 1200.5],
    ['1,234,567', 1234567],
    ['0.25', 0.25],
    ['.5', 0.5],
    [' 42 ', 42],
    ['0', 0],
  ])('"%s" is %s', (text, value) => {
    expect(units.parseStrictDecimal(text)).toEqual({ value });
  });

  it.each([
    ['', /is blank/],
    ['   ', /is blank/],
    ['0x1F', /not a plain number/],
    ['1e999', /scientific notation/],
    ['1.2E+05', /scientific notation/],
    ['-5', /is negative/],
    ['1,20', /not a plain number/],
    ['$1,200', /not a plain number/],
    ['1 200', /not a plain number/],
    ['Infinity', /not a plain number/],
    ['NaN', /not a plain number/],
    ['1000000000000000', /too large/],
  ])('"%s" is refused', (text, message) => {
    expect(units.parseStrictDecimal(text).error).toMatch(message);
  });
});

describe('POST /api/calculate prices an entry exactly as a CSV row', () => {
  it('converts the unit and parses a text amount strictly', () => {
    const prepared = units.prepareCalculatorEntry({ scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: '1,000', unit: 'ccf' }, 0);
    expect(prepared).toMatchObject({ amount: 100, unit: 'MCF', activity_amount: 1000, activity_unit: 'ccf' });
    expect(() => units.prepareCalculatorEntry({ scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: '0x1F', unit: 'therms' }, 2))
      .toThrow('Entry 3: amount "0x1F" is not a plain number');
  });

  it('leaves what it cannot resolve for the engine to report', () => {
    const entry = { scope: 'Scope 1', category: 'unknown', source: 'x', amount: 5, unit: 'therms' };
    expect(units.prepareCalculatorEntry(entry, 0)).toBe(entry);
  });
});

describe('the CSV format panel lists the conversions units.cjs applies', () => {
  it('src/lib/csvTemplate.ts UNIT_GROUPS equals unitGroups()', () => {
    expect(UNIT_GROUPS).toEqual(units.unitGroups());
  });
});
