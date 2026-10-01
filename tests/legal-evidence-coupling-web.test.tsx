import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import PrivacyPolicy from '../src/pages/PrivacyPolicy';
import DataProcessingAddendum from '../src/pages/DataProcessingAddendum';
import Security from '../src/pages/Security';
import TermsOfService from '../src/pages/TermsOfService';
import { ConsentProvider } from '../src/lib/consent-context';
import { dataFacts } from '../src/content/data-facts';

// The final web verification (VERIFY-FINAL-WEB, 2026-09-30) found public sentences that said less,
// or more, than the code does. This file continues tests/legal-evidence-coupling.test.tsx in the
// same style, for what that report found: the three facts that had drifted (what the export holds,
// what an import keeps, what "Delete my audit data" leaves) now come from one typed source,
// src/content/data-facts.ts, and the blocks below tie it, and the other corrected sentences, to the
// code. tests/export-claim-coupling.test.ts holds the export's column lists to the queries. It sits
// in its own file only to keep both under 500 lines. When one of these fails, change the wording
// and the code together and re-check the evidence; do not just edit the test.

const read = (path: string): string => readFileSync(resolve(path), 'utf8');
// A source without its comments: a header comment that names a table is not a query that touches it.
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (path: string): string => strip(read(path));
// Sentences of `text` (split on ". " and on the " | " pageText puts between list items) that match `topic`.
const sentencesAbout = (text: string, topic: RegExp): string[] =>
  text.split(/(?<=\.)\s+|\s*\|\s*/).map((sentence) => sentence.trim()).filter((sentence) => topic.test(sentence));

