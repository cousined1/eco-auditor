// CSV import, validated as a whole before anything is stored (audit K4: F-E-04,
// F-C-06, F-E-13, F-R2-01, F-B-16). Pure functions only; the route, its
// transactions and the import history are in server-csv-import-routes.cjs.
//
// The importer used to stop at the first missing column, abort the whole file on
// one blank or "1,200" amount while a bad unit only dropped its own row, store
// the rest (so fixing the file and uploading it again counted the good rows
// twice), read "0x1F" as 31, refuse therm/ccf/lb/tons/km, and book an undated row
// to the year it was imported without saying so. Here one pass reports every
// header problem and every row problem with its line number, and returns the
// rows priced exactly like a manual entry (server-entries.cjs pinActivity) after
// unit conversion (units.cjs). The caller commits a file only when it has no
// errors; warnings (no date, future date, unknown facility, rows already stored,
// the same file imported before) are shown and never drop a row.
'use strict';

const crypto = require('crypto');
const { calculateEntry, normalizeScope, summarizeEntries, toDashboardSummary } = require('./emissions-engine.cjs');
const { CATALOG, getCategory, getSource } = require('./emission-factors.cjs');
const { CATALOG_VERSION, EARLIEST_ACTIVITY_DATE, NOTES_MAX, TEXT_MAX, pinActivity, toDateOnly } = require('./server-entries.cjs');
const { convertAmount, parseStrictDecimal, resolveUnit, unitHint } = require('./units.cjs');

const REQUIRED_COLUMNS = ['scope', 'category', 'source', 'amount', 'unit'];
const OPTIONAL_COLUMNS = ['date', 'facility_name', 'notes', 'method', 'confidence'];
const KNOWN_COLUMNS = new Set([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };
const CATEGORY_KEYS = CATALOG.categories.map((category) => category.key);
// One row above this is far outside what the product's customers emit in a
// year; it is usually a unit mix-up (kWh typed as MWh, pounds as short tons).
const IMPLAUSIBLE_ROW_TONNES = 100000;
// Error lines listed in a response; the rest are counted.
const ERRORS_LISTED = 100;
const LINES_LISTED = 12;
// The template's example rows say this in their notes (src/lib/csvTemplate.ts).
const TEMPLATE_EXAMPLE = /^example row\b/i;

function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many || one + 's');
}

/** "lines 2, 3 and 9", or "lines 2, 3, ... and 40 more" for a long list. */
function lineList(lines) {
  if (lines.length === 1) return 'line ' + lines[0];
  if (lines.length <= LINES_LISTED) return 'lines ' + lines.slice(0, -1).join(', ') + ' and ' + lines[lines.length - 1];
  return 'lines ' + lines.slice(0, LINES_LISTED).join(', ') + ' and ' + (lines.length - LINES_LISTED) + ' more';
}

/**
 * The file as the duplicate check sees it: no byte-order mark, LF line endings,
 * no trailing blank lines. Saving the same data with CRLF or with a BOM is the
 * same file.
 */
function normalizedFileText(text) {
  return String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

function fileSha256(text) {
  return crypto.createHash('sha256').update(normalizedFileText(text), 'utf8').digest('hex');
}

/**
 * Records with the line each one starts on. Same quoting rules as the engine's
 * parser (quoted fields, "" inside quotes, CRLF/LF/CR); blank lines are skipped.
 * Throws on an unterminated quoted field.
 */
function splitCsvRecords(text) {
  const records = [];
  let values = [];
  let current = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const push = () => {
    values.push(current.trim());
    if (values.some(Boolean)) records.push({ line: start, values });
    values = [];
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      push();
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      start = line;
    } else {
      if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
      current += ch;
    }
  }
  if (quoted) throw new Error('Line ' + start + ': a quoted value is never closed. Check for a missing closing quote (").');
  push();
  return records;
}

/**
 * 'YYYY-MM-DD' for YYYY-MM-DD (a time after it is ignored), YYYY/M/D or M/D/YYYY
 * (the US order spreadsheets write), when it is a real calendar day; else null.
 */
function parseCsvDate(text) {
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.+Z-]*)?$/.exec(text);
  let year, month, day;
  if (match) [, year, month, day] = match;
  else if ((match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) [, year, month, day] = match;
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) [, month, day, year] = match;
  else return null;
  const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const time = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}

