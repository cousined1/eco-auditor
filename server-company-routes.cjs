// Route handlers for the company profile, first-run onboarding and facility edits
// (audit K5). server.cjs mounts them with the guards in front:
//
//   GET    /api/company                                  apiAuthGuard, requirePlan('starter')
//   PATCH  /api/companies/:id                            apiAuthGuard, requirePlan('starter')
//   POST   /api/companies/:id/onboarding/skip            apiAuthGuard, requirePlan('starter')
//   PATCH  /api/companies/:id/facilities/:facilityId     apiAuthGuard, requirePlan('starter')
//   DELETE /api/companies/:id/facilities/:facilityId     apiAuthGuard, requirePlan('starter')
//
// (Creating a facility is POST /api/companies/:id/facilities in server.cjs, under the
// plan cap and the company-row lock in server-entry-routes.cjs.)
//
// Ownership. The caller's company comes from requireCompanyAccess, which resolves it
// from the signed-in user on the server. A company id in the path is only compared
// with it: another tenant's id answers 403, like every /api/companies/:id route. A
// facility id is never looked up on its own: every statement is scoped by the
// caller's company_id, so another tenant's facility answers 404, exactly like one
// that does not exist. The server connects with row_security off, so the company_id
// predicate is the only tenant control on these statements.
//
// What may change is an allow-list (server-company.cjs). Plan, billing, trial and
// onboarding-state columns are not in it, and the SET list is built from the
// validated field names, never from the request's keys.
//
// These routes need the database, like every data route: there is no in-memory
// stand-in, so without one they answer 503 and there is one set of rules, not two.
'use strict';

const { planLimits } = require('./server-billing.cjs');
const { withRlsBypass } = require('./server-entry-routes.cjs');
const {
  COMPANY_FIELDS,
  FACILITY_FIELDS,
  facilityInUseMessage,
  presentCompany,
  presentFacility,
  presentOnboarding,
  presentOverview,
  validateCompanyUpdate,
  validateFacilityUpdate,
} = require('./server-company.cjs');

const DB_ID = /^\d{1,18}$/;
const UNAVAILABLE = { success: false, error: 'Data store temporarily unavailable. Please retry.' };
const COMPANY_COLUMN_LIST = [
  'id', 'name', 'industry', 'consolidation_approach', 'base_year', 'auto_provisioned',
  'onboarding_completed_at', 'onboarding_skipped_at', 'created_at', 'updated_at',
];
const COMPANY_COLUMNS = COMPANY_COLUMN_LIST.join(', ');
// One statement for the company and what the checklist is derived from.
const OVERVIEW_SQL = `SELECT ${COMPANY_COLUMN_LIST.map((column) => 'c.' + column).join(', ')},
       (SELECT COUNT(*)::int FROM public.facilities f WHERE f.company_id = c.id) AS facility_count,
       EXISTS (SELECT 1 FROM public.emission_entries e WHERE e.company_id = c.id) AS has_entries,
       EXISTS (SELECT 1 FROM public.reports r WHERE r.company_id = c.id AND r.pdf_sha256 IS NOT NULL) AS has_report
  FROM public.companies c WHERE c.id = $1`;
const FACILITY_COLUMNS = 'id, company_id, name, type, city';

function planOf(req) {
  return (req.billing && req.billing.plan) || 'starter';
}

function facilityLimitOf(plan) {
  const limit = planLimits(plan).facilities;
  return limit === null || limit === undefined ? null : limit;
}

