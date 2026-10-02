// Manual emission entries, validated and computed on the server (audit K2:
// F-D-01, F-E-05). Pure functions only; the routes and their transactions are
// in server-entry-routes.cjs.
//
// The calculator used to write emission_entries straight through the records
// API as the browser role, with numbers it computed itself: a row with amount 1
// and co2e_kg 999,999 was stored exactly as sent, every row got confidence 85
// and "EPA emission factor" whatever its category, the activity survived only
// as free text in `factor`, and no row had an activity date. Here the client
// supplies the activity only (scope, category, source, amount, unit, activity
// date, facility, notes); CO2e, the factor, its dataset id, the catalog version,
// the method and the confidence are derived from emission-factors.json through
// emissions-engine.cjs. Anything else a client sends is ignored.
'use strict';

const { calculateEntry, normalizeScope } = require('./emissions-engine.cjs');
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION, catalogFor } = require('./emission-factors.cjs');
const { canUseScope3 } = require('./server-billing.cjs');
const { AMOUNT_MAX, convertAmount, resolveUnit, unitHint } = require('./units.cjs');

// CATALOG_VERSION ('<version>+<content hash>') is defined once, in
// emission-factors.cjs, next to the catalogs it names: the engine resolves a
// stored row's catalog from this string, so the writer and the reader must agree.

const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };
const TEXT_MAX = 100;
const NOTES_MAX = 1000;
// Typos such as 0202-03-01 are caught here; 1990 is the base year of the
// earliest inventories this product could hold, not a reporting rule.
const EARLIEST_ACTIVITY_DATE = '1990-01-01';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ENTRY_LIST_LIMIT = 10_000;
const ENTRY_COLUMNS =
  'id, company_id, facility_id, scope, category, source, amount, unit, factor, method, confidence, co2e_kg, ' +
  'activity_date, notes, activity_amount, activity_unit, factor_value, factor_source, catalog_version, ' +
  'idempotency_key, created_at, updated_at';

function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// node-postgres returns BIGINT ids as strings; the SPA's types (and its facility
// lookups) use numbers. Anything else is returned as it is.
function idValue(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(number) ? number : value;
}

/**
 * 'YYYY-MM-DD' for a DATE column, whatever the server's timezone. node-postgres
 * turns a DATE into a Date at LOCAL midnight, so the local getters give the
 * stored calendar day back; toISOString() would shift it by the UTC offset.
 */
function toDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' +
      String(value.getDate()).padStart(2, '0');
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function parseActivityDate(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'activity_date is required as YYYY-MM-DD: the date the activity happened (for a bill, the end of its period). It decides the reporting year.' };
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { error: 'activity_date is not a calendar date.' };
  }
  // One day of grace: east of UTC a customer's "today" is already tomorrow in UTC.
  const latest = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (value > latest) return { error: 'activity_date cannot be in the future.' };
  if (value < EARLIEST_ACTIVITY_DATE) return { error: 'activity_date must be on or after ' + EARLIEST_ACTIVITY_DATE + '.' };
  return { value };
}

function parseFacilityId(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return { value: String(value) };
  // Digit strings are database ids; any other short token reaches the routes'
  // ownership check (facilityOwned), which refuses it with a 400.
  if (typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value)) return { value };
  return { error: 'facility_id must be one of your facility ids, or null.' };
}

/**
 * The priced part of an entry: its CO2e, the factor applied (kg CO2e per
 * `unit`), the factor's dataset id, the catalog version, the method and the
 * confidence. One computation for a manual entry (validateEntryInput) and a CSV
 * row (server-csv-import.cjs), so both pin the same fields and a later catalog
 * correction restates neither (K2, K4). The caller has resolved the activity
 * against the catalog: `unit` is one of catalogSource's units and `amount` is in
 * it. activityAmount/activityUnit are the quantity as given; they differ from
 * amount/unit only when units.cjs converted it (1000 ccf is stored as 100 MCF).
 * `confidence` and `method` are a CSV row's own values, when it has them.
 * `catalogTag` is the catalog `catalogSource` was taken from (default: the
 * current one). It is passed to the engine as well as pinned: to the engine a
 * row without a catalog_version is a legacy row priced by the frozen catalog, so
 * omitting it would price the row with one catalog and pin another.
 * Returns { ok: true, fields } or { ok: false, error }.
 */
