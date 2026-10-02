// CSV import routes and their transactions (audit K4). server.cjs mounts them:
//
//   POST /api/ingest/csv                 apiAuthGuard, requirePlan('starter')
//        ?dry_run=1                      validate everything, store nothing, spend no quota
//        (no dry_run)                    commit: all rows or none, one import, one quota unit
//        ?on_duplicate=replace           the same file was imported before: undo it and import
//        ?on_duplicate=import_anyway     ... or import it again
//        ?filename=<name>                shown in the import history
//        Idempotency-Key header          a retried commit returns the stored import
//   GET  /api/ingest/imports             apiAuthGuard, requirePlan('starter'): the history
//   POST /api/ingest/imports/:id/undo    apiAuthGuard only: removing your own data stays
//                                        possible after the trial ends (like DELETE /api/entries)
//
// Every statement is scoped by the caller's company from requireCompanyAccess;
// an import id of another tenant answers 404 like one that does not exist.
// Validation is in server-csv-import.cjs, the SQL in server-csv-import-store.cjs.
'use strict';

const { canImportCsv, canUseScope3, planLimits } = require('./server-billing.cjs');
const { classifyApiFailure } = require('./server-security.cjs');
const { readIdempotencyKey, toDateOnly } = require('./server-entries.cjs');
const { isOutage, withRlsBypass } = require('./server-entry-routes.cjs');
const {
  conversionText, duplicateWarning, facilityGoneWarning, overlapWarning, rowFingerprint, validateCsvImport,
} = require('./server-csv-import.cjs');
const { pgStore, rowIdempotencyKey } = require('./server-csv-import-store.cjs');

const DB_ID = /^\d{1,18}$/;
const UNAVAILABLE = { success: false, error: 'Data store temporarily unavailable. Please retry.' };
const ON_DUPLICATE = new Set(['replace', 'import_anyway']);
const SIGNED_OFF =
  'This import falls in a period with a signed-off report. Undoing it will not change that report; generate a new report afterwards.';

function plural(count, one) {
  return count + ' ' + (count === 1 ? one : one + 's');
}

