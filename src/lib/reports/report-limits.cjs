'use strict';

// Storage bounds for generated reports (K3 follow-up, VERIFY-W2A-DATA F5). A
// report keeps its snapshot and PDF (about 0.9 KB of snapshot per entry), and
// nothing capped how many one company stored. Each bound sits where it can be
// enforced:
//   - generate: GENERATE_LIMIT reports per company per hour, on server.cjs's
//     perRouteRateLimit (429 + Retry-After). A request is counted once a report
//     will be made: after the tenant check, the period check (400) and the
//     empty-period answer (422), so neither another tenant's refused requests nor
//     the company's own refused or empty ones spend its quota;
//   - drafts: MAX_DRAFT_REPORTS unsigned drafts per company. The AFTER INSERT
//     trigger reports_prune_drafts (migrations/20260930110000_report-snapshots.sql)
//     deletes older drafts inside the insert's transaction. Signed-off finals and
//     legacy rows are never deleted;
//   - snapshot size: MAX_SNAPSHOT_ENTRY_LINES stored entry lines
//     (report-snapshot.cjs). Every total and breakdown still counts every entry.

const GENERATE_LIMIT = 20;
const GENERATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_DRAFT_REPORTS = 25; // the LIMIT in reports_prune_drafts
const MAX_SNAPSHOT_ENTRY_LINES = 5000;

/**
 * `perRouteRateLimit(max, windowMs, keyOf)` is server.cjs's fixed-window
 * limiter. allowGenerate(res, companyId) counts one generate for a company the
 * caller is authorized for, and the route calls it right before it takes the
 * report id; it returns false once it has answered 429.
 */
function createReportLimits(perRouteRateLimit) {
  const generateLimit = perRouteRateLimit(GENERATE_LIMIT, GENERATE_WINDOW_MS, (request) => request.key);
  return {
    allowGenerate(res, companyId) {
      let allowed = false;
      generateLimit({ key: 'company:' + companyId }, res, () => { allowed = true; });
      return allowed;
    },
  };
}

module.exports = {
  GENERATE_LIMIT,
  GENERATE_WINDOW_MS,
  MAX_DRAFT_REPORTS,
  MAX_SNAPSHOT_ENTRY_LINES,
  createReportLimits,
};