function pinActivity({ scopeLabel, category, source, catalogSource, amount, unit, activityAmount, activityUnit, confidence, method, catalogTag = CATALOG_VERSION }) {
  let calculated;
  try {
    // Without a confidence the engine assigns the category's own score
    // (CONFIDENCE_BY_CATEGORY), not a constant.
    calculated = calculateEntry({ scope: scopeLabel, category, source, amount, unit, confidence, catalog_version: catalogTag });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const factorValue = catalogSource.units[unit];
  const co2eKg = round(calculated.co2e_tonnes * 1000, 3);
  if (!Number.isFinite(co2eKg)) return { ok: false, error: 'amount is too large to calculate.' };
  return {
    ok: true,
    fields: {
      // amount/unit hold the activity the factor applies to, as CSV rows always
      // did; activity_amount and activity_unit say so explicitly, because older
      // calculator rows stored kg CO2e in `amount`.
      amount,
      unit,
      activity_amount: activityAmount,
      activity_unit: activityUnit,
      factor_value: factorValue,
      factor: factorValue + ' kg CO2e/' + unit,
      factor_source: catalogSource.factorSource,
      catalog_version: catalogTag,
      method: method || (unit === 'USD' ? 'spend_based' : 'calculation'),
      confidence: calculated.confidence,
      co2e_kg: co2eKg,
    },
  };
}

/**
 * Validates one manual entry and computes everything stored with it. Pure: the
 * facility's ownership and the plan are checked by the caller. A new entry is
 * priced by the current catalog; `catalogVersion` names another one (an edit
 * that leaves a stored row's activity alone, see validateEntryEdit).
 * Returns { ok: true, row } or { ok: false, error } (a 400 message).
 */
function validateEntryInput(input, now, catalogVersion = CATALOG_VERSION) {
  const catalog = catalogFor(catalogVersion);
  const { getCategory, getSource } = catalog;
  const body = isPlainObject(input) ? input : {};
  let scope;
  try {
    scope = normalizeScope(body.scope);
  } catch {
    return { ok: false, error: 'scope must be Scope 1, Scope 2 or Scope 3.' };
  }
  const categoryText = boundedText(body.category, TEXT_MAX);
  const category = categoryText && getCategory(categoryText);
  if (!category) return { ok: false, error: 'category must be a category from the emission factor catalog.' };
  // The scope comes from the catalog, never from the label alone: relabelling a
  // Scope 3 category as Scope 1 used to be a way past the Scope 3 paywall.
  if (SCOPE_LABELS['scope' + category.scope] !== SCOPE_LABELS[scope]) {
    return { ok: false, error: category.label + ' is a Scope ' + category.scope + ' category.' };
  }
  const source = boundedText(body.source, TEXT_MAX);
  const catalogSource = source && getSource(category.key, source);
  if (!catalogSource) return { ok: false, error: 'source must be a source listed for ' + category.label + '.' };
  const unitText = boundedText(body.unit, TEXT_MAX);
  const catalogUnits = Object.keys(catalogSource.units);
  // A unit the source has no factor for is converted into one it has (units.cjs),
  // exactly as a CSV row is, so the calculator and the importer agree.
  const resolved = unitText && resolveUnit(catalogUnits, unitText);
  if (!resolved) return { ok: false, error: 'unit must be ' + unitHint(catalogUnits) + '.' };
  // A JSON number only: "1,200" or "0x1F" are not coerced into something else.
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount >= AMOUNT_MAX) {
    return { ok: false, error: 'amount must be a number greater than 0.' };
  }
  const activityDate = parseActivityDate(body.activity_date, now);
  if (activityDate.error) return { ok: false, error: activityDate.error };
  const facility = parseFacilityId(body.facility_id);
  if (facility.error) return { ok: false, error: facility.error };
  let notes = null;
  if (body.notes !== undefined && body.notes !== null && body.notes !== '') {
    if (typeof body.notes !== 'string' || body.notes.trim().length > NOTES_MAX) {
      return { ok: false, error: 'notes must be text of at most ' + NOTES_MAX + ' characters.' };
    }
    notes = body.notes.trim() || null;
  }

  // The catalog is passed through: pinActivity prices and pins the row with it, so
  // an edit that keeps a legacy row's activity stays on the frozen catalog.
  const priced = pinActivity({
    scopeLabel: SCOPE_LABELS[scope],
    category: category.key,
    source,
    catalogSource,
    amount: resolved.converted ? convertAmount(amount, resolved.ratio) : amount,
    unit: resolved.unit,
    activityAmount: amount,
    // As given when it was converted ("ccf"); otherwise the catalog's spelling.
    activityUnit: resolved.converted ? unitText : resolved.unit,
    catalogTag: catalog.tag,
  });
  if (!priced.ok) return priced;

  return {
    ok: true,
    row: {
      scope: SCOPE_LABELS[scope],
      category: category.key,
      source,
      ...priced.fields,
      activity_date: activityDate.value,
      facility_id: facility.value,
      notes,
    },
  };
}