/** A source spelled the way the catalog does, or as typed (a Scope 3 vendor name). */
function sourceIdentity(categoryKey, source) {
  const typed = normalizeKey(source);
  const found = getSource(categoryKey, source);
  if (found && [found.key, ...(found.aliases || [])].some((name) => normalizeKey(name) === typed)) return normalizeKey(found.key);
  return typed;
}

/**
 * What makes two rows the same activity for the overlap warning: company-wide
 * scope, category, source, amount, unit, activity date and facility. Stored rows
 * (catalog keys or the display labels older rows kept) and new rows compare
 * alike. It only ever WARNS: two identical deliveries are legitimate (review R2).
 */
function rowFingerprint(row) {
  let scope;
  try {
    scope = normalizeScope(row.scope);
  } catch {
    scope = normalizeKey(row.scope);
  }
  const category = getCategory(row.category);
  const categoryKey = category ? category.key : normalizeKey(row.category);
  return [
    scope,
    normalizeKey(categoryKey),
    sourceIdentity(categoryKey, row.source),
    String(Number(row.amount)),
    normalizeKey(row.unit),
    toDateOnly(row.activity_date) || '',
    row.facility_id == null ? '' : String(row.facility_id),
  ].join('|');
}

/** Lines of `rows` (validated rows) matching a row already stored. */
function overlappingLines(rows, storedRows) {
  const stored = new Set(storedRows.map(rowFingerprint));
  return rows.filter((row) => stored.has(row.fingerprint)).map((row) => row.line);
}

function overlapWarning(lines) {
  return plural(lines.length, 'row') + ' (' + lineList(lines) + ') ' + (lines.length === 1 ? 'matches' : 'match') +
    ' an entry already stored: same scope, category, source, amount, unit, date and facility. Two identical ' +
    'deliveries can be real; if these are the same activity, importing them again counts it twice.';
}

// Rows whose facility was deleted between the file's check and its commit: stored
// without one, like a row that names a facility the company never had.
function facilityGoneWarning(lines) {
  return plural(lines.length, 'row') + ' (' + lineList(lines) + ') ' + (lines.length === 1 ? 'names' : 'name') +
    ' a facility that was deleted while the file was being imported: imported without a facility.';
}

function duplicateWarning(previous) {
  const on = new Date(previous.created_at).toISOString().slice(0, 10);
  return 'This file was already imported on ' + on + ' (' + plural(Number(previous.row_count), 'row') +
    (previous.original_filename ? ', ' + previous.original_filename : '') + '). Importing it again counts every row twice.';
}

/**
 * The engine's own message for a row whose category or source the catalog does
 * not have, when it is specific: it can name the valid categories or where a
 * source moved. Its generic "Unsupported ..." messages name no alternative, so
 * null then, and the caller shows the catalog's list instead.
 */
function engineMessage(scopeLabel, category, source, unit) {
  try {
    calculateEntry({ scope: scopeLabel, category, source, amount: 1, unit, catalog_version: CATALOG_VERSION });
  } catch (err) {
    const text = String((err && err.message) || err).replace(/\.$/, '');
    if (!text.startsWith('Unsupported ')) return text;
  }
  return null;
}

function unknownSourceMessage(category, text) {
  const wanted = normalizeKey(text);
  // The registry's index, not category.sources: renewable_electricity lists
  // purchased_electricity's subregions (sourcesFrom) and has none of its own.
  const sources = [...new Set(category.sourceIndex.values())];
  // "RFC East" or "RFC East (RFCE)" for RFCE: say which code the label belongs to.
  const byLabel = sources.find((source) =>
    normalizeKey(source.label) === wanted || normalizeKey(String(source.label).replace(/\s*\([^)]*\)\s*$/, '')) === wanted);
  return 'source "' + text + '" is not listed for ' + category.key + '.' +
    (byLabel ? ' Did you mean ' + byLabel.key + ' ("' + byLabel.label + '")?' : '') +
    ' Use one of: ' + sources.map((source) => source.key).join(', ') +
    // Where a retired source went, e.g. RENEWABLE -> renewable_electricity.
    (category.sourceHint ? '. ' + String(category.sourceHint).replace(/\.$/, '') : '');
}

