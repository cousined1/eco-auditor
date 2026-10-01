'use strict';

// What a generated report covers and what it contains, decided once, at
// generation time (audit AUDIT-RUN-20260929 K3: F-E-03, F-B-04, F-B-05, F-G-20).
//
// The report routes used to store only (company, period) and re-render the PDF
// from live rows on every download, so a signed-off report changed whenever the
// data did, and the UI could only ask for "All time". Now:
//   - parseReportPeriod() accepts a calendar year or an inclusive date range,
//     nothing else, and the default is the year the dashboard shows;
//   - buildReportSnapshot() turns the period's entries into the frozen record
//     the PDF is rendered from and that is stored beside it (reports.snapshot).
// Totals come from the same summarizeEntries() call the dashboard makes over the
// same rows (server.cjs loadEmissionEntries), so the two screens agree.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { calculateEntry, summarizeEntries } = require('../../../emissions-engine.cjs');
const { CATALOG, CATALOG_VERSION, catalogFor } = require('../../../emission-factors.cjs');
const { MAX_SNAPSHOT_ENTRY_LINES } = require('./report-limits.cjs');

// 2 (K7 second step): each row is described by the catalog that priced it, and
// the engine's memo lines, market-based Scope 2, excluded rows and confidence
// method are stored. Schema 1 snapshots stay readable (report-generator.cjs).
const SNAPSHOT_SCHEMA_VERSION = 2;

// ─── Reporting period ───────────────────────────────────────────────────────

const MIN_REPORT_YEAR = 1990;
const MAX_REPORT_YEAR = 2100;
// A custom range exists for fiscal years that do not follow the calendar, so it
// is capped at one year: 53 weeks, the longest year a 52/53-week calendar
// produces. Anything longer mixes years into one total, which is the "All time"
// defect this replaced.
const MAX_PERIOD_DAYS = 371;
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_PATTERN = /^\d{4}$/;
const RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/;
const PERIOD_FORMAT_ERROR = 'period must be a calendar year (e.g. 2025) or a date range (e.g. 2025-04-01/2026-03-31)';

// The reporting year the dashboard opens on (/api/emissions/summary without a
// period). One function, so a report generated without a period covers the
// same year the dashboard shows.
function defaultReportingYear(now) {
  return String((now || new Date()).getFullYear());
}

function calendarYear(year) {
  return {
    type: 'calendar_year',
    value: String(year),
    start: year + '-01-01',
    end: year + '-12-31',
    label: 'Calendar year ' + year,
  };
}

// UTC midnight of a YYYY-MM-DD string, or null unless it is a real calendar day
// (Date.parse accepts 2025-02-30 and rolls it into March).
function utcDay(iso) {
  const time = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) return null;
  return time;
}

function yearInRange(year) {
  return year >= MIN_REPORT_YEAR && year <= MAX_REPORT_YEAR;
}

/**
 * Validates a requested reporting period. Returns { ok: true, period } with
 * period = { type, value, start, end, label } (value is what reports.period
 * stores: 'YYYY' or 'YYYY-MM-DD/YYYY-MM-DD'), or { ok: false, error }.
 */
function parseReportPeriod(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: PERIOD_FORMAT_ERROR };
  const value = String(raw).trim();

  if (YEAR_PATTERN.test(value)) {
    const year = Number(value);
    if (!yearInRange(year)) {
      return { ok: false, error: 'period year must be between ' + MIN_REPORT_YEAR + ' and ' + MAX_REPORT_YEAR };
    }
    return { ok: true, period: calendarYear(year) };
  }

  const range = RANGE_PATTERN.exec(value);
  if (!range) return { ok: false, error: PERIOD_FORMAT_ERROR };
  const start = range[1];
  const end = range[2];
  const startTime = utcDay(start);
  const endTime = utcDay(end);
  if (startTime === null || endTime === null) {
    return { ok: false, error: 'period dates must be real calendar dates (YYYY-MM-DD)' };
  }
  if (!yearInRange(Number(start.slice(0, 4))) || !yearInRange(Number(end.slice(0, 4)))) {
    return { ok: false, error: 'period dates must fall between ' + MIN_REPORT_YEAR + ' and ' + MAX_REPORT_YEAR };
  }
  if (endTime < startTime) return { ok: false, error: 'period ends before it starts' };
  if ((endTime - startTime) / DAY_MS + 1 > MAX_PERIOD_DAYS) {
    return { ok: false, error: 'a date range can cover at most ' + MAX_PERIOD_DAYS + ' days; report longer spans one year at a time' };
  }
  // 2025-01-01/2025-12-31 is calendar year 2025: store and label it that way.
  if (start.slice(0, 4) === end.slice(0, 4) && start.slice(5) === '01-01' && end.slice(5) === '12-31') {
    return { ok: true, period: calendarYear(Number(start.slice(0, 4))) };
  }
  return { ok: true, period: { type: 'custom', value: start + '/' + end, start: start, end: end, label: start + ' to ' + end } };
}