/** The Idempotency-Key header, or an error. Absent is allowed (no replay protection). */
function readIdempotencyKey(header) {
  if (header === undefined) return { key: null };
  if (typeof header === 'string' && IDEMPOTENCY_KEY_PATTERN.test(header)) return { key: header };
  return { error: 'Idempotency-Key must be 8 to 128 characters: letters, digits, dot, underscore, colon or hyphen.' };
}

/** Whether a stored row is the result of the same request as `row` (same key, same payload). */
function sameEntryRequest(stored, row) {
  return stored.scope === row.scope &&
    normalizeKey(stored.category) === normalizeKey(row.category) &&
    stored.source === row.source &&
    numberOrNull(stored.activity_amount) === row.activity_amount &&
    stored.activity_unit === row.activity_unit &&
    toDateOnly(stored.activity_date) === row.activity_date &&
    (stored.facility_id == null ? null : String(stored.facility_id)) === row.facility_id &&
    (stored.notes || null) === row.notes;
}

/**
 * An edit that leaves the calculation inputs alone (only the date, facility or
 * notes change) is not a new calculation: keep the factor, dataset, catalog
 * version and CO2e the row was priced with, instead of re-pricing it at today's
 * catalog. Otherwise returns `row` unchanged.
 */
function keepPinnedCalculation(stored, row) {
  const sameInputs = stored.factor_value != null &&
    stored.scope === row.scope &&
    normalizeKey(stored.category) === normalizeKey(row.category) &&
    stored.source === row.source &&
    numberOrNull(stored.activity_amount) === row.activity_amount &&
    stored.activity_unit === row.activity_unit;
  if (!sameInputs) return row;
  return {
    ...row,
    factor_value: numberOrNull(stored.factor_value),
    factor: stored.factor,
    factor_source: stored.factor_source,
    catalog_version: stored.catalog_version,
    method: stored.method,
    confidence: numberOrNull(stored.confidence),
    co2e_kg: numberOrNull(stored.co2e_kg),
  };
}

/** Whether `row` (validated) has the activity `stored` was priced from. CSV and older rows keep it in amount/unit. */
function sameActivity(stored, row) {
  const amount = stored.activity_amount != null ? stored.activity_amount : stored.amount;
  const unit = stored.activity_unit != null ? stored.activity_unit : stored.unit;
  return stored.scope === row.scope &&
    normalizeKey(stored.category) === normalizeKey(row.category) &&
    normalizeKey(stored.source) === normalizeKey(row.source) &&
    numberOrNull(amount) === row.activity_amount &&
    normalizeKey(unit) === normalizeKey(row.activity_unit);
}

/**
 * Validates an edit of a stored row. An edit that leaves the activity alone is
 * not a new calculation: it is checked and priced against the catalog the row
 * was priced with (the frozen 2026-07-24 catalog when the row has no pin), so
 * changing a date or a note neither restates the row at today's catalog nor
 * fails because its source was retired from it. A row stored without a pin
 * gets that one written, with the confidence and method it was stored with.
 * A changed activity is a new calculation at the current catalog.
 * Returns { ok: true, row } or { ok: false, error }.
 */
function validateEntryEdit(stored, input, now) {
  const own = validateEntryInput(input, now, stored.catalog_version == null ? LEGACY_CATALOG_VERSION : stored.catalog_version);
  if (own.ok && sameActivity(stored, own.row)) {
    if (stored.factor_value != null) return { ok: true, row: keepPinnedCalculation(stored, own.row) };
    return {
      ok: true,
      row: {
        ...own.row,
        method: stored.method == null ? own.row.method : stored.method,
        confidence: stored.confidence == null ? own.row.confidence : numberOrNull(stored.confidence),
      },
    };
  }
  const current = validateEntryInput(input, now);
  return current.ok ? { ok: true, row: keepPinnedCalculation(stored, current.row) } : current;
}

/** A stored row as the engine reads it (same mapping as loadEmissionEntries). */
function engineRow(row) {
  return {
    ...row,
    amount: Number(row.amount),
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    factor_value: numberOrNull(row.factor_value),
    activity_date: toDateOnly(row.activity_date),
  };
}

