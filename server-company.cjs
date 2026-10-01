// The company profile, its onboarding state and facility edits, validated and
// presented on the server (audit K5: F-B-03 = F-C-03). Pure functions only; the
// routes and their transactions are in server-company-routes.cjs.
//
// The server invents a company named "<email-prefix> Organization" on the first
// authenticated call (ensureCompanyForUser), so the customer never got to name it
// and there was no route to rename it or to change a facility. What a client may
// change is an allow-list, validated here: the company's name, industry,
// consolidation approach and base year, and a facility's name, type and city.
// Plan, billing, trial and onboarding-state columns are never writable from a
// request body: an unknown field is refused, not ignored, so an attempt is visible.
'use strict';

const { idValue } = require('./server-entries.cjs');

const INDUSTRIES = [
  'Agriculture & Food',
  'Construction',
  'Energy & Utilities',
  'Financial Services',
  'Healthcare',
  'Hospitality',
  'Manufacturing',
  'Retail & Consumer Goods',
  'Technology',
  'Transportation & Logistics',
  'Other',
];

// The GHG Protocol Corporate Standard's three consolidation approaches, plus the
// value a company has until it chooses. The CHECK on companies has the same list.
const CONSOLIDATION_APPROACHES = ['operational_control', 'financial_control', 'equity_share', 'unspecified'];

// The earliest inventories this product could hold; the upper bound is the current
// year and is checked here, because a CHECK constraint cannot read the clock.
const BASE_YEAR_MIN = 1990;

const COMPANY_FIELDS = ['name', 'industry', 'consolidation_approach', 'base_year'];
const FACILITY_FIELDS = ['name', 'type', 'city'];
const FACILITY_TYPE_LIST = ['office', 'factory', 'warehouse'];
// Mirrors the facilities.name cap in the initial schema (char_length BETWEEN 1 AND 200).
const FACILITY_FIELD_MAX = 200;
const COMPANY_NAME_MAX = 200;
const PLACEHOLDER_SUFFIX = ' Organization';
const PLACEHOLDER_FALLBACK = 'My Organization';

/**
 * The name the server gives a company it creates. One function, so the place that
 * invents the placeholder and the code that recognises it cannot drift apart.
 * A Stripe webhook can create the company before anyone has logged in; it has no
 * e-mail, hence the fallback.
 */
function defaultCompanyName(email) {
  const local = typeof email === 'string' ? email.split('@')[0] : '';
  return local ? local + PLACEHOLDER_SUFFIX : PLACEHOLDER_FALLBACK;
}

/** Whether `name` is still a name the server made up for this account. */
function isPlaceholderCompanyName(name, email) {
  return typeof name === 'string' && (name === defaultCompanyName(email) || name === PLACEHOLDER_FALLBACK);
}

/**
 * The onboarding screen is for a company the server created and the customer has
 * neither named nor chosen to finish later. Anything else (a company created any
 * other way, every company that predates the migration but is not an untouched
 * placeholder) goes straight to the app.
 */
function needsOnboarding(row) {
  return row.auto_provisioned === true && !row.onboarding_completed_at && !row.onboarding_skipped_at;
}

/**
 * The first-run checklist, derived from what is stored (never from a flag that
 * stays ticked after the data is gone): the company has a name the customer
 * chose, a facility exists, an entry exists, a report has been generated.
 */
function buildChecklist({ name, email, facilityCount, hasEntries, hasReport }) {
  const steps = {
    company_named: !isPlaceholderCompanyName(name, email),
    facility_added: Number(facilityCount) > 0,
    data_added: Boolean(hasEntries),
    report_generated: Boolean(hasReport),
  };
  return { ...steps, complete: Object.values(steps).every(Boolean) };
}

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function presentCompany(row) {
  return {
    id: idValue(row.id),
    name: row.name,
    industry: row.industry === undefined ? null : row.industry,
    consolidation_approach: row.consolidation_approach || 'unspecified',
    base_year: row.base_year === null || row.base_year === undefined ? null : Number(row.base_year),
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
  };
}

function presentOnboarding(row) {
  return {
    needs_onboarding: needsOnboarding(row),
    auto_provisioned: row.auto_provisioned === true,
    completed_at: isoOrNull(row.onboarding_completed_at),
    skipped_at: isoOrNull(row.onboarding_skipped_at),
  };
}

function presentFacility(row) {
  return {
    id: idValue(row.id),
    company_id: idValue(row.company_id),
    name: row.name,
    type: row.type === undefined ? null : row.type,
    city: row.city === undefined ? null : row.city,
  };
}

/**
 * Everything the SPA needs to decide what to show first, in one response: the
 * profile, whether onboarding is pending, the facilities, the plan's facility cap
 * and the checklist. `plan` is the caller's active plan id (req.billing.plan).
 */