/** { start, end } (inclusive YYYY-MM-DD) for a stored or requested period, or null when it is not one. */
function reportingPeriodBounds(period) {
  if (period && typeof period === 'object' && period.start && period.end) {
    return { start: String(period.start), end: String(period.end) };
  }
  const parsed = parseReportPeriod(period);
  return parsed.ok ? { start: parsed.period.start, end: parsed.period.end } : null;
}

function isoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

/**
 * The date that places an entry in a period: its activity date, else the date
 * it was entered (created_at, UTC). The SQL twin is
 * COALESCE(activity_date, created_at::date) in server.cjs loadEmissionEntries.
 */
function entryPeriodDate(entry) {
  if (!entry) return null;
  if (entry.activity_date instanceof Date && !Number.isNaN(entry.activity_date.getTime())) {
    // node-postgres builds a DATE as local midnight: read it back in local time.
    const d = entry.activity_date;
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }
  return isoDate(entry.activity_date) || isoDate(entry.created_at);
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };
const SCOPE_ORDER = ['Scope 1', 'Scope 2', 'Scope 3'];

// Names for the factorSource ids emission-factors.json cites. The registry
// (src/lib/emission-factors/registry.ts) is TypeScript the server cannot load;
// tests/report-snapshot.test.ts keeps these in step with it and with the catalog.
const DATASET_LABELS = {
  'epa-efh-2025': 'US EPA GHG Emission Factors Hub 2025',
  'epa-egrid-2023': 'US EPA eGRID2023',
  'epa-warm-2023': 'US EPA WARM waste factors (GHG Emission Factors Hub 2025, Table 9)',
  'desnz-2026': 'UK DESNZ GHG conversion factors 2026',
  'ipcc-ar5-gwp100': 'IPCC AR5 GWP-100',
  'internal-estimate': 'Eco-Auditor provisional estimate (not a published dataset)',
};

// Treatments the report must disclose because they depart from the GHG
// Protocol (Corporate Standard ch. 4 and 9, Scope 2 Guidance 7.1). Only a row
// priced with a catalog that lacks the rule gets them: the 2026-07-24 catalog
// keeps wood CO2 and R-22 in Scope 1 and prices a renewable contract at zero.
// The current catalog reports the first two separately and the third in a
// market-based total, which the snapshot takes from the engine instead.
const MEMO_SOURCES = [
  { memo: 'biomass', category: 'stationary_combustion', source: 'wood' },
  { memo: 'non_kyoto', category: 'fugitive_emissions', source: 'refrigerant_r22' },
  { memo: 'zero_rated_electricity', category: 'purchased_electricity', source: 'RENEWABLE' },
];

// SHA-256 of each catalog file the engine prices with, by catalog version: the
// hashes emission-factors.versions.json records (tests/report-catalog-seam.test.ts
// checks they agree). That file is not in the runtime image; the catalogs are.
const CATALOG_SHA256_BY_VERSION = new Map(['emission-factors.json', 'emission-factors.v1.json'].map((file) => {
  const bytes = fs.readFileSync(path.join(__dirname, '..', '..', '..', file));
  return [JSON.parse(bytes.toString('utf8')).version, crypto.createHash('sha256').update(bytes).digest('hex')];
}));
const CATALOG_SHA256 = CATALOG_SHA256_BY_VERSION.get(CATALOG.version);

// The engine's rule (emissions-engine.cjs aggregateConfidence): weighted by
// emissions once any row's catalog asks for it and there is weight to use.
function confidenceMethod(calculated) {
  const asks = calculated.some((row) => catalogFor(row.pricing_catalog).catalog.confidenceWeighting === 'emissions');
  const weight = calculated.some((row) => /^scope[123]$/.test(row.reporting_bucket) && row.co2e_tonnes > 0);
  return asks && weight ? 'emissions_weighted' : 'unweighted';
}

