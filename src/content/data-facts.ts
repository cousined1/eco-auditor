/**
 * VF-2 / VF-4 / VF-5 (final web verification, 2026-09-30) - the one typed source for the three
 * facts about customer data that had drifted between the legal pages, the Settings data card and
 * the claims register:
 *   1. what the JSON export holds (GET /api/account/export in server.cjs),
 *   2. what an import keeps in the import history (public.csv_import_events),
 *   3. what "Delete my audit data" removes and what it leaves (POST /api/account/delete-data).
 * Privacy, Security, the DPA, the Terms (data after termination) and Settings render these
 * instead of retyping them, the way the contact pages read contactDetails, so the next change to
 * the export, the import log or the delete handler is made in one place. The claims register
 * builds its export evidence from the same column list.
 *
 * These are claims about code. tests/export-claim-coupling.test.ts holds every column list to
 * the SELECT in server.cjs, and tests/legal-evidence-coupling.test.tsx holds the sentences to the
 * migration and to the delete handler: change the code first and they fail until the words here
 * are re-read. Do not add a statement here that no code backs.
 */
export const dataFacts = {
  export: {
    // The columns each part of the export selects: loadCompanyExportRow, loadFacilities,
    // loadEmissionEntriesForExport and loadExportHistory (reports, csvImports) in server.cjs.
    columns: {
      company: ['id', 'name', 'industry', 'consolidation_approach', 'base_year', 'created_at', 'updated_at', 'trial_ends_at'],
      facilities: ['id', 'company_id', 'name', 'type', 'city'],
      emissionEntries: [
        'id', 'company_id', 'facility_id', 'scope', 'category', 'source', 'amount', 'unit', 'factor', 'method', 'confidence',
        'co2e_kg', 'activity_date', 'activity_amount', 'activity_unit', 'factor_value', 'factor_source', 'catalog_version',
        'notes', 'import_id', 'imported_at', 'created_at', 'updated_at',
      ],
      reports: [
        'id', 'title', 'type', 'status', 'period', 'period_start', 'period_end', 'last_updated', 'completeness', 'signoff',
        'signed_off_by', 'signed_off_at', 'pdf_sha256', 'created_at',
      ],
      csvImports: ['id', 'row_count', 'warning_count', 'original_filename', 'file_sha256', 'status', 'undone_at', 'created_at'],
    },
    // What the file holds, as a list a sentence can follow ("... a JSON download of your <contents>").
    contents:
      'company profile (name and industry, reporting basis and base year), facilities, emissions entries with their activity, emission factor, CO2e and notes, the details of each generated report (title, period, status and sign-off; not the PDF) and the log of CSV imports',
    // EXPORT_MAX_ENTRIES in server.cjs: past it the file keeps the newest entries and carries a note.
    limitNote: 'If there are more than 10,000 emissions entries, the file holds the newest 10,000 and says so',
    // What a reader might expect in the file and will not find: no loader selects it.
    leavesOutNote: 'The file does not include the report PDFs or the edit records of entries',
  },
  importHistory: {
    // csv_import_events: row_count (migration 20260724010000) and the five columns that
    // migration 20260930120000 adds. created_at, the time of the import, is the sixth fact kept.
    columns: ['row_count', 'file_sha256', 'status', 'warning_count', 'original_filename', 'undone_at'],
    // What each import leaves in the import history. The file itself is not stored.
    keeps:
      'the file name the browser reported, a fingerprint (hash) of the file, the number of rows stored and of warnings shown, whether the import was later undone and when, and the time of the import',
  },
  deleteAuditData: {
    // The tables the handler deletes from, in order, in one transaction.
    tables: ['emission_entries', 'facilities'],
    removes: 'emissions entries and facilities',
    // Not touched by the handler: it names none of these tables.
    leaves: 'sign-in account, company profile, import history and billing record',
    // The handler never touches public.reports, and a stored report holds the entries it was built from.
    reports: 'Generated reports are not part of this deletion: a report keeps a copy of the emissions entries it covers',
  },
} as const;