/**
 * The valid rows' tonnes as the Dashboard will show them once stored: the same
 * engine functions over the same entries (GET /api/emissions/summary runs
 * summarizeEntries and toDashboardSummary per year; this is every year of the
 * file at once). So every classification the catalog makes (R-22 beside the
 * scopes, wood's biogenic CO2 outside them, a renewable contract at 0
 * market-based) shows in the preview exactly as it will on the Dashboard.
 */
function previewTonnes(entries) {
  const dashboard = toDashboardSummary(summarizeEntries(entries));
  return {
    scope1: dashboard.scope1_co2e_tonnes,
    scope2: dashboard.scope2_co2e_tonnes,
    scope3: dashboard.scope3_co2e_tonnes,
    total: dashboard.total_co2e_tonnes,
    scope2_market: dashboard.scope2_market_co2e_tonnes,
    biogenic_co2: dashboard.biogenic_co2_tonnes,
    non_kyoto: dashboard.non_kyoto_co2e_tonnes,
  };
}

/** Groups repeated warnings so a 500-row file without dates gets one line, not 500. */
function collectWarnings(groups, today) {
  const warnings = [];
  if (groups.undated.length) {
    warnings.push(plural(groups.undated.length, 'row') + ' (' + lineList(groups.undated) + ') ' +
      (groups.undated.length === 1 ? 'has' : 'have') + ' no date: counted in ' + today.slice(0, 4) +
      ', the year of the import. Add a date (for a bill, the end of its period) to count a row in the year the activity happened.');
  }
  if (groups.future.length) {
    warnings.push(plural(groups.future.length, 'row') + ' (' + lineList(groups.future) + ') ' +
      (groups.future.length === 1 ? 'is' : 'are') + ' dated after today (' + today + '). Check the date.');
  }
  for (const [name, lines] of groups.facilities) {
    warnings.push(plural(lines.length, 'row') + ' (' + lineList(lines) + ') ' + (lines.length === 1 ? 'names' : 'name') +
      ' the facility "' + name + '", which does not exist: imported without a facility.');
  }
  if (groups.examples.length) {
    warnings.push(plural(groups.examples.length, 'row') + ' (' + lineList(groups.examples) + ') ' +
      (groups.examples.length === 1
        ? "is one of the template's example rows: replace it with your own data or delete it."
        : "are the template's example rows: replace them with your own data or delete them."));
  }
  for (const [text, lines] of groups.other) warnings.push(lineList(lines).replace(/^l/, 'L') + ': ' + text + '.');
  return warnings;
}

/**
 * Validates a whole CSV file. `facilities` are the company's own (facility_name
 * matches one case-insensitively). Returns:
 *   errors       every problem that stops the import, "Line N: ..." (listed up to 100)
 *   errorCount   all of them
 *   warnings     what the import would do that the user should know
 *   conversions  [{ from, to, ratio, lines }] unit conversions applied
 *   rows         [{ line, fingerprint, entry }] every valid row, priced and pinned
 *   totalRows, fileSha256, hasScope3 (for the plan gate)
 *   tonnes       the valid rows as the Dashboard will count them (previewTonnes): the
 *                scopes and their total, and beside them scope2_market, biogenic_co2
 *                and non_kyoto
 */
