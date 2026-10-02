// F-E-14 — what the public Methodology page says the product covers, as data.
// The page used to list examples the factor catalog has no source for
// (chilled water, net metering, business rail) and a confidence table that
// disagreed with the engine (leased assets 65 vs 70; process, fugitive,
// steam/heat and pre-calculated rows missing). tests/methodology-content.test.ts
// now checks every example against emission-factors.json and every confidence
// row against CONFIDENCE_BY_CATEGORY in emissions-engine.cjs, so the page cannot
// list coverage the engine lacks.
import { PRECOMPUTED_CONFIDENCE } from '@/lib/emission-factors/factors';

export type ScopeExample = {
  readonly label: string;
  /** Category key in emission-factors.json. */
  readonly category: string;
  /** Source key in that category; defaults to the category key. */
  readonly source?: string;
};

export type ScopeSection = {
  readonly id: 'scope1' | 'scope2' | 'scope3';
  readonly title: string;
  readonly subtitle: string;
  readonly color: string;
  readonly examples: readonly ScopeExample[];
  readonly method: string;
  readonly badge: string;
};

export const SCOPES: readonly ScopeSection[] = [
  {
    id: 'scope1',
    title: 'Scope 1 — Direct Emissions',
    subtitle: 'Sources you own or control',
    color: 'from-red-500 to-orange-500',
    examples: [
      { label: 'Natural gas combustion in boilers and furnaces', category: 'stationary_combustion', source: 'natural_gas' },
      { label: 'Company-owned vehicle fuel', category: 'mobile_combustion', source: 'gasoline' },
      { label: 'Refrigerant leakage from HVAC equipment', category: 'fugitive_emissions', source: 'refrigerant_r410a' },
      { label: 'On-site diesel generators', category: 'stationary_combustion', source: 'diesel' },
      { label: 'Process emissions (cement, steel, ammonia)', category: 'process_emissions', source: 'cement' },
    ],
    method:
      'Activity data (fuel bills, meter readings) × EPA emission factors, with CH₄ and N₂O included for fuels burned on site. Company-owned vehicles: fuel volume, or distance by vehicle type. Refrigerant leakage calculated as refrigerant mass × IPCC AR5 GWP-100. Reported separately, outside Scope 1: the biogenic CO₂ from burning wood (only its CH₄ and N₂O count in Scope 1), and R-22 and other HCFCs, which the Kyoto Protocol does not cover. Process-emission factors (cement, steel, ammonia) are Eco-Auditor internal estimates.',
    badge: 'GHG Protocol required',
  },
  {
    id: 'scope2',
    title: 'Scope 2 — Purchased Energy',
    subtitle: 'Indirect emissions from purchased electricity, steam, and hot water',
    color: 'from-blue-500 to-indigo-500',
    examples: [
      { label: 'Purchased electricity (grid)', category: 'purchased_electricity', source: 'US_AVERAGE' },
      { label: 'Electricity under a renewable contract (RECs, PPA, green tariff)', category: 'renewable_electricity', source: 'US_AVERAGE' },
      { label: 'Purchased steam or hot water', category: 'purchased_heat_steam', source: 'steam' },
    ],
    // F-E-02: a renewable contract used to be a subregion with a factor of 0,
    // which zeroed the location-based total. tests/methodology-content.test.ts
    // checks this text against the catalog's renewable_electricity category.
    method:
      'Location-based: kWh × eGRID subregion emission factor (lbs/MWh); this is the Scope 2 total. Electricity bought under a renewable contract (RECs, PPA, green tariff) is entered with its site\'s eGRID subregion: it counts at the grid factor in the location-based total and at zero in a separate market-based total. Other electricity has no residual-mix factor yet, so its market-based value equals its location-based one. Steam and hot water use the EPA factor per mmBtu of heat purchased. Entries saved before the 2026-09-30 factor catalog keep their earlier treatment (a renewable contract counted at zero) until they are restated.',
    badge: 'Location-based',
  },
  {
    id: 'scope3',
    title: 'Scope 3 — Value Chain',
    subtitle: 'All other indirect emissions in your value chain',
    color: 'from-emerald-500 to-teal-500',
    examples: [
      { label: 'Purchased goods & services (spend-based)', category: 'purchased_goods' },
      { label: 'Upstream transportation & distribution', category: 'transport_inbound' },
      { label: 'Business travel (air, hotel, rental car)', category: 'business_travel', source: 'air_short_haul' },
      { label: 'Employee commuting', category: 'employee_commuting' },
      { label: 'Downstream transportation', category: 'transport_outbound' },
      { label: 'Waste generated in operations', category: 'waste' },
    ],
    method:
      'Common Scope 3 categories via spend-based and activity-based estimates. Activity-based travel, commuting, freight and waste factors come from the EPA GHG Emission Factors Hub 2025 (US hotel stays from the UK DESNZ 2026 factors). Spend-based factors are Eco-Auditor internal estimates, not a published EEIO dataset.',
    badge: 'Spend-based Scope 3',
  },
];

