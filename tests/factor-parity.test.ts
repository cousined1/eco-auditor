import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  calculateEmissions,
  factorFor as clientFactorFor,
  unitsForSource,
  categoriesForScope,
  getSource,
} from '../src/lib/emission-factors/factors';

const require = createRequire(import.meta.url);
const { calculateEntry } = require('../emissions-engine.cjs');
const { factorFor: serverFactorFor, CATALOG, CATALOG_VERSION } = require('../emission-factors.cjs');

// The client calculator and the server engine each read emission-factors.json
// through their own adapter. Before the merge they carried independent tables
// and disagreed for the same activity (gasoline 8.887 vs 8.78, electricity
// 0.417 vs 0.2168), so a customer's number depended on whether they typed it
// into the form or imported it from CSV. These tests make that class of bug
// impossible to reintroduce silently.
describe('factor parity between client and server', () => {
  const scopeOf = (categoryKey: string) =>
    CATALOG.categories.find((c: { key: string }) => c.key === categoryKey).scope;

  // Every category/source/unit in the catalog, exercised through both paths.
  const triples: Array<{ category: string; source: string; unit: string }> = [];
  for (const category of CATALOG.categories) {
    for (const source of category.sources) {
      for (const unit of Object.keys(source.units)) {
        triples.push({ category: category.key, source: source.key, unit });
      }
    }
  }

  it('covers the whole catalog', () => {
    expect(triples.length).toBeGreaterThan(80);
  });

  it('resolves an identical factor on both sides for every catalog entry', () => {
    const mismatches = triples.filter(
      (t) => clientFactorFor(t.category, t.source, t.unit) !== serverFactorFor(t.category, t.source, t.unit),
    );
    expect(mismatches).toEqual([]);
  });

  it('produces the same CO2e through the form path and the engine path', () => {
    const amount = 1000;
    const mismatches: string[] = [];

    for (const t of triples) {
      const clientKg = calculateEmissions(t.category, t.source, amount, t.unit);
      // The form prices a new entry, so the engine side does too: a row with no
      // catalog_version is a stored legacy row to the engine (frozen catalog).
      const engine = calculateEntry({
        scope: String(scopeOf(t.category)),
        category: t.category,
        source: t.source,
        amount,
        unit: t.unit,
        catalog_version: CATALOG_VERSION,
      });
      const engineKg = engine.co2e_tonnes * 1000;
      // round() in the engine keeps 6 decimals of tonnes, i.e. 0.001 kg.
      if (clientKg === null || Math.abs(clientKg - engineKg) > 0.01) {
        mismatches.push(`${t.category}/${t.source}/${t.unit}: client ${clientKg} vs engine ${engineKg}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('rejects a unit the source is not defined for, on both sides', () => {
    // Natural gas is sold by energy content, never by the gallon.
    expect(clientFactorFor('stationary_combustion', 'natural_gas', 'gallons')).toBeNull();
    expect(serverFactorFor('stationary_combustion', 'natural_gas', 'gallons')).toBeNull();
    expect(calculateEmissions('stationary_combustion', 'natural_gas', 100, 'gallons')).toBeNull();
    expect(() =>
      calculateEntry({
        scope: '1',
        category: 'stationary_combustion',
        source: 'natural_gas',
        amount: 100,
        unit: 'gallons',
      }),
    ).toThrow(/Unsupported Scope 1/);
  });

  it('keeps the CSV source aliases the engine relied on', () => {
    // Server CSV rows name mobile sources by drivetrain; the form names the fuel.
    for (const alias of ['gasoline_passenger', 'gasoline_light_truck']) {
      expect(serverFactorFor('mobile_combustion', alias, 'gallons')).toBe(8.78);
    }
    for (const alias of ['diesel_heavy_truck', 'diesel_bus']) {
      expect(serverFactorFor('mobile_combustion', alias, 'gallons')).toBe(10.21);
    }
  });

  it('falls back to the category spend factor for an unrecognised Scope 3 source', () => {
    // A CSV row naming an arbitrary vendor still prices against the category.
    expect(serverFactorFor('purchased_goods', 'acme_supplies_inc', 'USD')).toBe(0.25);
    expect(getSource('purchased_goods', 'acme_supplies_inc')?.key).toBe('purchased_goods');
  });

  it('resolves a category that lists another category\'s sources the same way on both sides', () => {
    // renewable_electricity has no sources of its own; it prices every eGRID
    // subregion (location-based) like purchased_electricity.
    const subregions = CATALOG.categories.find((c: { key: string }) => c.key === 'purchased_electricity').sources;
    expect(subregions.length).toBeGreaterThan(20);
    for (const source of subregions) {
      for (const unit of Object.keys(source.units)) {
        expect(clientFactorFor('renewable_electricity', source.key, unit), source.key).toBe(source.units[unit]);
        expect(serverFactorFor('renewable_electricity', source.key, unit), source.key).toBe(source.units[unit]);
      }
    }
  });
});

describe('the unit selector is no longer decorative', () => {
  // Regression for the original bug: calculateEmissions took no unit, so the
  // factor was applied to whatever number was typed regardless of the unit.
  it('gives a different answer per unit for the same source and amount', () => {
    const perMMBtu = calculateEmissions('stationary_combustion', 'natural_gas', 1000, 'MMBtu');
    const perTherm = calculateEmissions('stationary_combustion', 'natural_gas', 1000, 'therms');

    // EPA Hub 2025 Table 1 with CH4 and N2O at AR5 (catalog 2026-09-30).
    expect(perMMBtu).toBeCloseTo(53114.5, 3);
    expect(perTherm).toBeCloseTo(5311.45, 3);
    // The old code returned the per-MMBtu figure for both — a 10x overstatement on therms.
    expect(perTherm).not.toBeCloseTo(perMMBtu as number, 0);
  });

  it('prices 10 MWh of US-average grid as ~3,497 kg, not 4.17 kg', () => {
    // The old client table held a single per-kWh factor and ignored MWh, so
    // 10 MWh was priced as 10 kWh — a 1000x understatement.
    expect(calculateEmissions('purchased_electricity', 'US_AVERAGE', 10, 'MWh')).toBeCloseTo(3497, 3);
  });

  it('only offers units that the selected source actually supports', () => {
    expect(unitsForSource('stationary_combustion', 'natural_gas')).toEqual(['MMBtu', 'therms', 'MCF', 'GJ']);
    expect(unitsForSource('purchased_electricity', 'CAMX')).toEqual(['kWh', 'MWh']);
    expect(unitsForSource('fugitive_emissions', 'refrigerant_r410a')).toEqual(['kg']);
    // Nothing offers the old flat list of eight units to every source.
    expect(unitsForSource('purchased_electricity', 'CAMX')).not.toContain('gallons');
  });

  it('exposes calculator categories per scope', () => {
    expect(categoriesForScope('Scope 1').map((c) => c.key)).toEqual([
      'stationary_combustion',
      'mobile_combustion',
      'process_emissions',
      'fugitive_emissions',
    ]);
    // Spend-only Scope 3 categories stay out of the manual-entry form.
    expect(categoriesForScope('Scope 3').map((c) => c.key)).not.toContain('capital_goods');
  });
});