// A catalog that states a market-based share reports Scope 2 twice.
function reportsMarketBased(lookup) {
  return lookup.catalog.categories.some((category) => category.marketBasedShare !== undefined);
}

// Same rounding as the engine's summarizeEntries, so sub-totals add up the same way.
function round6(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

const CO2E_UNITS = new Set(['kg_co2e', 'kgco2e', 't_co2e', 'tco2e', 'tonnes_co2e', 'tonne_co2e']);

function datasetLabel(id) {
  if (!id) return 'source not recorded';
  return DATASET_LABELS[id] || id + ' (unregistered source)';
}

// Per-row factor pinning (factor_value / factor_source / catalog_version on
// emission_entries) is being added separately. Use it when the row carries it.
function pinnedProvenance(entry) {
  const pinned = {};
  if (entry.factor_value != null && Number.isFinite(Number(entry.factor_value))) pinned.factor_value = Number(entry.factor_value);
  if (typeof entry.factor_source === 'string' && entry.factor_source.trim()) pinned.factor_source = entry.factor_source.trim();
  if (entry.catalog_version != null && String(entry.catalog_version).trim()) pinned.catalog_version = String(entry.catalog_version).trim();
  return pinned;
}

function byLabel(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The consolidation approaches a company can choose (companies.consolidation_approach).
// 'unspecified' is what it has until it chooses, and reads as "not specified".
const CONSOLIDATION_APPROACHES = new Set(['operational_control', 'financial_control', 'equity_share']);

function consolidationApproachOf(company) {
  const value = company && company.consolidation_approach;
  return CONSOLIDATION_APPROACHES.has(value) ? value : null;
}

function baseYearOf(company) {
  const year = company && company.base_year;
  return Number.isInteger(year) ? year : null;
}

/**
 * The frozen record of one report. Pure: the same inputs give the same
 * snapshot, and nothing here reads the clock (generatedAt is passed in).
 *   company     { id, name, consolidation_approach, base_year }
 *   period      a parseReportPeriod() period
 *   entries     the period's rows, as server.cjs loadEmissionEntries returns them
 *   facilities  the company's facilities ({ id, name })
 *   generatedBy the auth user id that asked for it
 */
function buildReportSnapshot({ company, period, entries, facilities, generatedAt, generatedBy }) {
  const rows = Array.isArray(entries) ? entries : [];
  const summary = summarizeEntries(rows, { companyId: company && company.id, period: period.value });
  const facilityNames = new Map((facilities || []).map((f) => [String(f.id), String(f.name)]));

  const lines = [];
  const excluded = [];
  const byFacility = new Map();
  const byCategory = new Map();
  const factors = new Map();
  const datasets = new Map();
  const scopes = new Set();
  const scope3Categories = new Map();
  const memos = { biomass: 0, non_kyoto: 0, zero_rated_electricity: 0 };
  const memoEntries = { biogenic_co2: 0, non_kyoto: 0 };
  const catalogs = new Map();
  let marketBased = false;

  for (const entry of rows) {
    const date = entryPeriodDate(entry);
    let calc;
    try {
      calc = calculateEntry(entry);
    } catch (err) {
      excluded.push({
        entry_id: entry.id == null ? null : String(entry.id),
        date: date,
        scope: String(entry.scope == null ? '' : entry.scope),
        category: String(entry.category == null ? '' : entry.category),
        source: String(entry.source == null ? '' : entry.source),
        reason: String((err && err.message) || err),
      });
      continue;
    }

    const scope = SCOPE_LABELS[calc.scope];
    // Labels, dataset and identity come from the catalog that priced the row,
    // never from the current one (a legacy row is not relabelled or re-cited).
    const lookup = catalogFor(calc.pricing_catalog);
    const catalogSource = lookup.getSource(entry.category, entry.source);
    const category = lookup.getCategory(calc.normalized_category);
    const pinned = pinnedProvenance(entry);
    const factorSource = pinned.factor_source || (catalogSource ? catalogSource.factorSource : null);
    const inScopes = /^scope[123]$/.test(calc.reporting_bucket);
    const line = {
      entry_id: entry.id == null ? null : String(entry.id),
      date: date,
      scope: scope,
      category: calc.normalized_category,
      category_label: category ? category.label : calc.normalized_category,
      source: catalogSource ? catalogSource.key : String(entry.source == null ? '' : entry.source),
      source_label: catalogSource ? catalogSource.label : String(entry.source == null ? '' : entry.source),
      facility_id: entry.facility_id == null ? null : String(entry.facility_id),
      amount: Number(entry.amount),
      unit: String(entry.unit == null ? '' : entry.unit),
      // What the engine applied, in kg CO2e per activity unit; an entry stored as
      // CO2e (the calculator's rows) passes through at 1 kg per kg.
      kg_co2e_per_unit: round6(calc.factor * 1000),
      precalculated: CO2E_UNITS.has(normalizeKey(entry.unit)),
      factor_source: factorSource,
      catalog_version: lookup.tag,
      // Where the engine reports it: 'scope1'..'scope3', or beside the scopes
      // ('memo:non-kyoto'). tco2e is the row's CO2e either way.
      reporting_bucket: calc.reporting_bucket,
      tco2e: calc.co2e_tonnes,
      confidence: calc.confidence,
    };
    if (calc.biogenic_co2_tonnes !== undefined) line.biogenic_co2_t = calc.biogenic_co2_tonnes;
    if (calc.scope2_market_tonnes !== undefined) line.scope2_market_tco2e = calc.scope2_market_tonnes;
    if (pinned.catalog_version !== undefined && pinned.catalog_version !== lookup.tag) line.pinned_catalog_version = pinned.catalog_version;
    if (pinned.factor_value !== undefined) line.pinned_factor_value = pinned.factor_value;
    if (calc.provenance) line.provenance = calc.provenance;
    lines.push(line);

    const used = catalogs.get(lookup.tag) || { version: lookup.tag, sha256: CATALOG_SHA256_BY_VERSION.get(lookup.version) || null, entries: 0 };
    used.entries += 1;
    catalogs.set(lookup.tag, used);
    if (calc.biogenic_co2_tonnes !== undefined) memoEntries.biogenic_co2 += 1;
    if (calc.reporting_bucket === 'memo:non-kyoto') memoEntries.non_kyoto += 1;
    if (calc.reporting_bucket === 'scope2' && reportsMarketBased(lookup)) marketBased = true;
    // A row the engine reports separately is not in the older treatments.
    const separately = !inScopes || calc.biogenic_co2_tonnes !== undefined;
    for (const rule of MEMO_SOURCES) {
      if (!separately && calc.normalized_category === rule.category && catalogSource && catalogSource.key === rule.source) memos[rule.memo] += 1;
    }
    // Scope and category breakdowns add up to the scope totals: a memo line is
    // not in them (it is in the entry lines, the factor list and the memo totals).
    if (inScopes) {
      scopes.add(scope);
      if (scope === 'Scope 3') scope3Categories.set(line.category, line.category_label);

      const facilityKey = line.facility_id == null ? '' : line.facility_id;
      const facility = byFacility.get(facilityKey) || {
        facility_id: line.facility_id,
        name: line.facility_id == null ? 'No facility assigned' : facilityNames.get(line.facility_id) || 'Facility ' + line.facility_id,
        scope1: 0, scope2: 0, scope3: 0, total: 0, entries: 0,
      };
      facility[calc.scope] = round6(facility[calc.scope] + line.tco2e);
      facility.total = round6(facility.total + line.tco2e);
      facility.entries += 1;
      byFacility.set(facilityKey, facility);

      const categoryKey = scope + '|' + line.category;
      const categoryRow = byCategory.get(categoryKey) || { scope: scope, category: line.category, label: line.category_label, tco2e: 0, entries: 0 };
      categoryRow.tco2e = round6(categoryRow.tco2e + line.tco2e);
      categoryRow.entries += 1;
      byCategory.set(categoryKey, categoryRow);
    }

    const factorKey = [scope, line.category, line.source, line.unit, line.kg_co2e_per_unit, factorSource, line.catalog_version, line.precalculated, line.reporting_bucket].join('|');
    const factorRow = factors.get(factorKey) || {
      scope: scope,
      category: line.category,
      category_label: line.category_label,
      source: line.source,
      source_label: line.source_label,
      unit: line.unit,
      kg_co2e_per_unit: line.kg_co2e_per_unit,
      precalculated: line.precalculated,
      factor_source: factorSource,
      dataset: datasetLabel(factorSource),
      catalog_version: line.catalog_version,
      reporting_bucket: line.reporting_bucket,
      provisional: Boolean(calc.provenance && calc.provenance.verified === false),
      entries: 0,
      tco2e: 0,
    };
    factorRow.entries += 1;
    factorRow.tco2e = round6(factorRow.tco2e + line.tco2e);
    factors.set(factorKey, factorRow);
    if (factorSource) datasets.set(factorSource, { id: factorSource, label: datasetLabel(factorSource) });
  }

  const facilityRows = [...byFacility.values()].sort((a, b) => {
    if ((a.facility_id == null) !== (b.facility_id == null)) return a.facility_id == null ? 1 : -1;
    return byLabel(a.name, b.name) || byLabel(String(a.facility_id), String(b.facility_id));
  });
  const scopeRank = (scope) => SCOPE_ORDER.indexOf(scope);
  const categoryRows = [...byCategory.values()].sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || byLabel(a.label, b.label));
  const factorRows = [...factors.values()].sort((a, b) =>
    scopeRank(a.scope) - scopeRank(b.scope) || byLabel(a.category_label, b.category_label) ||
    byLabel(a.source_label, b.source_label) || byLabel(a.unit, b.unit) || a.kg_co2e_per_unit - b.kg_co2e_per_unit);

  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: generatedAt,
    generated_by: generatedBy == null ? null : String(generatedBy),
    company: { id: company && company.id != null ? String(company.id) : null, name: (company && company.name) || null },
    period: { ...period, basis: 'activity date, else the date the entry was recorded' },
    // The company's reporting basis as it is when the report is generated (Settings >
    // Company). Until the customer sets them the PDF prints "not specified" /
    // "not set", and a report made before they were set keeps saying so.
    consolidation_approach: consolidationApproachOf(company),
    base_year: baseYearOf(company),
    total_emissions_tCO2e: summary.total_emissions_tCO2e,
    by_scope: summary.by_scope,
    // Reported beside the scopes, never in them (engine summary fields). The
    // market-based total exists only when a Scope 2 row's catalog reports one.
    scope2_market_tCO2e: marketBased ? summary.scope2_market_tCO2e : null,
    biogenic_co2_t: summary.biogenic_co2_t,
    non_kyoto_tCO2e: summary.non_kyoto_tCO2e,
    memo_entries: memoEntries,
    confidence_score: summary.confidence_score,
    confidence_method: confidenceMethod(summary.entries),
    entry_count: lines.length,
    excluded_count: excluded.length,
    // The engine's grouping by reason (at most 20 reasons of 20 ids each).
    excluded_rows: summary.excluded_rows,
    scopes_covered: SCOPE_ORDER.filter((scope) => scopes.has(scope)),
    scope3_categories: [...scope3Categories.values()].sort(byLabel),
    by_facility: facilityRows,
    by_category: categoryRows,
    factors: factorRows,
    datasets: [...datasets.values()].sort((a, b) => byLabel(a.label, b.label)),
    // Rows given the older treatments (MEMO_SOURCES), counted as in schema 1.
    memos: memos,
    // The catalog is kg CO2e per unit: there is nothing to split by gas.
    gases: null,
    // The report's identity is the current catalog (CATALOG_VERSION, the same
    // string the entry API stores). `catalogs` lists every catalog that priced
    // a row, once each; a row names its own in entries[].catalog_version.
    catalog: { version: CATALOG_VERSION, sha256: CATALOG_SHA256, gwp_basis: CATALOG.gwpBasis, basis: CATALOG.basis },
    catalogs: [...catalogs.values()].sort((a, b) => (b.version === CATALOG_VERSION) - (a.version === CATALOG_VERSION) || byLabel(b.version, a.version)),
    // Storage bound (report-limits.cjs): the first MAX_SNAPSHOT_ENTRY_LINES lines
    // of each list are stored. The counts, totals and breakdowns above cover all.
    entries: lines.slice(0, MAX_SNAPSHOT_ENTRY_LINES),
    entry_lines_omitted: Math.max(0, lines.length - MAX_SNAPSHOT_ENTRY_LINES),
    excluded_entries: excluded.slice(0, MAX_SNAPSHOT_ENTRY_LINES),
    excluded_lines_omitted: Math.max(0, excluded.length - MAX_SNAPSHOT_ENTRY_LINES),
  };
}

module.exports = {
  MAX_PERIOD_DAYS,
  MIN_REPORT_YEAR,
  MAX_REPORT_YEAR,
  DATASET_LABELS,
  CATALOG_SHA256,
  CATALOG_SHA256_BY_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  defaultReportingYear,
  parseReportPeriod,
  reportingPeriodBounds,
  entryPeriodDate,
  buildReportSnapshot,
};