function pageText(page: ReactElement): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ConsentProvider>{page}</ConsentProvider>
    </MemoryRouter>,
  )
    .replace(/<\/(?:li|p|h[1-6]|td|tr|div|section)>/g, ' | ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const privacy = pageText(<PrivacyPolicy />);
const dpa = pageText(<DataProcessingAddendum />);
const security = pageText(<Security />);
const terms = pageText(<TermsOfService />);

// What the migrations install, without their comments (a rollback note is not behaviour).
const migrationFiles = readdirSync(resolve('migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({ name, sql: read(`migrations/${name}`).replace(/--.*$/gm, '') }));
const serverSources = readdirSync(resolve('.'))
  .filter((name) => /^server.*\.cjs$/.test(name))
  .map((name) => read(name))
  .join('\n');

describe('every page that describes the export renders the typed description, not a retyped list (VF-4)', () => {
  const { contents, limitNote, leavesOutNote } = dataFacts.export;
  const STALE = /company profile, facilities,? and emissions entries|scope, category, source, amount, unit, method, confidence, and date added/;

  it.each([['Privacy Policy', privacy], ['Security page', security], ['DPA', dpa]] as Array<[string, string]>)('%s names what the file holds', (_name, text) => {
    expect(text).toContain(contents);
    expect(text, 'a retyped, stale list of what the export holds').not.toMatch(STALE);
  });

  it('the Privacy Policy and the DPA also say what the file leaves out and when it is capped', () => {
    for (const text of [privacy, dpa]) {
      expect(text).toContain(limitNote);
      expect(text).toContain(leavesOutNote);
    }
  });
});

describe('the Privacy Policy names every column the import migration adds to the import history (VF-5)', () => {
  const migration = migrationFiles.filter(({ name }) => /csv-import-batches/.test(name)).map(({ sql }) => sql).join('\n');
  const added = [...(/ALTER TABLE public\.csv_import_events\s+([\s\S]*?);/.exec(migration)?.[1] ?? '').matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((match) => match[1] ?? '');
  const { columns, keeps } = dataFacts.importHistory;
  // The words that name each column in the sentence. row_count was there before the migration.
  const WORDS: Record<string, RegExp> = {
    row_count: /number of rows stored/,
    file_sha256: /fingerprint \(hash\) of the file/,
    status: /whether the import was later undone/,
    warning_count: /warnings shown/,
    original_filename: /file name the browser reported/,
    undone_at: /undone and when/,
  };

  it('finds the five columns the migration adds', () => {
    expect([...added].sort()).toEqual(['file_sha256', 'original_filename', 'status', 'undone_at', 'warning_count']);
  });

  it('the typed list is those five plus row_count, each has words in the sentence, and the export carries the same log', () => {
    expect([...columns].sort()).toEqual([...added, 'row_count'].sort());
    for (const column of columns) {
      expect(keeps, `${column} must be named in the import-history sentence`).toMatch(WORDS[column] ?? /^$/);
      expect(dataFacts.export.columns.csvImports, `${column} must be in the export's import log`).toContain(column);
    }
  });

  it('renders the sentence instead of a count of rows, and still says the file itself is not stored', () => {
    expect(privacy).toContain(`We do keep an import history: for each import, ${keeps}`);
    expect(privacy, 'the history holds more than a count of rows').not.toMatch(/a count of the rows in each import|import history \(row counts\)/);
    expect(privacy).toMatch(/We do not store the imported file itself/);
  });
});

describe('"Delete my audit data" is described as the handler does it, and every page that says so discloses the report copies (VF-2)', () => {
  const server = read('server.cjs');
  const from = server.indexOf("app.post('/api/account/delete-data'");
  // The route ends at the first closing "});" in column 0; every inner block is indented.
  const handler = strip(server.slice(from, server.indexOf('\n});\n', from) + 5));
  const { tables, removes, leaves, reports } = dataFacts.deleteAuditData;
  const touchesReports = /\breports\b/.test(handler);
  const pages: Array<[string, string]> = [['Privacy Policy', privacy], ['Security page', security], ['DPA', dpa], ['Terms of Service', terms]];

  it('deletes from the tables the typed source names, in one transaction, and touches no report, company, import, consent or billing table', () => {
    expect([...handler.matchAll(/DELETE FROM public\.(\w+)/g)].map((match) => match[1])).toEqual([...tables]);
    expect(handler).toMatch(/BEGIN[\s\S]*DELETE FROM[\s\S]*COMMIT/);
    for (const table of ['reports', 'companies', 'csv_import_events', 'consent_records', 'leads', 'users']) {
      expect(handler, `delete-data now touches ${table}: re-read what the pages say it leaves`).not.toMatch(new RegExp(`\\b${table}\\b`));
    }
  });

  it('a stored report holds a copy of the entries it covers: the snapshot and PDF columns, and the entry lines in the snapshot', () => {
    const reportsMigration = migrationFiles.find(({ sql }) => /ADD COLUMN IF NOT EXISTS snapshot JSONB/.test(sql))?.sql ?? '';
    expect(reportsMigration).toMatch(/ADD COLUMN IF NOT EXISTS pdf BYTEA/);
    expect(read('src/lib/reports/report-snapshot.cjs')).toMatch(/entries: lines\.slice\(0, MAX_SNAPSHOT_ENTRY_LINES\)/);
  });

  it.each(pages)('%s says what the control removes and discloses that reports are not part of it', (_name, text) => {
    expect(text).toContain(removes);
    if (touchesReports) expect(text, 'delete-data now deletes reports: drop the sentence that says it does not').not.toContain(reports);
    else expect(text, 'a page that says what the control removes must also say reports keep their copy').toContain(reports);
  });

  it('the Privacy Policy lists what the control leaves from the typed source', () => {
    expect(privacy).toContain(`${leaves} are not affected`);
    expect(privacy).not.toMatch(/generated-report records, and billing record are not affected/);
  });
});

describe('the consent queue and the signal records are described as the code behaves (VF-6, VF-7)', () => {
  const audit = code('src/lib/consent-audit.ts');
  const context = code('src/lib/consent-context.tsx');

  it('VF-6: names the cap, says the oldest record is the one dropped, and says a refused record is dropped, not retried', () => {
    const cap = Number(/const MAX_QUEUED = (\d+)/.exec(audit)?.[1]);
    expect(cap).toBeGreaterThan(0);
    expect(audit, 'the oldest record is the one dropped').toMatch(/\.slice\(-MAX_QUEUED\)/);
    expect(audit, 'a refused record is dropped, never retried').toMatch(/PERMANENT_REJECTIONS\.has\(res\.status\)[\s\S]{0,200}return 'rejected'/);
    expect(privacy).toContain(`At most ${cap} records wait there; if more arrive, the oldest is dropped`);
    expect(privacy).toMatch(/A record our servers refuse as invalid is dropped, not retried/);
  });

  it('VF-7: says a browser privacy signal writes a record without a choice, while the code does that', () => {
    const writesOnSignal = /if \(signals\.gpc \|\| signals\.dnt\) return [^;]*recordSignal: true/.test(context)
      && /recordConsentAudit\(record\.consent, privacySignals, 'privacy_signal'\)/.test(context);
    const clause = /or when your browser sends a Global Privacy Control or Do Not Track signal and we apply it without asking you, we store a record of it on our servers/;
    if (writesOnSignal) {
      expect(serverSources, 'the server accepts the signal method').toMatch(/CONSENT_METHODS = new Set\([^)]*'privacy_signal'/);
      expect(privacy).toMatch(clause);
    } else {
      expect(privacy, 'no record is written for a signal any more: remove the clause').not.toMatch(clause);
    }
  });
});

describe('the Terms describe plan changes as PATCH /api/subscription applies them (VF-3)', () => {
  const handler = strip(serverSources.slice(serverSources.indexOf("app.patch('/api/subscription'"), serverSources.indexOf("app.delete('/api/subscription'")));
  const prorates = /proration_behavior:\s*'create_prorations'/.test(handler);
  const invoicesAtOnce = /proration_behavior:\s*'always_invoice'/.test(handler);
  const defers = /subscriptionSchedules|subscription_schedule|billing_cycle_anchor|proration_behavior:\s*'none'|\bcancel_at:|\bphases\b/.test(handler);

  it('the handler changes the price at once with prorations and schedules nothing for the end of the period', () => {
    expect(handler.length).toBeGreaterThan(300);
    expect(handler).toMatch(/stripe\.subscriptions\.update\(subscription\.id, updateParams\)/);
    expect(prorates, 'the handler no longer prorates: rewrite the Terms "Plan changes" item').toBe(true);
    expect(defers, 'a downgrade can now be deferred: the Terms may say so, and this test should be rewritten with them').toBe(false);
  });

  it('the Terms say upgrades and downgrades take effect immediately, prorated, while that is so', () => {
    if (defers) {
      expect(terms).not.toMatch(/Upgrades and downgrades take effect immediately/);
    } else {
      expect(terms).toMatch(/Plan changes: Upgrades and downgrades take effect immediately/);
      expect(terms, 'a downgrade is applied at once: there is no end-of-period schedule').not.toMatch(/Downgrades take effect at the end of the current billing period/);
    }
    if (invoicesAtOnce) expect(terms, 'prorations are invoiced at once now').not.toMatch(/which appear on your next invoice/);
    else expect(terms).toMatch(/an upgrade adds a prorated charge and a downgrade gives a prorated credit, which appear on your next invoice/);
  });
});

describe('the Security page says how workspaces are isolated, as the code does it (VF-10)', () => {
  const rowSecurityOff = /SET LOCAL row_security = off/.test(serverSources);
  const filtersByCompany = /WHERE company_id = \$1/.test(serverSources);

  it('the server runs its own queries with row security off and filters them on company_id', () => {
    expect(rowSecurityOff).toBe(true);
    expect(filtersByCompany).toBe(true);
  });

  it('says isolation is by row-level security and by server-side tenant checks, not by row-level security alone, while that is so', () => {
    if (rowSecurityOff) {
      expect(security).toMatch(/is isolated by Postgres row-level security and by server-side tenant checks/);
      expect(security, 'row-level security does not cover the server path').not.toMatch(/row-level security isolates each workspace/);
    } else {
      expect(security, 'the server no longer bypasses row security: the tenant-checks clause may go').not.toMatch(/server-side tenant checks/);
    }
  });
});

describe('the legal pages name no feature the product does not have, except in a sentence that says it is not offered (VF-9, F-A-01)', () => {
  const NOT_BUILT: Array<[RegExp, string]> = [
    [/audit[- ]trails?/i, 'an audit trail (claims.ts audit-ready is withdrawn; an audit trail is on the roadmap)'],
    [/audit[- ]read(?:y|iness)/i, 'audit readiness (claims.ts audit-ready is withdrawn)'],
    [/upload(?:s|ing)? (?:of )?(?:your |any )?documents?|document uploads?\b/i, 'document upload (nothing stores a document)'],
    [/\bAI[- ](?:assisted|assistant|powered|driven)|AI Carbon Assistant|\bAI tools?\b/i, 'an AI assistant (not built; on the roadmap)'],
    [/supplier (?:communications|requests?|hub|engagement)/i, 'supplier requests (not built; on the roadmap)'],
  ];
  // The only sentences that may name them: each says the feature is not offered. Add to this list only a sentence that does.
  const NEGATED = new Set([
    'The Service does not currently offer document upload, an audit trail, an AI assistant or supplier requests; the last three are on our product roadmap and are not yet available.',
  ]);
  const pages: Array<[string, string]> = [['Privacy Policy', privacy], ['Security page', security], ['DPA', dpa], ['Terms of Service', terms]];

  it('no sentence names one, unless it is on the allowlist', () => {
    const offenders: string[] = [];
    for (const [name, text] of pages) {
      for (const [pattern, why] of NOT_BUILT) {
        for (const sentence of sentencesAbout(text, pattern)) {
          if (!NEGATED.has(sentence)) offenders.push(`${name}: "${sentence}" names ${why}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('each allowlisted sentence is on a page, and really says the feature is not offered', () => {
    const everything = pages.map(([, text]) => text).join(' | ');
    for (const sentence of NEGATED) {
      expect(sentencesAbout(everything, /document upload/i), 'the allowlisted sentence is no longer on any page: remove it from the list').toContain(sentence);
      expect(sentence).toMatch(/does not (?:currently )?offer/);
    }
  });

  it('what the Terms say the Service is used for exists: CSV import, PDF reports and the JSON export', () => {
    expect(serverSources).toMatch(/\/api\/ingest\/csv/);
    expect(serverSources).toMatch(/renderReportPdf\(/);
    expect(serverSources).toMatch(/app\.get\('\/api\/account\/export'/);
    expect(terms).toMatch(/Import activity data from CSV files/);
    expect(terms).toMatch(/Generate reports as PDF emissions summaries/);
    expect(terms).toMatch(/export your data as JSON/);
  });
});

// ── VF-14 / VF-15: sentences the repo cannot evidence keep a marker that says so ─────────────────────
describe('a sentence with no evidence in the repo carries a counsel marker that says so (VF-15)', () => {
  const UNEVIDENCED: Array<[string, string]> = [
    ['src/pages/DataProcessingAddendum.tsx', 'Written data processing agreements with all subprocessors'],
    ['src/pages/DataProcessingAddendum.tsx', 'Ongoing review of subprocessor security practices'],
    ['src/pages/DataProcessingAddendum.tsx', 'Developer312 ensures that subprocessors are bound by written agreements'],
    ['src/pages/DataProcessingAddendum.tsx', "Developer312's employees and contractors are bound by confidentiality agreements"],
    ['src/pages/PrivacyPolicy.tsx', 'These providers are contractually obligated'],
    ['src/pages/Security.tsx', 'Production access is restricted to authorized engineering and support staff'],
  ];

  it.each(UNEVIDENCED)('%s: "%s" sits below a COUNSEL-REVIEW marker that says it has no evidence in the repo', (file, sentence) => {
    const source = read(file);
    const at = source.indexOf(sentence);
    expect(at, `"${sentence}" is no longer in ${file}: if counsel removed it, remove it from this list`).toBeGreaterThan(0);
    const marker = source.lastIndexOf('COUNSEL-REVIEW', at);
    expect(marker, 'a marker above the sentence').toBeGreaterThanOrEqual(0);
    expect(at - marker, 'the nearest marker is the one for this sentence').toBeLessThan(1500);
    const text = source.slice(marker, at);
    expect(text).toMatch(/no evidence in the repo/);
    expect(text).toMatch(/NEEDS-OWNER: [^.]*confirm[^.]* or remove/);
  });
});
