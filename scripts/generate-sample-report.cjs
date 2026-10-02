#!/usr/bin/env node
'use strict';

// Regenerates the public sample report and its fixture from the ONE ledger
// declared below:
//
//   node scripts/generate-sample-report.cjs
//
// writes public/sample-report/*.{csv,pdf} and src/lib/reports/sample-report-fixture.json.
//
// Nothing published is typed by hand. Every tCO2e figure, scope total,
// percentage and quality share is computed here, so the page, the CSVs and the
// PDF cannot disagree (F-E-01: the hand-written fixture published 12,847 t for
// rows that sum to about 1,170 t). Only activity quantities (fictional) and
// published-source values (typed with their table reference) are inputs.
//
// How a row is priced:
//   1. by the product's engine (emissions-engine.cjs + emission-factors.json),
//      as a new entry is priced: with the current catalog (catalog_version),
//   2. from the published source it cites (EPA GHG Emission Factors Hub 2025,
//      eGRID2023 Rev 2), computed from the per-gas figures in the source table.
// The engine's factor is published, so the sample is what the product computes.
// It must be within 0.5 % of the source value: if a catalog change breaks that,
// generation fails instead of publishing a number the product would not give.
// (Until catalog 2026-09-30 four Scope 3 rows published the source value
// because the engine's internal estimates were 8-35 % off, F-E-06.)
// Row tCO2e = activity x published factor / 1,000, rounded to 1 kg. Scope totals
// are sums of those rows, so a reader can recompute every number from the CSV.
// tests/sample-report-consistency.test.tsx fails when any published file drifts
// from what this script produces.

const fs = require('node:fs');
const path = require('node:path');
const { calculateEntry, summarizeEntries } = require('../emissions-engine.cjs');
const { CATALOG, CATALOG_VERSION, getSource } = require('../emission-factors.cjs');
const {
  buildReportText,
  createSimplePdf,
  toCsv,
  validateFixture,
} = require('../src/lib/reports/report-generator.cjs');

const ROOT = path.join(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'src', 'lib', 'reports', 'sample-report-fixture.json');
const PUBLIC_DIR = path.join(ROOT, 'public', 'sample-report');

// Pinned so regenerating is byte-for-byte reproducible (it is the PDF's
// "Generated:" line and creation date). Bump it when you regenerate on purpose.
const GENERATED_ON = '2026-09-30';
const ENGINE_TOLERANCE = 0.005;

// EPA GHG Emission Factors Hub 2025, Table 11 (IPCC AR5 GWP-100).
const GWP_AR5 = { CH4: 28, N2O: 265 };
const KG_PER_LB = 0.45359237;
const co2e = (co2Kg, ch4G = 0, n2oG = 0) => co2Kg + (ch4G * GWP_AR5.CH4 + n2oG * GWP_AR5.N2O) / 1000;

// Five published-source records. `validateFixture` pins the register to five
// entries; each entry carries the factors this ledger takes from it. Dates are
// those printed on the source (EPA Hub "Last Modified"; eGRID2023 Revision 2
// release; IPCC AR5 as cited by the Hub; WARM documentation as cited by Hub Table 9).
const EFH_URL = 'https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf';
const DATASETS = [
  { dataset_id: 'epa-efh-2025', source_organization: 'US EPA', dataset_name: 'GHG Emission Factors Hub', dataset_version: '2025',
    publication_date: '2025-01-15', geography: 'USA', status: 'active', source_url: EFH_URL },
  { dataset_id: 'epa-egrid-2023', source_organization: 'US EPA', dataset_name: 'eGRID summary tables', dataset_version: 'eGRID2023 Revision 2',
    publication_date: '2025-06-12', geography: 'USA', status: 'active', source_url: 'https://www.epa.gov/system/files/documents/2025-06/summary_tables_rev2.pdf' },
  { dataset_id: 'ipcc-ar5-gwp100', source_organization: 'IPCC', dataset_name: 'AR5 GWP-100, as tabulated in the EPA GHG Emission Factors Hub 2025 (Tables 11-12)',
    dataset_version: 'AR5', publication_date: '2013', geography: 'Global', status: 'active', source_url: EFH_URL },
  { dataset_id: 'epa-warm-2023', source_organization: 'US EPA', dataset_name: 'Waste Reduction Model (WARM) factors, as published in the EPA GHG Emission Factors Hub 2025 (Table 9)',
    dataset_version: 'WARM documentation, December 2023', publication_date: '2023-12', geography: 'USA', status: 'active', source_url: EFH_URL },
  { dataset_id: 'internal-estimate', source_organization: 'Eco-Auditor', dataset_name: 'Factor library - provisional internal estimates (not a published dataset)',
    dataset_version: CATALOG.version, publication_date: '', geography: '', status: 'provisional', source_url: '' },
];

