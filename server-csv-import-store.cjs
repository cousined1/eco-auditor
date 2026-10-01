// Where a CSV import is read and written (audit K4): the SQL of one import
// transaction over a pg client. There is no in-memory twin (F-G-07): without a
// database the import answers 503 like every other data route. The transaction
// logic that drives these statements (lock, replay, duplicate, quota, insert,
// undo) is in server-csv-import-routes.cjs. Every statement is scoped by company_id.
'use strict';

const { overlappingLines } = require('./server-csv-import.cjs');

const IMPORT_COLUMNS = 'id, company_id, created_at, row_count, warning_count, original_filename, status, undone_at, file_sha256';
const ROW_COLUMNS = [
  'company_id', 'import_id', 'facility_id', 'scope', 'category', 'source', 'amount', 'unit', 'factor', 'method',
  'confidence', 'co2e_kg', 'activity_date', 'notes', 'activity_amount', 'activity_unit', 'factor_value',
  'factor_source', 'catalog_version', 'idempotency_key',
];
// 20 columns x 1000 rows = 20,000 bind parameters, below PostgreSQL's 65,535 per statement.
const BATCH_ROWS = 1000;
const HISTORY_LIMIT = 200;

/** The per-row key K2's unique index (company_id, idempotency_key) holds for a committed import. */
function rowIdempotencyKey(key, line) {
  return 'csv:' + key + ':' + line;
}