function presentOverview({ company, facilities, plan, limit, email }) {
  return {
    success: true,
    company: presentCompany(company),
    onboarding: presentOnboarding(company),
    facilities: facilities.map(presentFacility),
    plan: { id: plan, facility_limit: limit },
    checklist: buildChecklist({
      name: company.name,
      email: email,
      facilityCount: company.facility_count,
      hasEntries: company.has_entries,
      hasReport: company.has_report,
    }),
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownFields(body, allowed) {
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

function hasField(body, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function trimmedText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

/**
 * Validates a company update. Returns { ok: true, fields } with only the fields
 * the request carried, normalised, keyed by column name in COMPANY_FIELDS order
 * (the route builds its SET list from these keys, never from the request's own),
 * or { ok: false, error } for a 400. `now` bounds the base year.
 */
function validateCompanyUpdate(body, now) {
  if (!isPlainObject(body)) return { ok: false, error: 'Send a JSON object with the fields to change.' };
  const extra = unknownFields(body, COMPANY_FIELDS);
  if (extra.length > 0) {
    return { ok: false, error: 'Unknown field' + (extra.length > 1 ? 's' : '') + ': ' + extra.join(', ') + '. You can change: ' + COMPANY_FIELDS.join(', ') + '.' };
  }
  const fields = {};

  if (hasField(body, 'name')) {
    const name = trimmedText(body.name, COMPANY_NAME_MAX);
    if (!name) return { ok: false, error: 'name is required and must be at most ' + COMPANY_NAME_MAX + ' characters.' };
    fields.name = name;
  }
  if (hasField(body, 'industry')) {
    const industry = body.industry;
    if (industry === null || industry === '') fields.industry = null;
    else if (typeof industry === 'string' && INDUSTRIES.includes(industry)) fields.industry = industry;
    else return { ok: false, error: 'industry must be one of: ' + INDUSTRIES.join(', ') + ', or empty.' };
  }
  if (hasField(body, 'consolidation_approach')) {
    const approach = body.consolidation_approach;
    if (typeof approach !== 'string' || !CONSOLIDATION_APPROACHES.includes(approach)) {
      return { ok: false, error: 'consolidation_approach must be one of: ' + CONSOLIDATION_APPROACHES.join(', ') + '.' };
    }
    fields.consolidation_approach = approach;
  }
  if (hasField(body, 'base_year')) {
    const year = body.base_year;
    const latest = now.getUTCFullYear();
    if (year === null || year === '') {
      fields.base_year = null;
    } else if (typeof year === 'number' && Number.isInteger(year) && year >= BASE_YEAR_MIN && year <= latest) {
      fields.base_year = year;
    } else {
      return { ok: false, error: 'base_year must be a whole year from ' + BASE_YEAR_MIN + ' to ' + latest + ', or empty.' };
    }
  }

  // Keep COMPANY_FIELDS order so the generated statement is stable.
  const ordered = {};
  for (const field of COMPANY_FIELDS) if (hasField(fields, field)) ordered[field] = fields[field];
  if (Object.keys(ordered).length === 0) return { ok: false, error: 'Nothing to change. Send at least one of: ' + COMPANY_FIELDS.join(', ') + '.' };
  return { ok: true, fields: ordered };
}

/**
 * Validates a facility edit (rename, change type or city). Same limits as
 * creating one (POST /api/companies/:id/facilities): non-empty bounded strings
 * and a type from FACILITY_TYPE_LIST. Returns { ok: true, fields } or { ok: false, error }.
 */
function validateFacilityUpdate(body) {
  if (!isPlainObject(body)) return { ok: false, error: 'Send a JSON object with the fields to change.' };
  const extra = unknownFields(body, FACILITY_FIELDS);
  if (extra.length > 0) {
    return { ok: false, error: 'Unknown field' + (extra.length > 1 ? 's' : '') + ': ' + extra.join(', ') + '. You can change: ' + FACILITY_FIELDS.join(', ') + '.' };
  }
  const fields = {};
  if (hasField(body, 'name')) {
    const name = trimmedText(body.name, FACILITY_FIELD_MAX);
    if (!name) return { ok: false, error: 'name is required and must be at most ' + FACILITY_FIELD_MAX + ' characters.' };
    fields.name = name;
  }
  if (hasField(body, 'type')) {
    const type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : '';
    if (!FACILITY_TYPE_LIST.includes(type)) return { ok: false, error: 'type must be one of: ' + FACILITY_TYPE_LIST.join(', ') + '.' };
    fields.type = type;
  }
  if (hasField(body, 'city')) {
    const city = trimmedText(body.city, FACILITY_FIELD_MAX);
    if (!city) return { ok: false, error: 'city is required and must be at most ' + FACILITY_FIELD_MAX + ' characters.' };
    fields.city = city;
  }
  const ordered = {};
  for (const field of FACILITY_FIELDS) if (hasField(fields, field)) ordered[field] = fields[field];
  if (Object.keys(ordered).length === 0) return { ok: false, error: 'Nothing to change. Send at least one of: ' + FACILITY_FIELDS.join(', ') + '.' };
  return { ok: true, fields: ordered };
}

/** The 409 text for deleting a facility that entries still point at. */
function facilityInUseMessage(entryCount) {
  const noun = entryCount === 1 ? 'emission entry' : 'emission entries';
  return 'This facility has ' + entryCount + ' ' + noun + '. Change the facility on ' +
    (entryCount === 1 ? 'that entry' : 'those entries') + ', or delete ' +
    (entryCount === 1 ? 'it' : 'them') + ', before deleting the facility.';
}

module.exports = {
  BASE_YEAR_MIN,
  COMPANY_FIELDS,
  CONSOLIDATION_APPROACHES,
  FACILITY_FIELD_MAX,
  FACILITY_FIELDS,
  FACILITY_TYPE_LIST,
  INDUSTRIES,
  buildChecklist,
  defaultCompanyName,
  facilityInUseMessage,
  isPlaceholderCompanyName,
  needsOnboarding,
  presentCompany,
  presentFacility,
  presentOnboarding,
  presentOverview,
  validateCompanyUpdate,
  validateFacilityUpdate,
};
