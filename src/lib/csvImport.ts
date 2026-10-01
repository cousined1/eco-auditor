// The browser side of the CSV import (audit K4): read a file, have the server
// check it (a dry run stores nothing), commit it, list past imports and undo
// one. Every call goes through apiFetch, which owns the session token, inside
// withDeadline: a request that does not answer within 15 s ends in an error the
// page shows with a Try again. A commit carries an Idempotency-Key, so trying a
// timed-out commit again returns the import the server already stored instead
// of storing it twice.
import { apiFetch, getUpgradeRequired, type UpgradeRequired } from './api';
import { RequestTimeoutError, withDeadline } from './requestTimeout';

export interface SignedOffReportRef {
  id: string;
  title: string | null;
  period: string | null;
  period_start: string | null;
  period_end: string | null;
}

export interface ImportRecord {
  id: string;
  created_at: string | null;
  original_filename: string | null;
  row_count: number;
  warning_count: number | null;
  /** legacy: recorded before import history existed; its rows are not linked to it. */
  status: 'committed' | 'undone' | 'legacy';
  undone_at: string | null;
  rows_present?: number;
  /** Signed-off reports whose period holds one of the import's rows. */
  signed_off_reports?: SignedOffReportRef[];
}

export interface CheckResult {
  total_rows: number;
  valid_rows: number;
  error_count: number;
  errors: string[];
  warnings: string[];
  conversions: string[];
  duplicate_of: ImportRecord | null;
  overlapping_rows: number;
  /**
   * The valid rows as the Dashboard will count them (the same engine functions): total is
   * the scopes; scope2_market, biogenic_co2 and non_kyoto are reported beside them.
   */
  tonnes: { scope1: number; scope2: number; scope3: number; total: number; scope2_market?: number; biogenic_co2?: number; non_kyoto?: number };
  imports_left: number | null;
  can_commit: boolean;
}

export interface CommitResult {
  imported: number;
  total_rows: number;
  warnings: string[];
  conversions: string[];
  replaced_imports: string[];
  replayed: boolean;
  import: ImportRecord;
}

export type OnDuplicate = 'replace' | 'import_anyway';

/**
 * ok: done. upgrade: the plan gate answered 402. invalid: the file has errors
 * (nothing stored). duplicate: the same file was imported before (nothing
 * stored). signed_off: undoing would touch a signed-off report's period.
 * error: anything else; `timeout` when the deadline passed, `final` when
 * trying the same request again would do harm.
 */
export type ImportCall<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'upgrade'; upgrade: UpgradeRequired }
  | { kind: 'invalid'; message: string; errors: string[] }
  | { kind: 'duplicate'; message: string; previous: ImportRecord }
  | { kind: 'signed_off'; message: string; reports: SignedOffReportRef[] }
  | { kind: 'error'; message: string; timeout?: boolean; final?: boolean };

export interface DecodedCsv {
  text: string;
  /** Set when the bytes were not UTF-8 and were read as Windows-1252. */
  encodingNote: string | null;
}

/**
 * The file's text. UTF-8 first; bytes that are not valid UTF-8 are read as
 * Windows-1252, which is what Excel's plain "CSV" saves, instead of turning
 * "Zürich" into "Z�rich".
 */
export async function decodeCsvFile(file: Blob): Promise<DecodedCsv> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encodingNote: null };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encodingNote:
        'This file is not UTF-8, so it was read as Windows-1252 (what Excel saves as plain "CSV"). Check that names with accents look right; if they do not, save the file as "CSV UTF-8" and upload it again.',
    };
  }
}

type Json = Record<string, unknown>;

async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  return withDeadline((deadline) => apiFetch(path, { ...init, signal: deadline }), signal ? { signal } : {});
}