export type ConfidenceRow = {
  readonly label: string;
  readonly desc: string;
  /** Engine categories (CONFIDENCE_BY_CATEGORY in emissions-engine.cjs) this row covers. */
  readonly categories: readonly string[];
  readonly confidence: number;
};

// The confidence values the engine assigns to CSV-imported rows and to entries
// saved through the calculator (POST /api/entries), per activity category.
// Every key of CONFIDENCE_BY_CATEGORY must appear in exactly one row.
export const CONFIDENCE_ROWS: readonly ConfidenceRow[] = [
  {
    label: 'Purchased electricity',
    desc: 'Metered kWh against a published eGRID subregion factor, including electricity under a renewable contract',
    categories: ['purchased_electricity', 'renewable_electricity'],
    confidence: 97,
  },
  {
    label: 'Stationary combustion, purchased steam or hot water',
    desc: 'Fuel volume or heat purchased against an EPA Emission Factors Hub factor',
    categories: ['stationary_combustion', 'purchased_heat_steam'],
    confidence: 90,
  },
  {
    label: 'Mobile combustion',
    desc: 'Fuel volume, or own-fleet distance, against an EPA Emission Factors Hub factor',
    categories: ['mobile_combustion'],
    confidence: 88,
  },
  {
    label: 'Fugitive emissions',
    desc: 'Refrigerant or leak quantity against a GWP-based factor (a CO2e total with no category, saved before the 2026-09-30 factor catalog, also scored 85)',
    categories: ['fugitive_emissions', 'precalculated'],
    confidence: 85,
  },
  {
    label: 'Process emissions',
    desc: 'Production volume against an Eco-Auditor internal estimate',
    categories: ['process_emissions'],
    confidence: 80,
  },
  {
    label: 'Waste, commuting',
    desc: 'Activity against an EPA factor, or spend against an internal estimate',
    categories: ['waste', 'employee_commuting'],
    confidence: 75,
  },
  {
    label: 'Transport, business travel, fuel & energy',
    desc: 'Activity against an EPA or UK DESNZ factor, or spend against an internal estimate',
    categories: ['fuel_transport', 'transport_inbound', 'transport_outbound', 'transportation', 'business_travel'],
    confidence: 72,
  },
  {
    label: 'Leased assets',
    desc: 'Spend-based estimate against a category-average factor',
    categories: ['leased_assets'],
    confidence: 70,
  },
  {
    label: 'Purchased goods, capital goods',
    desc: 'Spend-based estimate against a category-average factor',
    categories: ['purchased_goods', 'capital_goods'],
    confidence: 65,
  },
  {
    // Not a category: the catalog's own score for a CO2e figure typed in directly
    // (F-E-09), which used to inherit its category's score (97 as "electricity").
    label: 'A CO2e total you supply',
    desc: 'A figure entered in t or kg CO2e with no activity data or factor behind it (entries priced with the 2026-09-30 factor catalog; older ones keep the score they had)',
    categories: [],
    confidence: PRECOMPUTED_CONFIDENCE,
  },
];

/**
 * The fixed confidence the browser stored on every calculator entry before the
 * server entry API (K2), whatever its category. Those rows keep it; entries
 * saved through POST /api/entries get their category's score from the table above.
 */
export const LEGACY_MANUAL_ENTRY_CONFIDENCE = 85;