function validateCsvImport(text, { facilities = [], now = new Date() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const source = String(text == null ? '' : text).replace(/^﻿/, '');
  const errors = [];
  const report = { fileSha256: fileSha256(source), totalRows: 0, errors: [], errorCount: 0, warnings: [], conversions: [], rows: [], hasScope3: false, tonnes: null };
  const finish = (warnings) => {
    report.errorCount = errors.length;
    report.errors = errors.length > ERRORS_LISTED
      ? [...errors.slice(0, ERRORS_LISTED), '... and ' + (errors.length - ERRORS_LISTED) + ' more errors.']
      : errors;
    report.warnings = warnings;
    report.tonnes = previewTonnes(report.rows.map((row) => row.entry));
    return report;
  };

  const unreadable = source.indexOf('�');
  if (unreadable !== -1) {
    const line = source.slice(0, unreadable).split(/\r\n|\r|\n/).length;
    errors.push('Line ' + line + ': the file is not UTF-8 text (it has characters that cannot be read). Save it as "CSV UTF-8" and upload it again; the Data Intake page also reads Excel\'s Windows-1252 CSV files.');
  }
  let records;
  try {
    records = splitCsvRecords(source);
  } catch (err) {
    errors.push(err.message);
    return finish([]);
  }
  if (records.length === 0) {
    errors.push('The file is empty.');
    return finish([]);
  }

  const header = records[0];
  const columns = header.values.map(normalizeKey);
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  const repeated = [...new Set(columns.filter((column, i) => column && columns.indexOf(column) !== i))];
  const unknown = [...new Set(columns.filter((column) => column && !KNOWN_COLUMNS.has(column)))];
  const headerWarnings = [];
  if (missing.length) {
    errors.push('missing required column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') +
      ' (line ' + header.line + '). The header needs ' + REQUIRED_COLUMNS.join(', ') + '; ' + OPTIONAL_COLUMNS.join(', ') + ' are optional.');
  }
  if (repeated.length) errors.push('Line ' + header.line + ': column ' + repeated.join(', ') + ' appears more than once.');
  if (unknown.length) {
    headerWarnings.push('Line ' + header.line + ': ' + (unknown.length === 1 ? 'column ' : 'columns ') + unknown.join(', ') +
      (unknown.length === 1 ? ' is' : ' are') + ' not used and will be ignored.');
  }
  const data = records.slice(1);
  report.totalRows = data.length;
  if (missing.length || repeated.length) return finish(headerWarnings);
  if (data.length === 0) {
    errors.push('The file has no data rows under the header.');
    return finish(headerWarnings);
  }

  const index = new Map(columns.map((column, i) => [column, i]));
  const groups = { undated: [], future: [], facilities: new Map(), examples: [], other: new Map() };
  const conversions = new Map();
  const addTo = (map, key, line) => map.set(key, [...(map.get(key) || []), line]);

  for (const { line, values } of data) {
    const cell = (column) => (index.has(column) ? String(values[index.get(column)] || '').trim() : '');
    const problems = [];
    if (values.slice(columns.length).some((value) => String(value).trim() !== '')) {
      problems.push('it has ' + values.length + ' values for ' + columns.length + ' columns: put quotes around a value that contains a comma');
    }

    const scopeText = cell('scope');
    let scope = null;
    try {
      scope = normalizeScope(scopeText);
    } catch {
      problems.push(scopeText ? 'scope "' + scopeText + '" must be Scope 1, Scope 2 or Scope 3' : 'scope is blank');
    }
    const categoryText = cell('category');
    const category = categoryText ? getCategory(categoryText) : null;
    const sourceText = cell('source');
    const unitText = cell('unit');
    if (!categoryText) problems.push('category is blank');
    else if (!category) {
      problems.push((scope && engineMessage(SCOPE_LABELS[scope], categoryText, sourceText, unitText)) ||
        'category "' + categoryText + '" is not in the catalog. Use one of: ' + CATEGORY_KEYS.join(', '));
    }
    if (scope === 'scope3' || (category && Number(category.scope) === 3)) report.hasScope3 = true;
    // The catalog decides the scope; a label that disagrees is a mistake, not an override.
    const scopeMatches = Boolean(category && scope && SCOPE_LABELS['scope' + category.scope] === SCOPE_LABELS[scope]);
    if (category && scope && !scopeMatches) {
      problems.push(category.label + ' (' + category.key + ') is a Scope ' + category.scope + ' category, not ' + scopeText);
    }
    const catalogSource = category && sourceText ? getSource(category.key, sourceText) : null;
    if (category && !sourceText) problems.push('source is blank');
    else if (category && !catalogSource) {
      problems.push((scopeMatches && engineMessage(SCOPE_LABELS[scope], category.key, sourceText, unitText)) ||
        unknownSourceMessage(category, sourceText));
    }
    let resolved = null;
    if (catalogSource) {
      const catalogUnits = Object.keys(catalogSource.units);
      resolved = unitText ? resolveUnit(catalogUnits, unitText) : null;
      if (!unitText) problems.push('unit is blank. Use ' + unitHint(catalogUnits));
      else if (!resolved) problems.push('unit "' + unitText + '" cannot be used for ' + category.key + ' ' + catalogSource.key + '. Use ' + unitHint(catalogUnits));
    }
    const amountText = cell('amount');
    const amount = parseStrictDecimal(amountText);
    if (amount.error) problems.push('amount ' + amount.error);

    const dateText = cell('date');
    let activityDate = null;
    if (dateText) {
      activityDate = parseCsvDate(dateText);
      if (!activityDate) problems.push('date "' + dateText + '" is not a date: use YYYY-MM-DD (or M/D/YYYY)');
      else if (activityDate < EARLIEST_ACTIVITY_DATE) problems.push('date ' + activityDate + ' is before ' + EARLIEST_ACTIVITY_DATE);
    }
    let confidence;
    const confidenceText = cell('confidence');
    if (confidenceText) {
      const parsed = parseStrictDecimal(confidenceText);
      if (parsed.error || parsed.value > 100) problems.push('confidence must be between 0 and 100');
      else confidence = parsed.value;
    }
    const method = cell('method');
    if (method.length > TEXT_MAX) problems.push('method is longer than ' + TEXT_MAX + ' characters');
    const notes = cell('notes');
    if (notes.length > NOTES_MAX) problems.push('notes are longer than ' + NOTES_MAX + ' characters');

    // Warnings are collected for every row, so one upload shows everything to fix.
    if (!dateText) groups.undated.push(line);
    else if (activityDate && activityDate > today) groups.future.push(line);
    if (TEMPLATE_EXAMPLE.test(notes)) groups.examples.push(line);
    const facilityName = cell('facility_name');
    let facilityId = null;
    if (facilityName) {
      const facility = facilities.find((f) => String(f.name).trim().toLowerCase() === facilityName.toLowerCase());
      if (facility) facilityId = facility.id;
      else addTo(groups.facilities, facilityName, line);
    }
    if (resolved && resolved.warning) addTo(groups.other, resolved.warning, line);

    if (!problems.length) {
      const stored = resolved.converted ? convertAmount(amount.value, resolved.ratio) : amount.value;
      const priced = pinActivity({
        scopeLabel: SCOPE_LABELS[scope],
        category: category.key,
        source: sourceText,
        catalogSource,
        amount: stored,
        unit: resolved.unit,
        activityAmount: amount.value,
        activityUnit: resolved.converted ? unitText : resolved.unit,
        confidence,
        method,
      });
      if (!priced.ok) {
        problems.push(priced.error);
      } else {
        const entry = {
          scope: SCOPE_LABELS[scope],
          category: category.key,
          source: sourceText,
          ...priced.fields,
          activity_date: activityDate,
          facility_id: facilityId,
          notes: notes || null,
        };
        const tonnes = entry.co2e_kg / 1000;
        if (tonnes > IMPLAUSIBLE_ROW_TONNES) {
          addTo(groups.other, 'one row of ' + Math.round(tonnes).toLocaleString('en-US') + ' tCO2e is unusually large: check the amount and the unit', line);
        }
        if (resolved.converted) {
          const key = resolved.from + '|' + resolved.unit;
          const group = conversions.get(key) || { from: resolved.from, to: resolved.unit, ratio: resolved.ratio, lines: [] };
          group.lines.push(line);
          conversions.set(key, group);
        }
        report.rows.push({ line, fingerprint: rowFingerprint(entry), entry });
      }
    }
    for (const problem of problems) errors.push('Line ' + line + ': ' + problem + '.');
  }

  report.conversions = [...conversions.values()];
  return finish([...headerWarnings, ...collectWarnings(groups, today)]);
}

/** "12 rows in ccf converted to MCF (x 0.1): lines 2, 3, ..." for the preview. */
function conversionText(conversion) {
  return plural(conversion.lines.length, 'row') + ' in ' + conversion.from + ' converted to ' + conversion.to +
    ' (x ' + Number(conversion.ratio.toPrecision(6)) + '): ' + lineList(conversion.lines);
}

module.exports = {
  OPTIONAL_COLUMNS,
  REQUIRED_COLUMNS,
  conversionText,
  duplicateWarning,
  facilityGoneWarning,
  fileSha256,
  normalizedFileText,
  overlapWarning,
  overlappingLines,
  parseCsvDate,
  rowFingerprint,
  splitCsvRecords,
  validateCsvImport,
};