async function failure(res: Response, fallback: string): Promise<ImportCall<never>> {
  const upgrade = await getUpgradeRequired(res);
  if (upgrade) return { kind: 'upgrade', upgrade };
  if (res.status === 401) return { kind: 'error', message: 'Your session expired. Sign in again, then retry.' };
  // The server caps the body at 100 kB; its 413 is HTML, not JSON.
  if (res.status === 413) return { kind: 'error', message: 'The file is larger than the 100 KB import limit. Split it into smaller files and upload them one by one.' };
  const body = (await res.json().catch(() => ({}))) as Json;
  const message = typeof body.error === 'string' && body.error ? body.error : `${fallback} (HTTP ${res.status})`;
  if (body.code === 'invalid_file') return { kind: 'invalid', message, errors: Array.isArray(body.errors) ? (body.errors as string[]) : [] };
  if (body.code === 'duplicate_file' && body.duplicate_of) return { kind: 'duplicate', message, previous: body.duplicate_of as ImportRecord };
  if (body.code === 'signed_off_report') return { kind: 'signed_off', message, reports: Array.isArray(body.reports) ? (body.reports as SignedOffReportRef[]) : [] };
  return { kind: 'error', message };
}

function thrown(err: unknown): ImportCall<never> {
  if (err instanceof RequestTimeoutError) return { kind: 'error', message: 'The server took too long to answer. Check your connection and try again.', timeout: true };
  return { kind: 'error', message: err instanceof Error ? err.message : 'Network error' };
}

function ingestPath(filename: string, extra: Record<string, string>): string {
  const query = new URLSearchParams({ ...extra, filename });
  return `/api/ingest/csv?${query.toString()}`;
}

/** The dry run: every error and warning, the conversions and the totals; nothing is stored. */
export async function checkCsv(text: string, filename: string, signal?: AbortSignal): Promise<ImportCall<CheckResult>> {
  try {
    const res = await call(ingestPath(filename, { dry_run: '1' }), { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text }, signal);
    if (!res.ok) return failure(res, 'The file could not be checked');
    const body = (await res.json()) as Partial<CheckResult> & { dry_run?: unknown };
    // A server from before the check existed ignores dry_run and imports the
    // file at once: say so, so the user does not import it a second time.
    if (body.dry_run !== true) {
      return {
        kind: 'error',
        final: true,
        message: 'The server imported this file without checking it first. Do not upload it again: reload the page to see it under Uploaded Files.',
      };
    }
    const errors = body.errors ?? [];
    return {
      kind: 'ok',
      data: {
        total_rows: body.total_rows ?? 0,
        valid_rows: body.valid_rows ?? 0,
        error_count: body.error_count ?? errors.length,
        errors,
        warnings: body.warnings ?? [],
        conversions: body.conversions ?? [],
        duplicate_of: body.duplicate_of ?? null,
        overlapping_rows: body.overlapping_rows ?? 0,
        tonnes: body.tonnes ?? { scope1: 0, scope2: 0, scope3: 0, total: 0 },
        imports_left: body.imports_left ?? null,
        can_commit: body.can_commit === true,
      },
    };
  } catch (err) {
    return thrown(err);
  }
}

/** Stores every row or none. The key identifies this upload: a retry with it is answered with the stored import. */
export async function commitCsv(text: string, filename: string, idempotencyKey: string, onDuplicate?: OnDuplicate): Promise<ImportCall<CommitResult>> {
  try {
    const res = await call(ingestPath(filename, onDuplicate ? { on_duplicate: onDuplicate } : {}), {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'Idempotency-Key': idempotencyKey },
      body: text,
    });
    if (!res.ok) return failure(res, 'The import failed');
    return { kind: 'ok', data: (await res.json()) as CommitResult };
  } catch (err) {
    return thrown(err);
  }
}

/** The company's imports, newest first. */
export async function listImports(signal?: AbortSignal): Promise<ImportCall<ImportRecord[]>> {
  try {
    const res = await call('/api/ingest/imports', {}, signal);
    if (!res.ok) return failure(res, 'Your imports could not be loaded');
    const body = (await res.json()) as { data?: ImportRecord[] };
    return { kind: 'ok', data: Array.isArray(body.data) ? body.data : [] };
  } catch (err) {
    return thrown(err);
  }
}

/** Removes an import's rows and marks it undone. */
export async function undoImport(id: string, confirmSignedOff: boolean): Promise<ImportCall<{ import: ImportRecord; removed_rows: number }>> {
  try {
    const res = await call(`/api/ingest/imports/${encodeURIComponent(id)}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_signed_off: confirmSignedOff }),
    });
    if (!res.ok) return failure(res, 'The import could not be undone');
    return { kind: 'ok', data: (await res.json()) as { import: ImportRecord; removed_rows: number } };
  } catch (err) {
    return thrown(err);
  }
}
