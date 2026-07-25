export type Scope = 'Scope 1' | 'Scope 2' | 'Scope 3';

export type CategoryMap = Record<Scope, string[]>;

export const SCOPE_CATEGORIES: CategoryMap = {
  'Scope 1': [
    'Stationary Combustion',
    'Mobile Combustion',
    'Process Emissions',
    'Fugitive Emissions',
  ],
  'Scope 2': ['Purchased Electricity', 'Purchased Heat / Steam'],
  'Scope 3': [
    'Purchased Goods',
    'Business Travel',
    'Employee Commuting',
    'Waste',
    'Transportation',
  ],
};

export const UNITS = ['kWh', 'therms', 'gallons', 'miles', 'kg', 'tons', 'MMBtu', 'room-nights'] as const;

export type Unit = (typeof UNITS)[number];

// EPA emission factors — kg CO2e per unit
export const EMISSION_FACTORS: Record<string, Record<string, number>> = {
  'Stationary Combustion': {
    'Natural Gas': 53.06,      // per MMBtu
    Propane: 62.87,
    Diesel: 73.96,
    'Fuel Oil': 78.80,
    Coal: 95.35,
  },
  // EPA GHG Emission Factors Hub 2025, Table 2. Previous values came from a
  // different (older, passenger-vehicle fact sheet) vintage and disagreed with
  // the server engine for the same activity: gasoline 8.887 vs 8.78, diesel
  // 10.18 vs 10.21 — so form entry and CSV import produced different numbers.
  'Mobile Combustion': {
    Gasoline: 8.78,            // per gallon
    Diesel: 10.21,
    'Jet Fuel': 9.75,
    // UNVERIFIED: 11.171/gal matches no published EPA figure. Hub 2025 lists
    // LNG at 4.50 kg/gal and CNG at 0.05444 kg/scf — this entry does not state
    // which fuel basis it means. Resolve the basis before relying on it.
    'Natural Gas Vehicle': 11.171,
  },
  'Process Emissions': {
    Cement: 507,               // per ton
    Steel: 1850,
    Ammonia: 2550,
  },
  // GWP-100 on an IPCC AR5 basis, matching EPA GHG Emission Factors Hub 2025
  // and eGRID2023 (both AR5) so the whole inventory sits on one GWP basis.
  // Previous values (2088 / 1810) were verbatim AR4 while the site claimed AR6.
  'Fugitive Emissions': {
    'Refrigerant R-410A': 1924, // per kg
    'Refrigerant R-22': 1760,
    // Was 25.3 — roughly the AR4 methane GWP used as if it were a per-MCF
    // factor, ~20x low. 1000 scf x 95% CH4 x 0.0192 kg/scf = 18.3 kg CH4,
    // x GWP 28 (AR5) = 512 kg CO2e/MCF.
    'Natural Gas Leak': 512,   // per MCF
  },
  // eGRID2023 Rev 2 subregion output rates, converted to kg CO2e/kWh. Previous
  // values were ~18-23% high and matched no published eGRID release. New York
  // has no single statewide rate — eGRID publishes three NY subregions, so the
  // two that most users fall into are listed separately rather than averaged.
  'Purchased Electricity': {
    'US Average': 0.3497,      // per kWh (kg CO2e)
    California: 0.19504,       // CAMX
    Texas: 0.33412,            // ERCT
    'New York (Upstate)': 0.11013,        // NYUP
    'New York City / Westchester': 0.39268, // NYCW
    Renewable: 0,
  },
  'Purchased Heat / Steam': {
    Steam: 0.066,              // per lb
    'Hot Water': 0.052,
  },
  'Purchased Goods': {
    Paper: 0.94,               // per kg
    Plastic: 2.0,
    'Steel Product': 1.35,
    Aluminum: 11.2,
    Concrete: 0.107,
  },
  'Business Travel': {
    'Air Short Haul': 0.255,   // per passenger mile
    'Air Long Haul': 0.195,
    Hotel: 20.6,               // per room night
    'Rental Car': 0.404,       // per mile
  },
  'Employee Commuting': {
    'Car Alone': 0.404,        // per mile
    'Car Pool': 0.202,
    'Public Transit': 0.164,
    Remote: 0,
  },
  Waste: {
    Landfill: 0.586,           // per kg
    Recycling: 0.02,
    Composting: 0.01,
  },
  Transportation: {
    'Heavy Duty Diesel': 1.018, // per mile
    'Medium Duty Gasoline': 0.65,
    'Light Duty Gasoline': 0.404,
    Rail: 0.021,
  },
};

export const CATEGORY_SOURCES: Record<string, string[]> = {
  'Stationary Combustion': ['Natural Gas', 'Propane', 'Diesel', 'Fuel Oil', 'Coal'],
  'Mobile Combustion': ['Gasoline', 'Diesel', 'Jet Fuel', 'Natural Gas Vehicle'],
  'Process Emissions': ['Cement', 'Steel', 'Ammonia'],
  'Fugitive Emissions': ['Refrigerant R-410A', 'Refrigerant R-22', 'Natural Gas Leak'],
  'Purchased Electricity': ['US Average', 'California', 'Texas', 'New York (Upstate)', 'New York City / Westchester', 'Renewable'],
  'Purchased Heat / Steam': ['Steam', 'Hot Water'],
  'Purchased Goods': ['Paper', 'Plastic', 'Steel Product', 'Aluminum', 'Concrete'],
  'Business Travel': ['Air Short Haul', 'Air Long Haul', 'Hotel', 'Rental Car'],
  'Employee Commuting': ['Car Alone', 'Car Pool', 'Public Transit', 'Remote'],
  Waste: ['Landfill', 'Recycling', 'Composting'],
  Transportation: ['Heavy Duty Diesel', 'Medium Duty Gasoline', 'Light Duty Gasoline', 'Rail'],
};

export function calculateEmissions(category: string, source: string, amount: number): number {
  const factors = EMISSION_FACTORS[category];
  if (!factors) return 0;
  const factor = factors[source];
  if (factor === undefined) return 0;
  return amount * factor;
}

export function getSourcesForCategory(category: string): string[] {
  return CATEGORY_SOURCES[category] ?? [];
}

export interface EmissionEntry {
  id: number;
  scope: string;
  category: string;
  source: string;
  amount: string;
  unit: string;
  factor: string;
  method: string | null;
  confidence: number;
  facility_id: number | null;
  created_at: string;
}

export interface Company {
  id: number;
  name: string;
  industry: string;
  [key: string]: unknown;
}

export interface Facility {
  id: number;
  name: string;
  company_id: number;
  [key: string]: unknown;
}

export function formatCO2e(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${kg.toFixed(1)} kg`;
}