/**
 * A stored row for API responses. co2e_kg is the value the dashboard and the
 * reports count for this row (the engine's), not the column as stored: a row
 * written through the old browser path could carry a co2e_kg that no total
 * uses, and the list must never disagree with the dashboard.
 */
function presentEntry(row) {
  let calculated = null;
  let co2eKg = null;
  let calculationError = null;
  try {
    calculated = calculateEntry(engineRow(row));
    co2eKg = round(calculated.co2e_tonnes * 1000, 3);
  } catch (err) {
    calculationError = String((err && err.message) || err);
  }
  const entry = {
    id: idValue(row.id),
    facility_id: idValue(row.facility_id),
    scope: row.scope,
    category: row.category,
    source: row.source,
    amount: Number(row.amount),
    unit: row.unit,
    factor: row.factor == null ? null : row.factor,
    method: row.method == null ? null : row.method,
    confidence: numberOrNull(row.confidence),
    co2e_kg: co2eKg,
    activity_date: toDateOnly(row.activity_date),
    notes: row.notes == null ? null : row.notes,
    activity_amount: numberOrNull(row.activity_amount),
    activity_unit: row.activity_unit == null ? null : row.activity_unit,
    factor_value: numberOrNull(row.factor_value),
    factor_source: row.factor_source == null ? null : row.factor_source,
    catalog_version: row.catalog_version == null ? null : row.catalog_version,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    // When the entry was last edited (PATCH /api/entries/:id); null = never.
    updated_at: row.updated_at == null ? null : row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
  if (calculated) {
    // Where the dashboard counts this row (a scope, or a line reported beside
    // the scopes) and which catalog priced it: the same engine result as the totals.
    entry.reporting_bucket = calculated.reporting_bucket;
    entry.pricing_catalog = calculated.pricing_catalog;
    if (calculated.biogenic_co2_tonnes !== undefined) entry.biogenic_co2_kg = round(calculated.biogenic_co2_tonnes * 1000, 3);
    if (calculated.scope2_market_tonnes !== undefined) entry.scope2_market_co2e_kg = round(calculated.scope2_market_tonnes * 1000, 3);
  }
  if (calculationError) entry.calculation_error = calculationError;
  return entry;
}

/**
 * What an edit changes, as stored in entry_history: the customer's inputs and what
 * was computed from them. Accepts a stored row or a validated row (both carry these
 * columns), so the same function describes "before" and "after" and lets the route
 * tell an edit that changed nothing from one that did.
 */
function entryHistoryValues(row) {
  return {
    scope: row.scope,
    category: row.category,
    source: row.source,
    amount: numberOrNull(row.amount),
    unit: row.unit,
    activity_amount: numberOrNull(row.activity_amount),
    activity_unit: row.activity_unit == null ? null : row.activity_unit,
    activity_date: toDateOnly(row.activity_date),
    facility_id: idValue(row.facility_id),
    notes: row.notes == null ? null : row.notes,
    co2e_kg: numberOrNull(row.co2e_kg),
    factor_value: numberOrNull(row.factor_value),
    factor_source: row.factor_source == null ? null : row.factor_source,
    catalog_version: row.catalog_version == null ? null : row.catalog_version,
  };
}

/** Whether two rows hold the same history values (an edit that changes nothing is not recorded). */
function sameEntryValues(before, after) {
  return JSON.stringify(entryHistoryValues(before)) === JSON.stringify(entryHistoryValues(after));
}

/** The 402 body for a Scope 3 write on a plan without Scope 3, or null when allowed. */
function scope3Refusal(plan, scopeLabel) {
  if (scopeLabel !== 'Scope 3') return null;
  const check = canUseScope3(plan);
  if (check.allowed) return null;
  return {
    success: false,
    code: 'upgrade_required',
    requiredPlan: check.requiredPlan,
    error: 'Scope 3 workflows are included from the ' + check.requiredPlan + ' plan up.',
  };
}

module.exports = {
  CATALOG_VERSION,
  EARLIEST_ACTIVITY_DATE,
  ENTRY_COLUMNS,
  ENTRY_LIST_LIMIT,
  NOTES_MAX,
  TEXT_MAX,
  engineRow,
  entryHistoryValues,
  idValue,
  keepPinnedCalculation,
  numberOrNull,
  pinActivity,
  presentEntry,
  readIdempotencyKey,
  sameEntryRequest,
  sameEntryValues,
  scope3Refusal,
  toDateOnly,
  validateEntryEdit,
  validateEntryInput,
};