// Source figures are kg per unit as printed in the cited table; `source` is
// the CO2e value in kg per `per` computed from them (null = no published value).
const FACTORS = {
  'epa-efh-2025:natural-gas': {
    dataset: 'epa-efh-2025', per: 'therm', gas: 'CO2e', gwp: 'AR5', geography: '',
    table: 'Table 1 Stationary Combustion, Natural Gas: 53.06 kg CO2, 1.0 g CH4, 0.10 g N2O per mmBtu; 1 therm = 0.1 mmBtu',
    source: co2e(53.06, 1.0, 0.10) * 0.1,
  },
  'epa-efh-2025:diesel': {
    dataset: 'epa-efh-2025', per: 'gallon', gas: 'CO2', gwp: 'AR5', geography: '',
    table: 'Table 2 Mobile Combustion CO2, Diesel Fuel: 10.21 kg CO2 per gallon',
    source: 10.21,
    note: 'CO2 only. CH4 and N2O for on-road diesel are published per vehicle-mile (Hub Tables 3-5), so they cannot be added from gallons.',
  },
  'ipcc-ar5-gwp100:r-410a': {
    dataset: 'ipcc-ar5-gwp100', per: 'kg', gas: 'HFC-32 + HFC-125 blend', gwp: 'AR5', geography: '',
    table: 'Hub Table 12 Blended Refrigerants, R-410A (50% HFC-32, 50% HFC-125): GWP-100 1,924',
    source: 1924,
    note: 'HFC-32 (677) and HFC-125 (3,170) at 50/50 give 1,923.5; Hub Table 12 publishes 1,924.',
  },
  'epa-efh-2025:propane': {
    dataset: 'epa-efh-2025', per: 'gallon', gas: 'CO2e', gwp: 'AR5', geography: '',
    table: 'Table 1 Stationary Combustion, Propane: 5.72 kg CO2, 0.27 g CH4, 0.05 g N2O per gallon',
    source: co2e(5.72, 0.27, 0.05),
  },
  'epa-egrid-2023:camx': {
    dataset: 'epa-egrid-2023', per: 'kWh', gas: 'CO2e', gwp: 'AR5', geography: 'USA-CAMX',
    table: 'Table 1 Subregion Output Emission Rates, CAMX total output CO2e: 430.0 lb per MWh',
    source: (430.0 * KG_PER_LB) / 1000,
    note: 'Location-based. 430.0 lb/MWh x 0.45359237 kg/lb / 1,000 kWh/MWh.',
  },
  'epa-efh-2025:truck-medium-heavy': {
    dataset: 'epa-efh-2025', per: 'vehicle-mile', gas: 'CO2e', gwp: 'AR5', geography: '',
    table: 'Table 8 Scope 3 Categories 4 and 9, Medium- and Heavy-Duty Truck: 1.298 kg CO2, 0.0115 g CH4, 0.0376 g N2O per vehicle-mile',
    source: co2e(1.298, 0.0115, 0.0376),
    note: 'Vehicle-mile factors apply when the whole vehicle is dedicated to the reporting company\'s freight.',
  },
  'internal-estimate:purchased-goods-spend': {
    dataset: 'internal-estimate', per: 'USD', gas: 'CO2e', gwp: 'AR5', geography: '',
    table: 'Eco-Auditor factor library, purchased goods, spend-based',
    source: null,
    note: 'Provisional: an industry-typical value pending citation verification. Not a published factor; the product flags it the same way.',
  },
  'epa-efh-2025:air-short-haul': {
    dataset: 'epa-efh-2025', per: 'passenger-mile', gas: 'CO2e', gwp: 'AR5', geography: '',
    table: 'Table 10 Scope 3 Categories 6 and 7, Air Travel Short Haul (< 300 miles): 0.207 kg CO2, 0.0064 g CH4, 0.0066 g N2O per passenger-mile',
    source: co2e(0.207, 0.0064, 0.0066),
  },
  'epa-warm-2023:mixed-msw-landfilled': {
    dataset: 'epa-warm-2023', per: 'short ton', gas: 'CO2e', gwp: 'AR4', geography: '',
    table: 'Table 9 Scope 3 Categories 5 and 12, Mixed MSW, landfilled: 0.58 metric tons CO2e per short ton',
    source: 0.58 * 1000,
    note: 'Hub Table 9 converts with AR4 GWPs. Excludes avoided emissions and landfill carbon storage.',
  },
  'epa-efh-2025:passenger-car': {
    dataset: 'epa-efh-2025', per: 'vehicle-mile', gas: 'CO2e', gwp: 'AR5', geography: '',
    table: 'Table 10 Scope 3 Categories 6 and 7, Passenger Car: 0.297 kg CO2, 0.0059 g CH4, 0.0053 g N2O per vehicle-mile',
    source: co2e(0.297, 0.0059, 0.0053),
  },
};

