// Route handlers and transactions for the server-owned entry and facility writes
// (audit K2). server.cjs mounts them with the guards in front:
//
//   GET    /api/entries       apiAuthGuard, requirePlan('starter')
//   POST   /api/entries       apiAuthGuard, requirePlan('starter')   Scope 3 from Growth
//   PATCH  /api/entries/:id   apiAuthGuard, requirePlan('starter')   Scope 3 from Growth
//   DELETE /api/entries/:id   apiAuthGuard only: deleting your own data stays possible
//                             after the trial ends (owner decision, docs/runbooks/k2-rollout.md)
//
// Every handler resolves the caller's company server-side (requireCompanyAccess)
// and every statement is scoped by it, so an id from another tenant answers 404
// exactly like an id that does not exist. Validation and computation live in
// server-entries.cjs.
'use strict';

const {
  ENTRY_COLUMNS,
  ENTRY_LIST_LIMIT,
  entryHistoryValues,
  idValue,
  numberOrNull,
  presentEntry,
  readIdempotencyKey,
  sameEntryRequest,
  sameEntryValues,
  scope3Refusal,
  toDateOnly,
  validateEntryEdit,
  validateEntryInput,
} = require('./server-entries.cjs');
const { canAddFacility } = require('./server-billing.cjs');

const DB_ID = /^\d{1,18}$/;
const UNAVAILABLE = { success: false, error: 'Data store temporarily unavailable. Please retry.' };
// Outages worth a retry: connection failures (SQLSTATE class 08 and the socket
// errors beneath it), insufficient resources (53), operator intervention (57,
// which includes statement_timeout) and node-postgres's own pool and query
// timeouts. Anything else, a constraint or data error included, is a bug.
const OUTAGE_SQLSTATE = /^(08|53|57)[0-9A-Z]{3}$/;
const SOCKET_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);
const DRIVER_TIMEOUT = /timeout exceeded when trying to connect|Query read timeout|Connection terminated/;
const FACILITY_ERROR = 'facility_id is not one of your facilities.';
const LEGACY_EDIT_ERROR =
  'This entry was saved before activity data was recorded. Send its amount, unit and activity_date to edit it.';
const WRITE_COLUMNS = [
  'facility_id', 'scope', 'category', 'source', 'amount', 'unit', 'factor', 'method', 'confidence', 'co2e_kg',
  'activity_date', 'notes', 'activity_amount', 'activity_unit', 'factor_value', 'factor_source', 'catalog_version',
];
const EDITABLE_FIELDS = ['scope', 'category', 'source', 'amount', 'unit', 'activity_date', 'facility_id', 'notes'];

function isOutage(err) {
  const code = err && typeof err.code === 'string' ? err.code : '';
  return OUTAGE_SQLSTATE.test(code) || SOCKET_ERRORS.has(code) || DRIVER_TIMEOUT.test(String(err && err.message));
}

function planOf(req) {
  return (req.billing && req.billing.plan) || 'starter';
}