/** The statements of one import transaction, over a pg client (or the pool for plain reads). */
function pgStore(db) {
  return {
    async lockCompany(companyId) {
      const locked = await db.query('SELECT id FROM public.companies WHERE id = $1 FOR UPDATE', [companyId]);
      if (locked.rowCount === 0) throw new Error('Import company no longer exists');
    },
    async importsThisMonth(companyId) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS used FROM public.csv_import_events
          WHERE company_id = $1 AND created_at >= date_trunc('month', now())`,
        [companyId]
      );
      return rows.length ? rows[0].used : 0;
    },
    // The imports whose rows hold these keys; a key held by a row that no import
    // stored (a manual entry) comes back with a NULL id.
    async importsHoldingKeys(companyId, keys) {
      const { rows } = await db.query(
        `SELECT DISTINCT i.id, i.created_at, i.row_count, i.warning_count, i.original_filename, i.status, i.undone_at, i.file_sha256
           FROM public.emission_entries e
           LEFT JOIN public.csv_import_events i ON i.id = e.import_id AND i.company_id = e.company_id
          WHERE e.company_id = $1 AND e.idempotency_key = ANY($2::text[])`,
        [companyId, keys]
      );
      return rows;
    },
    // The company's facilities among `ids`, locked FOR KEY SHARE until the transaction
    // ends: a delete of one (FOR UPDATE, server-company-routes.cjs) waits for the commit
    // instead of landing before the rows' foreign key is checked.
    async lockFacilities(companyId, ids) {
      const { rows } = await db.query(
        'SELECT id FROM public.facilities WHERE company_id = $1 AND id = ANY($2::bigint[]) FOR KEY SHARE',
        [companyId, ids]
      );
      return rows;
    },
    async committedImportsOfFile(companyId, sha) {
      const { rows } = await db.query(
        `SELECT ${IMPORT_COLUMNS} FROM public.csv_import_events
          WHERE company_id = $1 AND file_sha256 = $2 AND status = 'committed' ORDER BY created_at DESC, id DESC`,
        [companyId, sha]
      );
      return rows;
    },
    async overlappingLines(companyId, rows) {
      const dates = [...new Set(rows.map((row) => row.entry.activity_date).filter(Boolean))];
      const undated = rows.some((row) => !row.entry.activity_date);
      const stored = await db.query(
        `SELECT scope, category, source, amount, unit, activity_date, facility_id FROM public.emission_entries
          WHERE company_id = $1 AND (activity_date = ANY($2::date[]) OR ($3::boolean AND activity_date IS NULL))
          LIMIT 50000`,
        [companyId, dates, undated]
      );
      return overlappingLines(rows, stored.rows);
    },
    async insertImport(companyId, { sha, rowCount, warningCount, filename }) {
      const { rows } = await db.query(
        `INSERT INTO public.csv_import_events (company_id, row_count, file_sha256, status, warning_count, original_filename)
         VALUES ($1, $2, $3, 'committed', $4, $5) RETURNING ${IMPORT_COLUMNS}`,
        [companyId, rowCount, sha, warningCount, filename]
      );
      return rows[0];
    },
    // created_at is left to its default, the insert time; the activity date has
    // its own column and decides the period (it used to overwrite created_at).
    // imported_at is now(), the transaction's start: the import's created_at to
    // the microsecond (a JS Date parameter would keep only milliseconds).
    async insertRows(companyId, event, rows, key) {
      for (let offset = 0; offset < rows.length; offset += BATCH_ROWS) {
        const params = [];
        const groups = rows.slice(offset, offset + BATCH_ROWS).map((row) => {
          const values = {
            ...row.entry,
            company_id: companyId,
            import_id: event.id,
            idempotency_key: key ? rowIdempotencyKey(key, row.line) : null,
          };
          return '(' + ROW_COLUMNS.map((column) => {
            params.push(values[column] === undefined ? null : values[column]);
            return '$' + params.length;
          }).join(', ') + ', now())';
        });
        await db.query(`INSERT INTO public.emission_entries (${ROW_COLUMNS.join(', ')}, imported_at) VALUES ${groups.join(', ')}`, params);
      }
    },
    async importForUpdate(companyId, importId) {
      const { rows } = await db.query(
        `SELECT ${IMPORT_COLUMNS} FROM public.csv_import_events WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [importId, companyId]
      );
      return rows[0] || null;
    },
    async removeImport(companyId, importId) {
      const removed = await db.query('DELETE FROM public.emission_entries WHERE import_id = $1 AND company_id = $2', [importId, companyId]);
      const updated = await db.query(
        `UPDATE public.csv_import_events SET status = 'undone', undone_at = now()
          WHERE id = $1 AND company_id = $2 RETURNING ${IMPORT_COLUMNS}`,
        [importId, companyId]
      );
      return { removed: removed.rowCount, event: updated.rows[0] };
    },
    // Signed-off (final, frozen) reports whose period holds one of the import's
    // rows, by the reports' own period rule (server.cjs loadEmissionEntries).
    async signedOffReports(companyId, importId) {
      const { rows } = await db.query(
        `SELECT r.id, r.title, r.period, r.period_start, r.period_end FROM public.reports r
          WHERE r.company_id = $1 AND r.status = 'final' AND r.period_start IS NOT NULL AND r.period_end IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.emission_entries e
                         WHERE e.company_id = $1 AND e.import_id = $2
                           AND COALESCE(e.activity_date, e.created_at::date) BETWEEN r.period_start AND r.period_end)
          ORDER BY r.period_start, r.id LIMIT 20`,
        [companyId, importId]
      );
      return rows;
    },
    async listImports(companyId) {
      const { rows } = await db.query(
        `SELECT i.id, i.company_id, i.created_at, i.row_count, i.warning_count, i.original_filename, i.status, i.undone_at,
                (SELECT COUNT(*)::int FROM public.emission_entries e WHERE e.import_id = i.id AND e.company_id = i.company_id) AS rows_present,
                COALESCE((SELECT json_agg(json_build_object('id', r.id, 'title', r.title, 'period', r.period,
                                                            'period_start', r.period_start, 'period_end', r.period_end)
                                          ORDER BY r.period_start, r.id)
                            FROM public.reports r
                           WHERE r.company_id = i.company_id AND r.status = 'final'
                             AND r.period_start IS NOT NULL AND r.period_end IS NOT NULL
                             AND EXISTS (SELECT 1 FROM public.emission_entries e
                                          WHERE e.company_id = i.company_id AND e.import_id = i.id
                                            AND COALESCE(e.activity_date, e.created_at::date) BETWEEN r.period_start AND r.period_end)),
                         '[]'::json) AS signed_off_reports
           FROM public.csv_import_events i
          WHERE i.company_id = $1
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT ${HISTORY_LIMIT}`,
        [companyId]
      );
      return rows;
    },
  };
}

module.exports = {
  pgStore,
  rowIdempotencyKey,
};