// The fictional company's ledger. `engine` is the same activity expressed the
// way the engine takes it (category / source / unit; `amount` when the unit differs).
const LEDGER = [
  {
    id: 'PFC-2026-S1-001', scope: 'Scope 1', category: 'Stationary combustion', activity: 'Natural gas - boiler A',
    value: 128400, unit: 'therms', factor: 'epa-efh-2025:natural-gas',
    engine: { scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', unit: 'therms' },
    quality: 'L1', band: 'fuel', document: 'utility_bill_pg&e_jan2026.pdf', reviewer: 'm.smith', reviewedAt: '2026-02-18T09:14:00Z',
    evidence: { type: 'primary', documentId: 'UB-2026-001', uploadedBy: 'm.smith', uploadedOn: '2026-02-10', notes: 'Direct meter reading' },
  },
  {
    id: 'PFC-2026-S1-002', scope: 'Scope 1', category: 'Mobile combustion', activity: 'Diesel - fleet',
    value: 9800, unit: 'gallons', factor: 'epa-efh-2025:diesel',
    engine: { scope: 'Scope 1', category: 'mobile_combustion', source: 'diesel', unit: 'gallons' },
    quality: 'L2', band: 'fuel', document: 'fuel_card_feb2026.csv', reviewer: 'm.smith', reviewedAt: '2026-02-18T09:22:00Z',
    evidence: { type: 'primary', documentId: 'FC-2026-002', uploadedBy: 'm.smith', uploadedOn: '2026-02-12', notes: 'Fuel card statement' },
  },
  {
    id: 'PFC-2026-S1-003', scope: 'Scope 1', category: 'Refrigerant', activity: 'Refrigerant R-410A top-up',
    value: 12, unit: 'kg', factor: 'ipcc-ar5-gwp100:r-410a',
    engine: { scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r410a', unit: 'kg' },
    quality: 'L2', band: 'fuel', document: 'hvac_maintenance_log_q1.pdf', reviewer: 'j.patel', reviewedAt: '2026-03-01T11:00:00Z',
    evidence: { type: 'primary', documentId: 'HVAC-2026-Q1', uploadedBy: 'j.patel', uploadedOn: '2026-03-01', notes: 'Service technician record' },
  },
  {
    id: 'PFC-2026-S1-004', scope: 'Scope 1', category: 'Stationary combustion', activity: 'Propane - forklifts',
    value: 1200, unit: 'gallons', factor: 'epa-efh-2025:propane',
    engine: { scope: 'Scope 1', category: 'stationary_combustion', source: 'propane', unit: 'gallons' },
    quality: 'L2', band: 'fuel', document: 'fuel_invoice_propane_q1.csv', reviewer: 'm.smith', reviewedAt: '2026-03-05T14:30:00Z',
    evidence: { type: 'primary', documentId: 'PROP-2026-Q1', uploadedBy: 'm.smith', uploadedOn: '2026-03-05', notes: 'Supplier invoice' },
  },
  {
    id: 'PFC-2026-S2-001', scope: 'Scope 2', category: 'Purchased electricity (location-based)', activity: 'Grid power - Facility A',
    value: 548000, unit: 'kWh', factor: 'epa-egrid-2023:camx',
    engine: { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', unit: 'kWh' },
    quality: 'L2', band: 'electricity', document: 'utility_bill_pg&e_q1.pdf', reviewer: 'm.smith', reviewedAt: '2026-02-18T09:31:00Z',
    evidence: { type: 'primary', documentId: 'UB-2026-Q1A', uploadedBy: 'm.smith', uploadedOn: '2026-02-18', notes: 'Utility meter reading' },
  },
  {
    id: 'PFC-2026-S2-002', scope: 'Scope 2', category: 'Purchased electricity (location-based)', activity: 'Grid power - Facility B',
    value: 4900, unit: 'kWh', factor: 'epa-egrid-2023:camx',
    engine: { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', unit: 'kWh' },
    quality: 'L2', band: 'electricity', document: 'utility_bill_socal_q1.pdf', reviewer: 'm.smith', reviewedAt: '2026-03-05T14:45:00Z',
    evidence: { type: 'primary', documentId: 'UB-2026-Q1B', uploadedBy: 'm.smith', uploadedOn: '2026-03-05', notes: 'Utility meter reading' },
  },
  {
    id: 'PFC-2026-S3-001', scope: 'Scope 3', category: 'Upstream transportation', activity: 'Freight inbound (road, dedicated trucks)',
    value: 165200, unit: 'vehicle-miles', factor: 'epa-efh-2025:truck-medium-heavy',
    engine: { scope: 'Scope 3', category: 'transportation', source: 'truck_medium_heavy', unit: 'vehicle-miles' },
    quality: 'L3', band: 'activity', document: 'carrier_trip_log_q1.csv', reviewer: 'j.patel', reviewedAt: '2026-03-10T10:00:00Z',
    evidence: { type: 'industry_average', documentId: 'TRIP-2026-Q1', uploadedBy: 'j.patel', uploadedOn: '2026-03-10', notes: 'Vehicle-miles from carrier trip reports; industry-average factor' },
  },
  {
    id: 'PFC-2026-S3-002', scope: 'Scope 3', category: 'Purchased goods', activity: 'Paper & packaging (spend)',
    value: 64000, unit: 'USD', factor: 'internal-estimate:purchased-goods-spend',
    engine: { scope: 'Scope 3', category: 'purchased_goods', source: 'purchased_goods', unit: 'USD' },
    quality: 'L3', band: 'spend', document: 'procurement_spend_q1.csv', reviewer: 'j.patel', reviewedAt: '2026-03-10T10:15:00Z',
    evidence: { type: 'industry_average', documentId: 'PROC-2026-Q1', uploadedBy: 'j.patel', uploadedOn: '2026-03-10', notes: 'Spend-based estimate; provisional factor, not a published dataset' },
  },
  {
    id: 'PFC-2026-S3-003', scope: 'Scope 3', category: 'Business travel', activity: 'Air travel (short-haul, 42 segments)',
    value: 42 * 250, unit: 'passenger-miles', factor: 'epa-efh-2025:air-short-haul',
    engine: { scope: 'Scope 3', category: 'business_travel', source: 'air_short_haul', unit: 'passenger-miles' },
    quality: 'L3', band: 'activity', document: 'travel_booking_log_q1.csv', reviewer: 'j.patel', reviewedAt: '2026-03-12T09:00:00Z',
    evidence: { type: 'industry_average', documentId: 'TRAV-2026-Q1', uploadedBy: 'j.patel', uploadedOn: '2026-03-12', notes: '42 segments from the booking log at 250 miles per segment (assumed)' },
  },
  {
    id: 'PFC-2026-S3-004', scope: 'Scope 3', category: 'Waste', activity: 'Landfill waste (mixed MSW)',
    value: 20, unit: 'short tons', factor: 'epa-warm-2023:mixed-msw-landfilled',
    engine: { scope: 'Scope 3', category: 'waste', source: 'landfill', unit: 'short tons' },
    quality: 'L4', band: 'activity', document: 'waste_hauler_q1_summary.pdf', reviewer: 'j.patel', reviewedAt: '2026-03-12T09:30:00Z',
    evidence: { type: 'proxy', documentId: 'WASTE-2026-Q1', uploadedBy: 'j.patel', uploadedOn: '2026-03-12', notes: 'Tonnage provided; factor from EPA waste factors. Improvement target Q3.' },
  },
  {
    id: 'PFC-2026-S3-005', scope: 'Scope 3', category: 'Employee commuting', activity: 'Estimated commute (drive-alone)',
    value: 120 * 204, unit: 'vehicle-miles', factor: 'epa-efh-2025:passenger-car',
    engine: { scope: 'Scope 3', category: 'employee_commuting', source: 'car_alone', unit: 'miles' },
    quality: 'L4', band: 'activity', document: 'commute_survey_2026_estimated.xlsx', reviewer: 'j.patel', reviewedAt: '2026-03-15T12:00:00Z',
    evidence: { type: 'proxy', documentId: 'COMM-2026-Q1', uploadedBy: 'j.patel', uploadedOn: '2026-03-15', notes: '42% of employees responded; remaining estimated by regional average (about 204 drive-alone vehicle-miles per employee-month, 120 employees). Improvement target Q2.' },
  },
];

// Order matters: summarizeQuality() treats the first two as primary data, the
// third as industry-average and the rest as estimates.
const BANDS = [
  { key: 'electricity', label: 'Metered electricity', color: 'bg-brand-500' },
  { key: 'fuel', label: 'Metered fuel and refrigerant', color: 'bg-brand-400' },
  { key: 'activity', label: 'Activity-based Scope 3', color: 'bg-amber-400' },
  { key: 'spend', label: 'Spend-based Scope 3', color: 'bg-orange-400' },
];

const ACTIVITY_COLUMNS = ['entry_id', 'scope', 'category', 'activity', 'activity_value', 'activity_unit', 'emission_factor', 'emission_factor_unit', 'emission_factor_source', 'tCO2e', 'data_quality_level', 'source_document', 'reviewer', 'review_timestamp'];
const REGISTER_COLUMNS = ['factor_id', 'source_organization', 'dataset_name', 'dataset_version', 'publication_date', 'table_reference', 'geography', 'activity_unit', 'factor_value', 'output_unit', 'factor_gas', 'gwp_basis', 'status', 'source_url', 'notes'];
const EVIDENCE_COLUMNS = ['entry_id', 'source_type', 'source_reference', 'document_id', 'uploader', 'upload_date', 'data_quality_level', 'override_reason', 'override_reviewer', 'notes'];

const significant = (value, digits) => Number(value.toPrecision(digits));
const sumOf = (o) => o['Scope 1'] + o['Scope 2'] + o['Scope 3'];

// Splits `total` (in units of 10^-decimals) over `shares` so the parts add up to
// it exactly, giving the leftover units to the largest remainders.
function apportion(shares, decimals) {
  const unit = 10 ** decimals;
  const sum = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((s) => (sum > 0 ? (s / sum) * 100 * unit : 0));
  const floors = exact.map(Math.floor);
  let left = 100 * unit - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((f) => f / unit);
}

// Smallest number of decimals at which the displayed scope values add up to the
// displayed total, so the page never shows arithmetic that visibly disagrees.
function displayDecimalsFor(scopeValues, total) {
  for (let d = 0; d < 3; d++) {
    const shown = scopeValues.reduce((sum, v) => sum + Number(v.toFixed(d)), 0);
    if (Math.abs(shown - Number(total.toFixed(d))) < 0.5 * 10 ** -(d + 1)) return d;
  }
  return 3;
}

function priceRow(spec) {
  const factor = FACTORS[spec.factor];
  if (!factor) throw new Error(spec.id + ': unknown factor ' + spec.factor);
  const engineInput = { ...spec.engine, amount: spec.engine.amount ?? spec.value, catalog_version: CATALOG_VERSION };
  const engineResult = calculateEntry(engineInput);
  const engineKgPerUnit = (engineResult.factor * 1000 * engineInput.amount) / spec.value;
  const engineTonnes = engineResult.co2e_tonnes;
  const sourceKgPerUnit = factor.source;
  const deviation = sourceKgPerUnit === null ? null : engineKgPerUnit / sourceKgPerUnit - 1;
  if (deviation !== null && Math.abs(deviation) > ENGINE_TOLERANCE) {
    throw new Error(spec.id + ': the engine prices ' + engineKgPerUnit + ' kgCO2e/' + factor.per + ', ' +
      (deviation * 100).toFixed(1) + ' % from the cited source. Fix the catalog or the ledger; publish neither.');
  }
  // A published row must cite the dataset the engine itself cites.
  const engineDataset = getSource(spec.engine.category, spec.engine.source).factorSource;
  if (engineDataset !== factor.dataset) {
    throw new Error(spec.id + ': engine cites ' + engineDataset + ' but the ledger cites ' + factor.dataset);
  }
  const published = significant(engineKgPerUnit, 5);
  const kg = Math.round(spec.value * published);
  return {
    spec,
    factor,
    basis: 'engine',
    provisional: engineResult.provenance?.verified === false,
    confidence: engineResult.confidence,
    engineKgPerUnit,
    sourceKgPerUnit,
    deviation,
    engineTonnes,
    sourceTonnes: sourceKgPerUnit === null ? engineTonnes : (spec.value * sourceKgPerUnit) / 1000,
    publishedFactor: published,
    kg,
  };
}

function buildSampleReport() {
  const priced = LEDGER.map(priceRow);

  const kgByScope = { 'Scope 1': 0, 'Scope 2': 0, 'Scope 3': 0 };
  for (const row of priced) kgByScope[row.spec.scope] += row.kg;
  const totalKg = sumOf(kgByScope);
  const tonnes = (kg) => kg / 1000;
  const scopePct = apportion([kgByScope['Scope 1'], kgByScope['Scope 2'], kgByScope['Scope 3']], 1);
  const scopeValues = [tonnes(kgByScope['Scope 1']), tonnes(kgByScope['Scope 2']), tonnes(kgByScope['Scope 3'])];

  const inBand = (band) => priced.filter((r) => r.spec.band === band.key);
  const bandScores = apportion(BANDS.map((band) => inBand(band).reduce((sum, r) => sum + r.kg, 0)), 1);
  const quality = BANDS.map((band, i) => {
    const confidences = inBand(band).map((r) => r.confidence);
    const lo = Math.min(...confidences);
    const hi = Math.max(...confidences);
    return { label: band.label + ' (' + (lo === hi ? lo : lo + '–' + hi) + '%)', score: bandScores[i], color: band.color };
  });

  const activityData = priced.map((r) => ({
    entry_id: r.spec.id, scope: r.spec.scope, category: r.spec.category, activity: r.spec.activity,
    activity_value: r.spec.value, activity_unit: r.spec.unit,
    emission_factor: r.publishedFactor, emission_factor_unit: 'kgCO2e/' + r.factor.per, emission_factor_source: r.spec.factor,
    tCO2e: tonnes(r.kg), data_quality_level: r.spec.quality,
    source_document: r.spec.document, reviewer: r.spec.reviewer, review_timestamp: r.spec.reviewedAt,
  }));

  // One register entry per published source, listing each factor the ledger takes from it.
  const factorRegister = DATASETS.map((dataset) => {
    const firstUse = new Map();
    for (const r of priced) if (r.factor.dataset === dataset.dataset_id && !firstUse.has(r.spec.factor)) firstUse.set(r.spec.factor, r);
    return {
      ...dataset,
      factors: [...firstUse].map(([factorId, r]) => ({
        factor_id: factorId, table_reference: r.factor.table, geography: r.factor.geography || dataset.geography,
        activity_unit: r.factor.per, factor_value: r.publishedFactor, output_unit: 'kgCO2e',
        factor_gas: r.factor.gas, gwp_basis: r.factor.gwp, notes: factorNote(r),
      })),
    };
  });

  const evidenceIndex = priced.map((r) => ({
    entry_id: r.spec.id, source_type: r.spec.evidence.type, source_reference: r.spec.document,
    document_id: r.spec.evidence.documentId, uploader: r.spec.evidence.uploadedBy, upload_date: r.spec.evidence.uploadedOn,
    data_quality_level: r.spec.quality, override_reason: '', override_reviewer: '', notes: r.spec.evidence.notes,
  }));

  const fixture = {
    reportId: 'PFC-2026-FY',
    revision: '1',
    revisionLabel: 'DRAFT — FOR REVIEW',
    fictional: true,
    generatedOn: GENERATED_ON,
    boundary: 'Operational control',
    baseYear: 2025,
    company: { name: 'Pacific Freight Co.', fiscalYear: 2026, currency: 'USD', reportingFramework: 'GHG Protocol' },
    assumptions: [
      'The company, its activity quantities, reviewers and document names are fictional and for illustrative purposes only.',
      'No real customer data is represented in this fixture.',
      'Emission factors are published values from US EPA (GHG Emission Factors Hub 2025, eGRID2023 Revision 2, WARM) and IPCC AR5 GWP-100, listed with their table in the factor register. One Scope 3 spend-based factor is an Eco-Auditor provisional estimate and is flagged as such.',
      'Each ledger row is activity x emission factor / 1,000, rounded to 0.001 tCO2e; scope totals are the sums of the rows.',
      'Quality bands are the share of total emissions in each data-quality band.',
    ],
    metrics: {
      total: tonnes(totalKg),
      unit: 'tCO2e',
      displayDecimals: displayDecimalsFor(scopeValues, tonnes(totalKg)),
      provisionalEntries: priced.filter((r) => r.provisional).length,
      scope1: { value: scopeValues[0], pct: scopePct[0] },
      scope2: { value: scopeValues[1], pct: scopePct[1] },
      scope3: { value: scopeValues[2], pct: scopePct[2] },
    },
    quality,
    activityData,
    factorRegister,
    evidenceIndex,
  };
  validateFixture(fixture);

  // What the product's own PDF builder prints for this ledger. The confidence
  // score comes from the engine and the methodology and disclosure lines from
  // the report builder, so the specimen cannot drift from the product; totals
  // are the published ones.
  const engineSummary = summarizeEntries(
    LEDGER.map((spec) => ({ ...spec.engine, amount: spec.engine.amount ?? spec.value, catalog_version: CATALOG_VERSION })),
  );
  const pdfText = buildReportText(
    {
      company: { name: fixture.company.name },
      generated_at: GENERATED_ON,
      total_emissions_tCO2e: fixture.metrics.total,
      by_scope: { scope1: scopeValues[0], scope2: scopeValues[1], scope3: scopeValues[2] },
      confidence_score: engineSummary.confidence_score,
      entries: priced.map((r) => (r.provisional ? { provenance: { verified: false } } : {})),
    },
    'FY ' + fixture.company.fiscalYear,
  );

  const engineTotals = { 'Scope 1': 0, 'Scope 2': 0, 'Scope 3': 0 };
  const sourceTotals = { 'Scope 1': 0, 'Scope 2': 0, 'Scope 3': 0 };
  for (const r of priced) {
    engineTotals[r.spec.scope] += r.engineTonnes;
    sourceTotals[r.spec.scope] += r.sourceTonnes;
  }

  return { fixture, pdfText, priced, engineTotals, sourceTotals };
}

// Says what the published value is and, for a CO2-only factor, what adding
// CH4 and N2O would give.
function factorNote(row) {
  const parts = [];
  if (row.factor.note) parts.push(row.factor.note);
  if (row.factor.gas === 'CO2' && row.sourceKgPerUnit !== null) {
    const shift = (row.sourceKgPerUnit / row.publishedFactor - 1) * 100;
    if (Math.abs(shift) >= 0.05) {
      parts.push('Adding CH4 and N2O at AR5 gives ' + row.sourceKgPerUnit.toPrecision(4) + ' (' + (shift > 0 ? '+' : '') + shift.toFixed(1) + '%).');
    }
  }
  return parts.join(' ');
}

// File name -> contents. Pure, so a test can compare it with the files on disk.
function renderFiles(built) {
  const { fixture, pdfText } = built;
  const activityRows = fixture.activityData.map((row) => ({ ...row, tCO2e: row.tCO2e.toFixed(3) }));
  const registerRows = fixture.factorRegister.flatMap((dataset) =>
    dataset.factors.map((factor) => ({
      ...factor,
      source_organization: dataset.source_organization,
      dataset_name: dataset.dataset_name,
      dataset_version: dataset.dataset_version,
      publication_date: dataset.publication_date,
      status: dataset.status,
      source_url: dataset.source_url,
    })),
  );
  return {
    'pacific-freight-activity-data.csv': toCsv(activityRows, ACTIVITY_COLUMNS),
    'pacific-freight-factor-register.csv': toCsv(registerRows, REGISTER_COLUMNS),
    'pacific-freight-evidence-index.csv': toCsv(fixture.evidenceIndex, EVIDENCE_COLUMNS),
    'pacific-freight-fy2026.pdf': createSimplePdf(pdfText, {
      title: 'Emissions report - ' + fixture.company.name + ' - FY ' + fixture.company.fiscalYear + ' (sample)',
      author: fixture.company.name,
      creationDate: fixture.generatedOn,
    }),
  };
}

function writeSampleReport(built, options = {}) {
  const publicDir = options.publicDir || PUBLIC_DIR;
  const fixturePath = options.fixturePath || FIXTURE_PATH;
  fs.mkdirSync(publicDir, { recursive: true });
  const written = {};
  for (const [name, contents] of Object.entries(renderFiles(built))) {
    written[name] = path.join(publicDir, name);
    fs.writeFileSync(written[name], contents);
  }
  fs.writeFileSync(fixturePath, JSON.stringify(built.fixture, null, 2) + '\n');
  written.fixture = fixturePath;
  return written;
}

// Per-row and per-scope view of the three bases, so a reviewer sees where the
// engine and the cited source disagree before trusting the published numbers.
function printComparison(built) {
  console.table(built.priced.map((r) => ({
    entry: r.spec.id,
    factor: r.spec.factor,
    published: r.publishedFactor + ' kgCO2e/' + r.factor.per,
    basis: r.basis + (r.provisional ? ' (provisional)' : ''),
    engine_vs_source: r.deviation === null ? 'n/a' : (r.deviation * 100).toFixed(1) + '%',
    engine_t: r.engineTonnes.toFixed(3),
    source_t: r.sourceTonnes.toFixed(3),
    published_t: (r.kg / 1000).toFixed(3),
  })));
  const { scope1, scope2, scope3 } = built.fixture.metrics;
  const published = { 'Scope 1': scope1.value, 'Scope 2': scope2.value, 'Scope 3': scope3.value };
  for (const [name, o] of [['engine', built.engineTotals], ['source', built.sourceTotals], ['published', published]]) {
    console.log(name.padEnd(10) + ['Scope 1', 'Scope 2', 'Scope 3'].map((s) => s + ' ' + o[s].toFixed(3)).join('  ') + '  total ' + sumOf(o).toFixed(3));
  }
}

module.exports = { buildSampleReport, renderFiles, writeSampleReport, LEDGER, ENGINE_TOLERANCE };

if (require.main === module) {
  const built = buildSampleReport();
  const written = writeSampleReport(built);
  printComparison(built);
  console.log('Sample report regenerated:');
  for (const [key, filePath] of Object.entries(written)) console.log('  ' + key + ': ' + filePath);
}