function createCompanyHandlers({ pool, requireCompanyAccess, log }) {
  function failed(res, err, message, companyId) {
    log('error', message, { error: err, companyId: companyId });
    // A driver fault is an outage, never bad input, and its text is not echoed.
    if (err && err.code !== undefined) return res.status(503).json(UNAVAILABLE);
    return res.status(500).json({ success: false, error: 'The change could not be saved. Please retry.' });
  }

  // Resolves the caller's own company for a /api/companies/:id route. `requested`
  // is the id from the path: anything but the caller's own company is a 403.
  async function ownCompany(req, res, requested) {
    return requireCompanyAccess(req, res, requested);
  }

  async function get(req, res) {
    let companyId = null;
    try {
      companyId = await ownCompany(req, res, null);
      if (!companyId) return undefined;
      const [company, facilities] = await Promise.all([
        pool.query(OVERVIEW_SQL, [companyId]),
        pool.query(`SELECT ${FACILITY_COLUMNS} FROM public.facilities WHERE company_id = $1 ORDER BY name ASC, id ASC`, [companyId]),
      ]);
      if (!company.rows.length) return res.status(404).json({ success: false, error: 'Company not found' });
      const plan = planOf(req);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(presentOverview({
        company: company.rows[0],
        facilities: facilities.rows,
        plan: plan,
        limit: facilityLimitOf(plan),
        email: req.user && req.user.email,
      }));
    } catch (err) {
      return failed(res, err, 'Company overview failed', companyId);
    }
  }

  async function update(req, res) {
    let companyId = null;
    try {
      companyId = await ownCompany(req, res, req.params.id);
      if (!companyId) return undefined;
      const checked = validateCompanyUpdate(req.body, new Date());
      if (!checked.ok) return res.status(400).json({ success: false, error: checked.error });

      // Column names come from COMPANY_FIELDS (validateCompanyUpdate builds its
      // result from that list), values are bound parameters.
      const names = Object.keys(checked.fields).filter((field) => COMPANY_FIELDS.includes(field));
      const values = names.map((field) => checked.fields[field]);
      const assignments = names.map((field, i) => field + ' = $' + (i + 2));
      // Saving a company name is what completes onboarding: from then on the
      // company is not the server's placeholder, whichever screen saved it.
      if (names.includes('name')) assignments.push('onboarding_completed_at = COALESCE(onboarding_completed_at, now())');
      assignments.push('updated_at = now()');

      const row = await withRlsBypass(pool, async (client) => {
        const result = await client.query(
          `UPDATE public.companies SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${COMPANY_COLUMNS}`,
          [companyId, ...values]
        );
        return result.rows[0] || null;
      });
      if (!row) return res.status(404).json({ success: false, error: 'Company not found' });
      log('info', 'Company updated', { companyId: companyId, fields: names });
      return res.json({ success: true, data: presentCompany(row), onboarding: presentOnboarding(row) });
    } catch (err) {
      return failed(res, err, 'Company update failed', companyId);
    }
  }

  async function skipOnboarding(req, res) {
    let companyId = null;
    try {
      companyId = await ownCompany(req, res, req.params.id);
      if (!companyId) return undefined;
      const row = await withRlsBypass(pool, async (client) => {
        const result = await client.query(
          `UPDATE public.companies SET onboarding_skipped_at = COALESCE(onboarding_skipped_at, now())
           WHERE id = $1 RETURNING ${COMPANY_COLUMNS}`,
          [companyId]
        );
        return result.rows[0] || null;
      });
      if (!row) return res.status(404).json({ success: false, error: 'Company not found' });
      return res.json({ success: true, onboarding: presentOnboarding(row) });
    } catch (err) {
      return failed(res, err, 'Onboarding skip failed', companyId);
    }
  }

  async function updateFacility(req, res) {
    let companyId = null;
    try {
      companyId = await ownCompany(req, res, req.params.id);
      if (!companyId) return undefined;
      const facilityId = String(req.params.facilityId || '');
      if (!DB_ID.test(facilityId)) return res.status(404).json({ success: false, error: 'Facility not found' });
      const checked = validateFacilityUpdate(req.body);
      if (!checked.ok) return res.status(400).json({ success: false, error: checked.error });

      const names = Object.keys(checked.fields).filter((field) => FACILITY_FIELDS.includes(field));
      const assignments = names.map((field, i) => field + ' = $' + (i + 3));
      const row = await withRlsBypass(pool, async (client) => {
        const result = await client.query(
          `UPDATE public.facilities SET ${assignments.join(', ')} WHERE id = $1 AND company_id = $2 RETURNING ${FACILITY_COLUMNS}`,
          [facilityId, companyId, ...names.map((field) => checked.fields[field])]
        );
        return result.rows[0] || null;
      });
      if (!row) return res.status(404).json({ success: false, error: 'Facility not found' });
      return res.json({ success: true, data: presentFacility(row) });
    } catch (err) {
      return failed(res, err, 'Facility update failed', companyId);
    }
  }

  // A facility that entries still point at is not deleted. Detaching them would
  // change every future facility breakdown without a word, and would bypass the
  // edit trail (changing an entry's facility is an entry edit, recorded in
  // entry_history); deleting them for the customer is not ours to decide. The
  // answer is a 409 with the count, and the customer moves or deletes the entries.
  async function removeFacility(req, res) {
    let companyId = null;
    try {
      companyId = await ownCompany(req, res, req.params.id);
      if (!companyId) return undefined;
      const facilityId = String(req.params.facilityId || '');
      if (!DB_ID.test(facilityId)) return res.status(404).json({ success: false, error: 'Facility not found' });

      const outcome = await withRlsBypass(pool, async (client) => {
        // The row lock makes the count below final: an entry insert that points at
        // this facility needs a key-share lock on it, so it waits for this
        // transaction instead of slipping in between the count and the delete.
        const found = await client.query(
          'SELECT id FROM public.facilities WHERE id = $1 AND company_id = $2 FOR UPDATE',
          [facilityId, companyId]
        );
        if (!found.rows.length) return { status: 404 };
        const used = await client.query(
          'SELECT COUNT(*)::int AS entries FROM public.emission_entries WHERE facility_id = $1 AND company_id = $2',
          [facilityId, companyId]
        );
        const entries = used.rows.length ? used.rows[0].entries : 0;
        if (entries > 0) return { status: 409, entries: entries };
        await client.query('DELETE FROM public.facilities WHERE id = $1 AND company_id = $2', [facilityId, companyId]);
        return { status: 200 };
      });
      if (outcome.status === 404) return res.status(404).json({ success: false, error: 'Facility not found' });
      if (outcome.status === 409) {
        return res.status(409).json({
          success: false,
          code: 'facility_has_entries',
          entry_count: outcome.entries,
          error: facilityInUseMessage(outcome.entries),
        });
      }
      log('info', 'Facility deleted', { companyId: companyId, facilityId: facilityId });
      return res.json({ success: true, deleted: 1 });
    } catch (err) {
      return failed(res, err, 'Facility delete failed', companyId);
    }
  }

  return { get, update, skipOnboarding, updateFacility, removeFacility };
}

module.exports = { createCompanyHandlers };
