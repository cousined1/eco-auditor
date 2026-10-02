// @vitest-environment node
/**
 * F-E-02 (GHG Protocol classification) and F-B-16 (engine half), for entries
 * priced by the 2026-09-30 catalog. Vectors from the audit's recompute
 * (evidence/lane-e/recompute-vectors.cjs):
 *   V14 wood 10 short tons: Scope 1 = CH4 + N2O only, 0.20223 t; the 16.4 t of
 *       biogenic CO2 is reported separately (Corporate Standard ch. 4).
 *   V27 R-22 10 kg: not a Kyoto gas, so 0 t in Scope 1 and a separate 17.6 t line.
 *   V24 renewable contract, 100,000 kWh at a CAMX site: location-based 19.5 t
 *       (the grid factor), market-based 0 (Scope 2 Guidance 1.5.1).
 * On the code before K7 each of these fails: wood was 16.4 t of Scope 1, R-22
 * 17.6 t of Scope 1, the renewable row 0 t of "location-based" Scope 2, own-fleet
 * distance was filed as Scope 3, and an unknown category was reported as an
 * unsupported Scope 1 source/unit.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const engine = require('../emissions-engine.cjs');
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION } = require('../emission-factors.cjs');

const priced = (entry: Record<string, unknown>) => engine.calculateEntry({ ...entry, catalog_version: CATALOG_VERSION });
const S1 = (category: string, source: string, amount: number, unit: string) => ({ scope: 'Scope 1', category, source, amount, unit });
const S2 = (category: string, source: string, amount: number, unit: string) => ({ scope: 'Scope 2', category, source, amount, unit });
const S3 = (category: string, source: string, amount: number, unit: string) => ({ scope: 'Scope 3', category, source, amount, unit });
const AR5 = { CH4: 28, N2O: 265 };
const CAMX_KG_PER_KWH = 0.19504; // eGRID2023 Rev 2, 430.0 lb CO2e/MWh

describe('biogenic CO2 and non-Kyoto gases are reported outside Scope 1 (F-E-02)', () => {
  it('V14: wood counts its CH4 and N2O in Scope 1 and its biogenic CO2 on a separate line', () => {
    const row = priced(S1('stationary_combustion', 'wood', 10, 'short tons'));
    expect(row.reporting_bucket).toBe('scope1');
    expect(row.co2e_tonnes).toBeCloseTo((10 * (126 * AR5.CH4 + 63 * AR5.N2O)) / 1e6, 6); // 0.20223
    expect(row.biogenic_co2_tonnes).toBeCloseTo(16.4, 6);
    const summary = engine.summarizeEntries([{ ...S1('stationary_combustion', 'wood', 10, 'short tons'), catalog_version: CATALOG_VERSION }]);
    expect(summary.by_scope.scope1).toBeCloseTo(0.20223, 6);
    expect(summary.biogenic_co2_t).toBeCloseTo(16.4, 6);
    expect(summary.total_emissions_tCO2e).toBeCloseTo(0.20223, 6);
  });

  it('V27: R-22 is 0 t of Scope 1 and 17.6 t on the non-Kyoto line', () => {
    const row = priced(S1('fugitive_emissions', 'refrigerant_r22', 10, 'kg'));
    expect(row.reporting_bucket).toBe('memo:non-kyoto');
    expect(row.co2e_tonnes).toBeCloseTo(17.6, 6);
    const summary = engine.summarizeEntries([{ ...S1('fugitive_emissions', 'refrigerant_r22', 10, 'kg'), catalog_version: CATALOG_VERSION }]);
    expect(summary.by_scope.scope1).toBe(0);
    expect(summary.non_kyoto_tCO2e).toBeCloseTo(17.6, 6);
    expect(summary.total_emissions_tCO2e).toBe(0);
    expect(summary.by_category.fugitive_emissions).toBeUndefined();
  });

  it('R-410A (a Kyoto HFC blend) stays in Scope 1', () => {
    expect(priced(S1('fugitive_emissions', 'refrigerant_r410a', 10, 'kg'))).toMatchObject({ reporting_bucket: 'scope1', co2e_tonnes: 19.24 });
  });
});

describe('Scope 2 is reported location-based and market-based (F-E-02)', () => {
  it('V24: a renewable contract counts at the grid factor location-based and at zero market-based', () => {
    const row = priced(S2('renewable_electricity', 'CAMX', 100000, 'kWh'));
    expect(row.co2e_tonnes).toBeCloseTo(100000 * CAMX_KG_PER_KWH / 1000, 6);
    expect(row.scope2_market_tonnes).toBe(0);
    const summary = engine.summarizeEntries([{ ...S2('renewable_electricity', 'CAMX', 100000, 'kWh'), catalog_version: CATALOG_VERSION }]);
    expect(summary.by_scope.scope2).toBeCloseTo(19.504, 6);
    expect(summary.scope2_market_tCO2e).toBe(0);
  });

  it('grid electricity and steam report the same value on both bases (no residual-mix factor is applied)', () => {
    for (const entry of [S2('purchased_electricity', 'RFCE', 1000, 'kWh'), S2('purchased_heat_steam', 'steam', 10, 'MMBtu')]) {
      const row = priced(entry);
      expect(row.scope2_market_tonnes, entry.source).toBe(row.co2e_tonnes);
    }
  });

  it('a renewable contract needs the site\'s subregion: the retired zero-factor subregion is refused with a pointer', () => {
    expect(() => priced(S2('purchased_electricity', 'RENEWABLE', 1000, 'kWh')))
      .toThrow(/Unsupported eGRID subregion: RENEWABLE\. .*renewable_electricity, with the site's eGRID subregion/);
  });
});

describe('own-fleet distance is Scope 1 mobile combustion, third-party freight is Scope 3 (F-E-02)', () => {
  it('prices own-fleet vehicle-miles in Scope 1 at the EPA per-vehicle-mile factor', () => {
    const row = priced(S1('mobile_combustion', 'fleet_truck_medium_heavy', 10000, 'vehicle-miles'));
    expect(row).toMatchObject({ scope: 'scope1', reporting_bucket: 'scope1', normalized_category: 'mobile_combustion' });
    expect(row.co2e_tonnes).toBeCloseTo((10000 * (1.298 + (0.0115 * AR5.CH4 + 0.0376 * AR5.N2O) / 1000)) / 1000, 3); // V33 13.083
  });

  it('files distance on the transportation category as third-party freight in Scope 3, and cannot relabel it Scope 1', () => {
    expect(priced(S3('transportation', 'truck_medium_heavy', 10000, 'vehicle-miles')).scope).toBe('scope3');
    expect(() => priced(S1('transportation', 'truck_medium_heavy', 10000, 'vehicle-miles'))).toThrow(/is Scope 3/);
  });

  it('rail freight is priced per short ton-mile; the old "miles" unit is refused', () => {
    expect(priced(S3('transportation', 'rail', 1000, 'short ton-miles')).co2e_tonnes).toBeCloseTo(0.0211773, 6);
    expect(() => priced(S3('transportation', 'rail', 1000, 'miles'))).toThrow(/Unsupported Scope 3 category\/source/);
  });
});

describe('the audit\'s CSV_2025_2026 file priced as new entries (F-E-02 acceptance)', () => {
  // evidence/lane-e/stack-common.mjs, with the dates bucketing FY2026.
  const csv = [
    S1('stationary_combustion', 'natural_gas', 1000, 'therms'),
    S1('stationary_combustion', 'wood', 10, 'short tons'),
    S1('fugitive_emissions', 'refrigerant_r22', 10, 'kg'),
    S2('purchased_electricity', 'CAMX', 100000, 'kWh'),
    S2('purchased_electricity', 'RENEWABLE', 100000, 'kWh'),
    S1('stationary_combustion', 'natural_gas', 500, 'therm'),
  ].map((row, i) => ({ ...row, id: i + 1, catalog_version: CATALOG_VERSION }));
  const natGasTherm = (53.06 + (1.0 * AR5.CH4 + 0.1 * AR5.N2O) / 1000) / 10; // Hub Table 1 with CH4/N2O

  it('as written: Scope 1 = gas + wood CH4/N2O, both memo lines, and the zero-factor RENEWABLE row is excluded with its reason', () => {
    const s = engine.summarizeEntries(csv);
    expect(s.by_scope.scope1).toBeCloseTo((1000 * natGasTherm) / 1000 + 0.20223, 5); // 5.51368 (5.508 with CO2-only gas)
    expect(s.biogenic_co2_t).toBeCloseTo(16.4, 6);
    expect(s.non_kyoto_tCO2e).toBeCloseTo(17.6, 6);
    expect(s.by_scope.scope2).toBeCloseTo(19.504, 6);
    expect(s.excluded_rows.count).toBe(2);
    expect(s.excluded_rows.reasons.map((r: { reason: string }) => r.reason).join(' | ')).toMatch(/RENEWABLE[\s\S]*therm/);
  });

  it('with the renewable row entered at its CAMX site: location-based Scope 2 = 2 x CAMX, market-based = 1 x CAMX', () => {
    const fixed = csv.map((row) => (row.source === 'RENEWABLE' ? { ...row, category: 'renewable_electricity', source: 'CAMX' } : row));
    const s = engine.summarizeEntries(fixed);
    expect(s.by_scope.scope2).toBeCloseTo(39.008, 6);
    expect(s.scope2_market_tCO2e).toBeCloseTo(19.504, 6);
    expect(s.excluded_rows.count).toBe(1);
  });

  it('the same file as stored legacy rows (no pin) keeps the old figures: 39.306 t of Scope 1, Scope 2 19.504 t', () => {
    const legacy = csv.map((row) => ({ ...row, catalog_version: undefined }));
    const s = engine.summarizeEntries(legacy);
    expect(s.by_scope.scope1).toBeCloseTo(5.306 + 16.4 + 17.6, 6);
    expect(s.by_scope.scope2).toBeCloseTo(19.504, 6);
    expect(s.non_kyoto_tCO2e + s.biogenic_co2_t).toBe(0);
  });
});

describe('a row is priced and classified by the catalog it names', () => {
  it('a K2 row pinned before this catalog keeps its stored factor and its old classification', () => {
    const pinned = { ...S1('stationary_combustion', 'natural_gas', 1000, 'therms'), factor_value: 5.306, catalog_version: LEGACY_CATALOG_VERSION };
    expect(engine.calculateEntry(pinned).co2e_tonnes).toBe(5.306);
    const wood = { ...S1('stationary_combustion', 'wood', 1, 'short tons'), factor_value: 1640, catalog_version: LEGACY_CATALOG_VERSION };
    expect(engine.calculateEntry(wood)).toMatchObject({ co2e_tonnes: 1.64, reporting_bucket: 'scope1' });
    expect(engine.calculateEntry(wood).biogenic_co2_tonnes).toBeUndefined();
  });

  it('a row pinned to this catalog uses its stored factor_value as is, with this catalog\'s classification', () => {
    const wood = { ...S1('stationary_combustion', 'wood', 2, 'short tons'), factor_value: 20.223, catalog_version: CATALOG_VERSION };
    expect(engine.calculateEntry(wood)).toMatchObject({ co2e_tonnes: 0.040446, reporting_bucket: 'scope1', biogenic_co2_tonnes: 3.28 });
    const odd = { ...S2('purchased_electricity', 'CAMX', 1000, 'kWh'), factor_value: 0.5, catalog_version: CATALOG_VERSION };
    expect(engine.calculateEntry(odd).co2e_tonnes).toBe(0.5);
  });

  it('an unpinned row is a legacy row, whatever today\'s catalog says', () => {
    expect(engine.calculateEntry(S1('stationary_combustion', 'fuel_oil_4', 1000, 'gallons')).co2e_tonnes).toBe(10.69);
    expect(priced(S1('stationary_combustion', 'fuel_oil_4', 1000, 'gallons')).co2e_tonnes).toBe(10.9962);
  });
});

describe('an unknown category is reported as one, with the categories of that scope (F-B-16)', () => {
  it('names the category and lists the valid ones, on both catalogs', () => {
    const row = S1('made_up_category', 'natural_gas', 1000, 'therms');
    const message = /^Unknown category: made_up_category\. Scope 1 categories: stationary_combustion, mobile_combustion, process_emissions, fugitive_emissions\.$/;
    expect(() => engine.calculateEntry(row)).toThrow(message);
    expect(() => priced(row)).toThrow(message);
    expect(() => priced(S2('district_cooling', 'x', 1, 'kWh'))).toThrow(/^Unknown category: district_cooling\. Scope 2 categories: purchased_electricity, renewable_electricity, purchased_heat_steam\.$/);
  });

  it('keeps blaming the source or unit when the category exists', () => {
    expect(() => priced(S1('stationary_combustion', 'natural_gas', 1000, 'therm'))).toThrow(/Unsupported Scope 1 source\/unit: natural_gas therm/);
  });

  it('still passes a CO2e total with an unknown category through, as before', () => {
    expect(engine.calculateEntry(S3('misc', 'supplier data', 3, 't CO2e')).co2e_tonnes).toBe(3);
  });
});
