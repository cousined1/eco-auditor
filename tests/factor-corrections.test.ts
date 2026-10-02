// @vitest-environment node
/**
 * F-E-15 and F-E-06: every factor the 2026-09-30 catalog corrects or replaces,
 * against the primary value it cites. The primary rows are typed here
 * independently of emission-factors.json, from the EPA GHG Emission Factors Hub
 * 2025 PDF (SHA-256 5d07c678..., fetched from epa.gov on 2026-09-30), the GHG
 * Protocol GWP table v2.0 and the UK DESNZ 2026 flat file (ID
 * 29_600_4053_13_1). CO2e = kg CO2 + (g CH4 x 28 + g N2O x 265) / 1000 (AR5, as
 * the Hub states). Verdict as in the audit's recompute: within 0.5 %.
 *
 * On the code before K7 this file fails: No. 4 was 10.69 (the Hub's Lubricants
 * row), No. 6 11.1, lignite 1,410, "coal" 2,070 matched no rank, the natural gas
 * vehicle 11.171 matched no fuel, rail was offered per "mile", and the travel,
 * commuting and waste factors were internal estimates 8-146 % off.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { calculateEntry } = require('../emissions-engine.cjs');
const { CATALOG, CATALOG_VERSION, getSource } = require('../emission-factors.cjs');

const co2e = (kgCO2: number, gCH4 = 0, gN2O = 0) => kgCO2 + (gCH4 * 28 + gN2O * 265) / 1000;
const KG_PER_SHORT_TON = 907.18474;

// [category, source, unit, primary kg CO2e per unit, where it comes from]
const PRIMARY: [string, string, string, number, string][] = [
  ['stationary_combustion', 'fuel_oil_4', 'gallons', co2e(10.96, 0.44, 0.09), 'V09 Hub T1 Distillate Fuel Oil No. 4'],
  ['stationary_combustion', 'fuel_oil_6', 'gallons', co2e(11.27, 0.45, 0.09), 'V10 Hub T1 Residual Fuel Oil No. 6'],
  ['stationary_combustion', 'kerosene', 'gallons', co2e(10.15, 0.41, 0.08), 'V11 Hub T1 Kerosene'],
  ['stationary_combustion', 'lignite_coal', 'short tons', co2e(1389, 156, 23), 'V12 Hub T1 Lignite (1,399.46 CO2e)'],
  ['stationary_combustion', 'coal_mixed_commercial', 'short tons', co2e(2016, 235, 34), 'V13 Hub T1 Mixed (Commercial Sector)'],
  ['stationary_combustion', 'coal_mixed_industrial', 'short tons', co2e(2116, 246, 36), 'V13 alt Hub T1 Mixed (Industrial Sector)'],
  ['stationary_combustion', 'coal_anthracite', 'short tons', co2e(2602, 276, 40), 'Hub T1 Anthracite'],
  ['stationary_combustion', 'coal_bituminous', 'short tons', co2e(2325, 274, 40), 'Hub T1 Bituminous'],
  ['stationary_combustion', 'coal_subbituminous', 'short tons', co2e(1676, 190, 28), 'Hub T1 Sub-bituminous'],
  ['stationary_combustion', 'natural_gas', 'therms', co2e(53.06, 1.0, 0.1) / 10, 'V01 Hub T1 Natural Gas'],
  ['stationary_combustion', 'natural_gas', 'MCF', co2e(0.05444, 0.00103, 0.0001) * 1000, 'V03 Hub T1 Natural Gas per scf'],
  ['stationary_combustion', 'propane', 'gallons', co2e(5.72, 0.27, 0.05), 'V05 Hub T1 Propane'],
  ['stationary_combustion', 'diesel', 'gallons', co2e(10.21, 0.41, 0.08), 'V07 Hub T1 Distillate Fuel Oil No. 2'],
  ['stationary_combustion', 'fuel_oil_1', 'gallons', co2e(10.18, 0.42, 0.08), 'V48 Hub T1 Distillate Fuel Oil No. 1'],
  ['stationary_combustion', 'gasoline', 'gallons', co2e(8.78, 0.38, 0.08), 'V50 Hub T1 Motor Gasoline'],
  ['mobile_combustion', 'lng', 'gallons', 4.5, 'V18 Hub T2 Liquefied Natural Gas (LNG)'],
  ['mobile_combustion', 'cng', 'scf', 0.05444, 'Hub T2 Compressed Natural Gas (CNG)'],
  ['purchased_heat_steam', 'steam', 'MMBtu', co2e(66.33, 1.25, 0.125), 'V25 Hub T7 Steam and Heat'],
  ['purchased_heat_steam', 'hot_water', 'MMBtu', co2e(66.33, 1.25, 0.125), 'Hub T7 Steam and Heat'],
  ['transportation', 'truck_medium_heavy', 'vehicle-miles', co2e(1.298, 0.0115, 0.0376), 'V33 Hub T8 Medium- and Heavy-Duty Truck'],
  ['transportation', 'rail', 'short ton-miles', co2e(0.021, 0.0016, 0.0005), 'V34 Hub T8 Rail per short ton-mile'],
  ['mobile_combustion', 'fleet_truck_medium_heavy', 'vehicle-miles', co2e(1.298, 0.0115, 0.0376), 'Hub T8 Medium- and Heavy-Duty Truck'],
  ['mobile_combustion', 'fleet_passenger_car', 'vehicle-miles', co2e(0.297, 0.0059, 0.0053), 'Hub T8 Passenger Car'],
  ['waste', 'landfill', 'kg', 580 / KG_PER_SHORT_TON, 'V35 Hub T9 Mixed MSW landfilled'],
  ['waste', 'recycling', 'kg', 90 / KG_PER_SHORT_TON, 'V36 Hub T9 Mixed Recyclables recycled'],
  ['waste', 'composting', 'kg', 130 / KG_PER_SHORT_TON, 'V37 Hub T9 Mixed Organics composted'],
  ['waste', 'landfill', 'short tons', 580, 'Hub T9 Mixed MSW landfilled'],
  ['business_travel', 'air_short_haul', 'passenger-miles', co2e(0.207, 0.0064, 0.0066), 'V39 Hub T10 Air Travel Short Haul'],
  ['business_travel', 'air_medium_haul', 'passenger-miles', co2e(0.129, 0.0006, 0.0041), 'V41 Hub T10 Air Travel Medium Haul'],
  ['business_travel', 'air_long_haul', 'passenger-miles', co2e(0.163, 0.0006, 0.0052), 'V40 Hub T10 Air Travel Long Haul'],
  ['business_travel', 'hotel', 'room-nights', 16.1, 'V42 DESNZ 2026 Hotel stay, United States'],
  ['business_travel', 'rental_car', 'miles', co2e(0.297, 0.0059, 0.0053), 'V43 Hub T10 Passenger Car'],
  ['employee_commuting', 'car_alone', 'miles', co2e(0.297, 0.0059, 0.0053), 'V45 Hub T10 Passenger Car'],
  ['employee_commuting', 'bus', 'passenger-miles', co2e(0.066, 0.0046, 0.0019), 'V46 Hub T10 Bus'],
  ['employee_commuting', 'commuter_rail', 'passenger-miles', co2e(0.133, 0.0105, 0.0026), 'V46 alt Hub T10 Commuter Rail'],
  ['employee_commuting', 'transit_rail', 'passenger-miles', co2e(0.093, 0.0075, 0.001), 'Hub T10 Transit Rail'],
  ['fugitive_emissions', 'refrigerant_r22', 'kg', 1760, 'V27 memo GHG Protocol GWP v2.0 HCFC-22 AR5'],
];

const scopeOf = (category: string) => CATALOG.categories.find((c: { key: string }) => c.key === category).scope;

describe('each corrected or replaced factor equals the primary value it cites (within 0.5 %)', () => {
  it.each(PRIMARY)('%s / %s per %s', (category, source, unit, expected) => {
    const row = calculateEntry({ scope: String(scopeOf(category)), category, source, amount: 1000, unit, catalog_version: CATALOG_VERSION });
    const kgPerUnit = row.co2e_tonnes; // 1000 units -> tonnes = kg per unit
    expect(Math.abs(kgPerUnit / expected - 1)).toBeLessThanOrEqual(0.005);
  });

  it('a factor is flagged provisional only when it does not match its cited row: the corrected ones are not, the car-pool occupancy is', () => {
    for (const [category, source] of PRIMARY) {
      expect(getSource(category, source).verified, `${category}/${source}`).not.toBe(false);
    }
    expect(getSource('employee_commuting', 'car_pool').verified).toBe(false);
  });

  it('the ambiguous or wrong sources are gone from the current catalog (older rows still price, with the frozen one)', () => {
    for (const [category, source, unit] of [
      ['stationary_combustion', 'coal', 'short tons'],
      ['mobile_combustion', 'natural_gas_vehicle', 'gallons'],
      ['employee_commuting', 'public_transit', 'passenger-miles'],
      ['purchased_heat_steam', 'steam', 'lb'],
      ['purchased_heat_steam', 'hot_water', 'lb'],
      ['transportation', 'heavy_duty_diesel', 'miles'],
    ]) {
      const entry = { scope: String(scopeOf(category)), category, source, amount: 1, unit };
      expect(() => calculateEntry({ ...entry, catalog_version: CATALOG_VERSION }), `${category}/${source}`).toThrow();
      expect(calculateEntry(entry).co2e_tonnes, `${category}/${source} legacy`).toBeGreaterThanOrEqual(0);
    }
  });

  it('the stationary basis is CO2e with CH4 and N2O; mobile fuel states its CO2-only basis', () => {
    expect(CATALOG.basis).toMatch(/CO2, CH4 and N2O at IPCC AR5/);
    for (const source of ['gasoline', 'diesel', 'jet_fuel', 'lng', 'cng']) {
      expect(getSource('mobile_combustion', source).basis, source).toMatch(/kg CO2 per .*CH4 and N2O (are )?excluded/);
    }
  });
});
