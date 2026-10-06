/**
 * GDPR-01: the account export must include the audit trail.
 *
 * /api/account/delete-data deliberately PRESERVES `reports` and
 * `csv_import_events` — they carry the compliance sign-off and the import
 * history, and the route documents that choice. But GET /api/account/export
 * returned only company, facilities and emissionEntries, so the platform was
 * retaining data the customer could never obtain a copy of, and could not
 * exercise a data-portability right over.
 *
 * reports.signoff is the compliance artifact the whole product exists to
 * produce, and it was silently absent from "Export my data".
 *
 * The Privacy Policy (section 9) tells customers they can "export your workspace
 * data at any time", and the claims register approves
 * `no-proprietary-formats` on the evidence of that export.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');

function routeBody(startMarker: string, endMarker: string): string {
  const start = serverSource.indexOf(startMarker);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  const end = serverSource.indexOf(endMarker, start);
  return serverSource.slice(start, end === -1 ? undefined : end);
}

const exportRoute = routeBody("app.get('/api/account/export'", "app.post('/api/account/delete-data'");

describe('GDPR-01 export covers the audit trail', () => {
  it('includes reports and csv import events in the payload', () => {
    expect(exportRoute).toContain('reports: reports');
    expect(exportRoute).toContain('csvImportEvents: importEvents');
  });

  it('reads the sign-off columns, not just report metadata', () => {
    expect(exportRoute).toContain('loadReportsForExport');
    expect(serverSource).toMatch(
      /FROM public\.reports WHERE company_id = \$1[\s\S]*?signoff[\s\S]*?created_at/
    );
  });

  it('exports the import history so the customer can reconcile what was imported', () => {
    expect(exportRoute).toContain('loadCsvImportEventsForExport');
    expect(serverSource).toMatch(/FROM public\.csv_import_events WHERE company_id = \$1/);
  });

  it('scopes every audit-trail query to the tenant', () => {
    // No unguarded reports/csv_import_events read anywhere.
    const reads = [...serverSource.matchAll(/FROM public\.(reports|csv_import_events)/g)];
    expect(reads.length).toBeGreaterThan(0);
    for (const match of reads) {
      const context = serverSource.slice(match.index ?? 0, (match.index ?? 0) + 400);
      expect(context, `unscoped read: ${match[0]}`).toContain('company_id = $1');
    }
  });

  it('degrades instead of failing the portability request when a table is missing', () => {
    // An unmigrated database must not turn a data-portability request into a 500.
    for (const fn of ['loadReportsForExport', 'loadCsvImportEventsForExport']) {
      const body = serverSource.slice(serverSource.indexOf(`async function ${fn}`));
      expect(body.slice(0, 700), `${fn} has no catch`).toMatch(/catch\s*\(err\)/);
    }
  });

  it('still discloses the emission-entry cap rather than silently truncating', () => {
    expect(exportRoute).toContain('Export capped at the ');
    expect(exportRoute).toContain('payload.notes');
  });

  it('keeps tenant isolation on the export entry point', () => {
    expect(exportRoute).toContain('apiAuthGuard');
    expect(exportRoute).toContain('requireCompanyAccess(req, res, null)');
  });
});