function isoTime(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function presentReport(report) {
  return {
    id: String(report.id),
    title: report.title == null ? null : report.title,
    period: report.period == null ? null : report.period,
    period_start: toDateOnly(report.period_start),
    period_end: toDateOnly(report.period_end),
  };
}

function presentImport(row) {
  const shown = {
    id: String(row.id),
    created_at: isoTime(row.created_at),
    original_filename: row.original_filename || null,
    row_count: Number(row.row_count || 0),
    warning_count: row.warning_count == null ? null : Number(row.warning_count),
    // Imports recorded before the history existed have no status and no linked rows.
    status: row.status || 'legacy',
    undone_at: isoTime(row.undone_at),
  };
  if (row.rows_present != null) shown.rows_present = Number(row.rows_present);
  if (Array.isArray(row.signed_off_reports)) shown.signed_off_reports = row.signed_off_reports.map(presentReport);
  return shown;
}

/**
 * The facilities the file names were read before this transaction (ingest). Lock
 * the ones still there until the commit, so a delete of one waits for the import
 * instead of landing before the rows' foreign key is checked (23503, a 503). The rows
 * of one deleted since are imported without a facility, as for an unknown name.
 */
async function withExistingFacilities(store, companyId, rows) {
  const named = [...new Set(rows.filter((row) => row.entry.facility_id != null).map((row) => String(row.entry.facility_id)))];
  if (!named.length) return { rows, gone: [] };
  const present = new Set((await store.lockFacilities(companyId, named)).map((row) => String(row.id)));
  const gone = [];
  const kept = rows.map((row) => {
    if (row.entry.facility_id == null || present.has(String(row.entry.facility_id))) return row;
    gone.push(row.line);
    const entry = { ...row.entry, facility_id: null };
    return { ...row, entry, fingerprint: rowFingerprint(entry) };
  });
  return { rows: kept, gone };
}

/**
 * One commit, in one transaction after the company row is locked, so concurrent
 * uploads of the same file serialise: the second sees the first's rows (same
 * Idempotency-Key: a replay) or its import (another key: a duplicate). Order:
 * replay, duplicate file, quota, replace, facilities, insert. Only an insert spends quota.
 */
async function runCommit(store, { companyId, plan, report, key, onDuplicate, filename }) {
  await store.lockCompany(companyId);
  if (key) {
    const holders = await store.importsHoldingKeys(companyId, report.rows.map((row) => rowIdempotencyKey(key, row.line)));
    if (holders.length) {
      const only = holders.length === 1 ? holders[0] : null;
      return only && only.id != null && only.file_sha256 === report.fileSha256
        ? { kind: 'replayed', event: only }
        : { kind: 'key_reused' };
    }
  }
  const previous = await store.committedImportsOfFile(companyId, report.fileSha256);
  if (previous.length && !onDuplicate) return { kind: 'duplicate', previous: previous[0] };
  const limit = planLimits(plan).csvImportsPerMonth;
  if (limit !== null && (await store.importsThisMonth(companyId)) >= limit) return { kind: 'quota' };
  const replaced = [];
  if (onDuplicate === 'replace') {
    for (const event of previous) {
      await store.removeImport(companyId, event.id);
      replaced.push(String(event.id));
    }
  }
  const { rows, gone } = await withExistingFacilities(store, companyId, report.rows);
  const overlaps = await store.overlappingLines(companyId, rows);
  const warnings = [...report.warnings];
  if (gone.length) warnings.push(facilityGoneWarning(gone));
  if (previous.length && onDuplicate === 'import_anyway') warnings.unshift(duplicateWarning(previous[0]));
  if (overlaps.length) warnings.push(overlapWarning(overlaps));
  const event = await store.insertImport(companyId, {
    sha: report.fileSha256, rowCount: rows.length, warningCount: warnings.length, filename,
  });
  await store.insertRows(companyId, event, rows, key);
  return { kind: 'committed', event, replaced, warnings };
}

/** Undo: the import's rows go, the import stays listed as undone (and keeps counting toward the month's quota). */
async function runUndo(store, { companyId, importId, confirmSignedOff }) {
  await store.lockCompany(companyId);
  const event = await store.importForUpdate(companyId, importId);
  if (!event) return { status: 404, error: 'Import not found' };
  if (event.status === 'undone') return { status: 409, code: 'already_undone', error: 'This import was already undone.' };
  if (event.status !== 'committed') {
    return {
      status: 409,
      code: 'legacy_import',
      error: 'This import was recorded before import history existed, so its rows are not linked to it and it cannot be undone. Delete its entries in the calculator instead.',
    };
  }
  const reports = await store.signedOffReports(companyId, event.id);
  if (reports.length && !confirmSignedOff) return { status: 409, code: 'signed_off_report', error: SIGNED_OFF, reports };
  const { removed, event: undone } = await store.removeImport(companyId, event.id);
  return { status: 200, removed, event: undone, reports };
}

function readOptions(req) {
  const query = req.query || {};
  const dryRun = ['1', 'true', 'yes'].includes(String(query.dry_run || '').toLowerCase());
  const onDuplicate = query.on_duplicate === undefined || query.on_duplicate === '' ? null : String(query.on_duplicate);
  if (onDuplicate !== null && !ON_DUPLICATE.has(onDuplicate)) return { error: 'on_duplicate must be replace or import_anyway.' };
  const idempotency = dryRun ? { key: null } : readIdempotencyKey(req.headers['idempotency-key']);
  if (idempotency.error) return { error: idempotency.error };
  let filename = null;
  if (typeof query.filename === 'string') {
    // Display only: the last path segment, printable characters, at most 255.
    const base = Array.from(query.filename.split(/[\\/]/).pop()).filter((ch) => ch >= ' ' && ch !== '\u007f').join('').trim();
    filename = base ? base.slice(0, 255) : null;
  }
  return { dryRun, onDuplicate, key: idempotency.key, filename };
}

function quotaRefusal(plan, quota) {
  return {
    success: false,
    code: 'upgrade_required',
    requiredPlan: quota.requiredPlan,
    error: `Your ${plan} plan includes ${quota.limit} CSV imports per month and you have used all of them. Upgrade to ${quota.requiredPlan} for unlimited imports.`,
  };
}

function createCsvImportHandlers({ pool, requireCompanyAccess, loadFacilities, invalidateCompanyCache, log }) {
  const reader = () => pgStore(pool);
  const inTransaction = (work) => withRlsBypass(pool, (client) => work(pgStore(client)));
  const planOf = (req) => (req.billing && req.billing.plan) || 'starter';

  async function importsUsed(companyId) {
    try {
      return await reader().importsThisMonth(companyId);
    } catch (err) {
      // A driver timeout carries no pg error code; name it as the outage it is.
      log('error', 'CSV import quota lookup failed', { error: err, companyId });
      throw new Error('Import quota data store unavailable');
    }
  }

  async function ingest(req, res) {
    // Declared outside the try: the catch logs it (a const inside the block was a
    // ReferenceError there, which exited the process on any 5xx path).
    let companyId = null;
    try {
      companyId = await requireCompanyAccess(req, res, req.query.company_id);
      if (!companyId) return undefined;
      const options = readOptions(req);
      if (options.error) return res.status(400).json({ success: false, error: options.error });
      const plan = planOf(req);

      // Checked before the file is read: a blocked import costs nothing.
      const used = await importsUsed(companyId);
      const quota = canImportCsv(plan, used);
      if (!quota.allowed) return res.status(402).json(quotaRefusal(plan, quota));

      const facilities = await loadFacilities(companyId);
      const report = validateCsvImport(typeof req.body === 'string' ? req.body : '', { facilities, now: new Date() });
      // Scope 3 is a paid tier feature: the whole file is refused rather than
      // imported without its Scope 3 rows, which would understate the inventory.
      const scope3 = canUseScope3(plan);
      if (report.hasScope3 && !scope3.allowed) {
        return res.status(402).json({
          success: false,
          code: 'upgrade_required',
          requiredPlan: scope3.requiredPlan,
          error: `This file contains Scope 3 rows. Scope 3 workflows are included from the ${scope3.requiredPlan} plan up.`,
        });
      }

      const limit = planLimits(plan).csvImportsPerMonth;
      if (options.dryRun) {
        const store = reader();
        const previous = report.rows.length ? (await store.committedImportsOfFile(companyId, report.fileSha256))[0] || null : null;
        const overlaps = report.rows.length ? await store.overlappingLines(companyId, report.rows) : [];
        const warnings = [...report.warnings];
        if (previous) warnings.unshift(duplicateWarning(previous));
        if (overlaps.length) warnings.push(overlapWarning(overlaps));
        return res.json({
          success: true,
          dry_run: true,
          file_sha256: report.fileSha256,
          total_rows: report.totalRows,
          valid_rows: report.rows.length,
          error_count: report.errorCount,
          errors: report.errors,
          warnings,
          conversions: report.conversions.map(conversionText),
          duplicate_of: previous ? presentImport(previous) : null,
          overlapping_rows: overlaps.length,
          tonnes: report.tonnes,
          imports_left: limit === null ? null : Math.max(0, limit - used),
          can_commit: report.errorCount === 0 && report.rows.length > 0,
        });
      }

      // Validate all, then commit (review R2): nothing is stored while any error remains.
      if (report.errorCount) {
        return res.status(422).json({
          success: false,
          code: 'invalid_file',
          error: `This file has ${plural(report.errorCount, 'error')}. Nothing was imported: fix ${report.errorCount === 1 ? 'it' : 'them'} and upload the file again.`,
          errors: report.errors,
          error_count: report.errorCount,
          warnings: report.warnings,
          imported: 0,
          total_rows: report.totalRows,
        });
      }

      let outcome;
      try {
        outcome = await inTransaction((store) => runCommit(store, {
          companyId, plan, report, key: options.key, onDuplicate: options.onDuplicate, filename: options.filename,
        }));
      } catch (err) {
        log('error', 'CSV import commit failed', { error: err, companyId, rows: report.rows.length });
        if (isOutage(err)) return res.status(503).json(UNAVAILABLE);
        return res.status(500).json({ success: false, error: 'The imported rows could not be saved. Nothing was imported. Please retry.' });
      }

      if (outcome.kind === 'key_reused') {
        return res.status(422).json({ success: false, code: 'idempotency_key_reused', error: 'This Idempotency-Key was already used for a different import.' });
      }
      if (outcome.kind === 'duplicate') {
        const on = isoTime(outcome.previous.created_at).slice(0, 10);
        return res.status(409).json({
          success: false,
          code: 'duplicate_file',
          error: `This file was already imported on ${on} (${plural(Number(outcome.previous.row_count), 'row')}). Nothing was imported. ` +
            'Replace that import, or import the file anyway if its rows are new.',
          duplicate_of: presentImport(outcome.previous),
        });
      }
      if (outcome.kind === 'quota') return res.status(402).json(quotaRefusal(plan, canImportCsv(plan, limit)));

      const event = outcome.event;
      const replayed = outcome.kind === 'replayed';
      const warnings = replayed ? [] : outcome.warnings;
      if (!replayed) invalidateCompanyCache(companyId);
      log('info', replayed ? 'CSV import replayed' : 'CSV import committed', {
        companyId, importId: String(event.id), rows: Number(event.row_count), replaced: replayed ? [] : outcome.replaced,
      });
      return res.json({
        success: true,
        replayed,
        import_id: String(event.id),
        imported: Number(event.row_count),
        total_rows: report.totalRows,
        errors: [],
        warnings,
        conversions: replayed ? [] : report.conversions.map(conversionText),
        replaced_imports: replayed ? [] : outcome.replaced,
        import: presentImport(event),
      });
    } catch (err) {
      // A quota-count or store failure is an outage and must not come back as
      // bad input, nor echo driver text (classifyApiFailure splits the two).
      const failure = classifyApiFailure(err);
      if (failure.status >= 500) log('error', 'CSV ingest failed on infrastructure', { error: err, companyId });
      return res.status(failure.status).json({ success: false, error: failure.message });
    }
  }

  async function list(req, res) {
    let companyId = null;
    try {
      companyId = await requireCompanyAccess(req, res, req.query.company_id);
      if (!companyId) return undefined;
      const rows = await reader().listImports(companyId);
      return res.json({ success: true, data: rows.map(presentImport) });
    } catch (err) {
      log('error', 'CSV import history failed', { error: err, companyId });
      if (isOutage(err)) return res.status(503).json(UNAVAILABLE);
      return res.status(500).json({ success: false, error: 'The import history could not be loaded. Please retry.' });
    }
  }

  async function undo(req, res) {
    let companyId = null;
    try {
      companyId = await requireCompanyAccess(req, res, null);
      if (!companyId) return undefined;
      const importId = String(req.params.id || '');
      if (!DB_ID.test(importId)) return res.status(404).json({ success: false, error: 'Import not found' });
      const body = req.body !== null && typeof req.body === 'object' ? req.body : {};
      const outcome = await inTransaction((store) => runUndo(store, { companyId, importId, confirmSignedOff: body.confirm_signed_off === true }));
      if (outcome.status !== 200) {
        const refused = { success: false, error: outcome.error };
        if (outcome.code) refused.code = outcome.code;
        if (outcome.reports) refused.reports = outcome.reports.map(presentReport);
        return res.status(outcome.status).json(refused);
      }
      invalidateCompanyCache(companyId);
      // The event row (status undone, undone_at) is the durable record; this is the operator's.
      log('info', 'CSV import undone', {
        companyId,
        importId,
        userId: req.user && req.user.id,
        removedRows: outcome.removed,
        signedOffReports: outcome.reports.map((report) => String(report.id)),
      });
      return res.json({ success: true, import: presentImport(outcome.event), removed_rows: outcome.removed });
    } catch (err) {
      log('error', 'CSV import undo failed', { error: err, companyId });
      if (isOutage(err)) return res.status(503).json(UNAVAILABLE);
      return res.status(500).json({ success: false, error: 'The import could not be undone. Nothing was changed. Please retry.' });
    }
  }

  return { ingest, list, undo };
}

module.exports = {
  createCsvImportHandlers,
  runCommit,
  runUndo,
};