function plainBody(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function hasField(body, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

// One transaction with row_security off, the shape of the other server-owned
// writes (reserveCsvImportQuota, ensureCompanyForUser). Callers await it inside
// their own try: a rejected connect() must never escape an Express 4 handler
// (SVR-01), because unhandledRejection exits the process.
async function withRlsBypass(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = off');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already gone; the original error is the useful one.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates a facility only while the company is under its plan's facility cap.
 * The company row is locked FOR UPDATE before the count, so concurrent requests
 * serialise instead of all reading "0 of 1" and all inserting (F-X1-01: six
 * parallel POSTs at cap 1 created six facilities). Same shape as
 * reserveCsvImportQuota. Returns { facility } or { refused: canAddFacility's verdict }.
 */
async function insertFacilityWithinCap(pool, { companyId, plan, name, type, city }) {
  return withRlsBypass(pool, async (client) => {
    const locked = await client.query('SELECT id FROM public.companies WHERE id = $1 FOR UPDATE', [companyId]);
    if (locked.rowCount === 0) throw new Error('Facility company no longer exists');
    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS used FROM public.facilities WHERE company_id = $1',
      [companyId]
    );
    const check = canAddFacility(plan, rows.length ? rows[0].used : 0);
    if (!check.allowed) return { refused: check };
    const inserted = await client.query(
      `INSERT INTO public.facilities (company_id, name, type, city)
       VALUES ($1, $2, $3, $4) RETURNING id, company_id, name, type, city`,
      [companyId, name, type, city]
    );
    return { facility: inserted.rows[0] };
  });
}

// A PATCH body laid over the stored activity, then validated as a whole entry,
// so an edit is computed exactly like a new one. A changed activity is priced at
// the current catalog; an edit of the date, facility or notes keeps the catalog
// and factor the row was priced with (validateEntryEdit). Rows from before the
// entry API have no activity to lay it over.
function checkEdit(stored, body, now) {
  if (stored.activity_amount == null && !['amount', 'unit', 'activity_date'].every((field) => hasField(body, field))) {
    return { status: 400, error: LEGACY_EDIT_ERROR };
  }
  const merged = {
    scope: stored.scope,
    category: stored.category,
    source: stored.source,
    amount: numberOrNull(stored.activity_amount),
    unit: stored.activity_unit,
    activity_date: toDateOnly(stored.activity_date),
    facility_id: idValue(stored.facility_id),
    notes: stored.notes == null ? null : stored.notes,
  };
  for (const field of EDITABLE_FIELDS) {
    if (hasField(body, field)) merged[field] = body[field];
  }
  const checked = validateEntryEdit(stored, merged, now);
  return checked.ok ? { row: checked.row } : { status: 400, error: checked.error };
}

function createEntryHandlers({ pool, requireCompanyAccess, invalidateCompanyCache, log }) {
  function failed(res, err, message, companyId) {
    log('error', message, { error: err, companyId: companyId });
    // Driver text is never echoed. Only an outage says "retry later" (503).
    if (isOutage(err)) return res.status(503).json(UNAVAILABLE);
    return res.status(500).json({ success: false, error: 'The entry could not be saved. Please retry.' });
  }

  // Runs inside the write's transaction, and keeps the facility row locked FOR KEY
  // SHARE until it ends: a facility delete (FOR UPDATE, server-company-routes.cjs)
  // then waits for this write instead of committing between the check and the
  // INSERT/UPDATE, where the foreign key would fail (23503) and the caller would
  // get a 500 for a facility that was simply deleted. A delete that got there
  // first is waited for, and its row is gone: the same 400 as any unknown facility.
  async function facilityOwned(client, companyId, facilityId) {
    if (!DB_ID.test(String(facilityId))) return false;
    const { rows } = await client.query(
      'SELECT 1 FROM public.facilities WHERE id = $1 AND company_id = $2 FOR KEY SHARE',
      [facilityId, companyId]
    );
    return rows.length > 0;
  }

  async function insertEntry(companyId, row, key) {
    return withRlsBypass(pool, async (client) => {
      if (row.facility_id !== null && !(await facilityOwned(client, companyId, row.facility_id))) {
        return { error: FACILITY_ERROR, status: 400 };
      }
      const inserted = await client.query(
        `INSERT INTO public.emission_entries (company_id, idempotency_key, ${WRITE_COLUMNS.join(', ')})
         VALUES ($1, $2, ${WRITE_COLUMNS.map((_, i) => '$' + (i + 3)).join(', ')})
         ON CONFLICT (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING ${ENTRY_COLUMNS}`,
        [companyId, key, ...WRITE_COLUMNS.map((column) => row[column])]
      );
      if (inserted.rows.length) return { created: true, row: inserted.rows[0] };
      // The key was used before (a retry, a double click): answer with that row.
      const existing = await client.query(
        `SELECT ${ENTRY_COLUMNS} FROM public.emission_entries WHERE company_id = $1 AND idempotency_key = $2`,
        [companyId, key]
      );
      if (!existing.rows.length) throw new Error('Idempotent insert found neither a new nor a stored row');
      return sameEntryRequest(existing.rows[0], row)
        ? { created: false, row: existing.rows[0] }
        : { error: 'This Idempotency-Key was already used for a different entry.', status: 422 };
    });
  }

  async function list(req, res) {
    let companyId = null;
    try {
      companyId = await requireCompanyAccess(req, res, req.query.company_id);
      if (!companyId) return undefined;
      const { rows } = await pool.query(
        `SELECT ${ENTRY_COLUMNS} FROM public.emission_entries WHERE company_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2`,
        [companyId, ENTRY_LIST_LIMIT + 1]
      );
      return res.json({
        success: true,
        data: rows.slice(0, ENTRY_LIST_LIMIT).map(presentEntry),
        truncated: rows.length > ENTRY_LIST_LIMIT,
      });
    } catch (err) {
      return failed(res, err, 'Emission entry list failed', companyId);
    }
  }

  async function create(req, res) {
    let companyId = null;
    try {
      const body = plainBody(req.body);
      companyId = await requireCompanyAccess(req, res, body.company_id);
      if (!companyId) return undefined;
      const idempotency = readIdempotencyKey(req.headers['idempotency-key']);
      if (idempotency.error) return res.status(400).json({ success: false, error: idempotency.error });
      const checked = validateEntryInput(body, new Date());
      if (!checked.ok) return res.status(400).json({ success: false, error: checked.error });
      const refusal = scope3Refusal(planOf(req), checked.row.scope);
      if (refusal) return res.status(402).json(refusal);

      const outcome = await insertEntry(companyId, checked.row, idempotency.key);
      if (outcome.error) return res.status(outcome.status).json({ success: false, error: outcome.error });

      if (outcome.created) invalidateCompanyCache(companyId);
      log('info', outcome.created ? 'Emission entry created' : 'Emission entry replayed', {
        companyId: companyId,
        entryId: String(outcome.row.id),
      });
      return res.status(outcome.created ? 201 : 200).json({
        success: true,
        replayed: !outcome.created,
        data: presentEntry(outcome.row),
      });
    } catch (err) {
      return failed(res, err, 'Emission entry create failed', companyId);
    }
  }

  async function update(req, res) {
    let companyId = null;
    try {
      const body = plainBody(req.body);
      companyId = await requireCompanyAccess(req, res, body.company_id);
      if (!companyId) return undefined;
      const entryId = String(req.params.id || '');
      const plan = planOf(req);
      if (!DB_ID.test(entryId)) return res.status(404).json({ success: false, error: 'Entry not found' });
      const outcome = await withRlsBypass(pool, async (client) => {
        const found = await client.query(
          `SELECT ${ENTRY_COLUMNS} FROM public.emission_entries WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [entryId, companyId]
        );
        if (!found.rows.length) return { status: 404, error: 'Entry not found' };
        const edit = checkEdit(found.rows[0], body, new Date());
        if (edit.error) return edit;
        const refusal = scope3Refusal(plan, edit.row.scope);
        if (refusal) return { status: 402, refusal: refusal };
        if (edit.row.facility_id !== null && !(await facilityOwned(client, companyId, edit.row.facility_id))) {
          return { status: 400, error: FACILITY_ERROR };
        }
        // Saving what is already stored is not an edit: no new row in the
        // history, no updated_at, which also keeps a retried PATCH from
        // recording the same change twice.
        if (sameEntryValues(found.rows[0], edit.row)) return { status: 200, row: found.rows[0], unchanged: true };
        const updated = await client.query(
          `UPDATE public.emission_entries SET ${WRITE_COLUMNS.map((column, i) => column + ' = $' + (i + 3)).join(', ')}, updated_at = now()
           WHERE id = $1 AND company_id = $2 RETURNING ${ENTRY_COLUMNS}`,
          [entryId, companyId, ...WRITE_COLUMNS.map((column) => edit.row[column])]
        );
        // Same transaction as the edit: an edit without its history row cannot
        // be stored, and a history row without its edit cannot either.
        await client.query(
          `INSERT INTO public.entry_history (entry_id, company_id, changed_by, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            entryId, companyId, String(req.user.id),
            JSON.stringify(entryHistoryValues(found.rows[0])), JSON.stringify(entryHistoryValues(updated.rows[0])),
          ]
        );
        return { status: 200, row: updated.rows[0] };
      });

      if (outcome.refusal) return res.status(402).json(outcome.refusal);
      if (outcome.error) return res.status(outcome.status).json({ success: false, error: outcome.error });
      if (!outcome.unchanged) invalidateCompanyCache(companyId);
      log('info', outcome.unchanged ? 'Emission entry save changed nothing' : 'Emission entry updated', { companyId: companyId, entryId: entryId });
      return res.json({ success: true, data: presentEntry(outcome.row) });
    } catch (err) {
      return failed(res, err, 'Emission entry update failed', companyId);
    }
  }

  async function remove(req, res) {
    let companyId = null;
    try {
      companyId = await requireCompanyAccess(req, res, null);
      if (!companyId) return undefined;
      const entryId = String(req.params.id || '');
      let deleted = 0;
      if (DB_ID.test(entryId)) {
        const result = await withRlsBypass(pool, (client) => client.query(
          'DELETE FROM public.emission_entries WHERE id = $1 AND company_id = $2',
          [entryId, companyId]
        ));
        deleted = result.rowCount;
      }
      if (!deleted) return res.status(404).json({ success: false, error: 'Entry not found' });
      invalidateCompanyCache(companyId);
      log('info', 'Emission entry deleted', { companyId: companyId, entryId: entryId });
      return res.json({ success: true, deleted: deleted });
    } catch (err) {
      return failed(res, err, 'Emission entry delete failed', companyId);
    }
  }

  return { list, create, update, remove };
}

module.exports = {
  DB_ID,
  createEntryHandlers,
  insertFacilityWithinCap,
  isOutage,
  withRlsBypass,
};
