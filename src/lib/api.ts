type InsForgeLikeClient = {
  getHttpClient?: () => {
    getHeaders?: () => Record<string, string>;
  };
};

export function buildApiRequestInit(client: InsForgeLikeClient): RequestInit {
  const sdkHeaders = client.getHttpClient?.().getHeaders?.() || {};
  const authorization = sdkHeaders.Authorization || sdkHeaders.authorization;

  return {
    headers: authorization ? { Authorization: authorization } : {},
  };
}

export type PlanId = 'starter' | 'growth' | 'pro';

export interface UpgradeRequired {
  requiredPlan: PlanId;
  message?: string;
}

// Detects the server's plan-gate 402 response (`{ code: 'upgrade_required',
// requiredPlan }`) so callers can show an upgrade paywall instead of a generic
// error. Uses res.clone() so the caller can still read the body on the happy path.
export async function getUpgradeRequired(res: Response): Promise<UpgradeRequired | null> {
  if (res.status !== 402) return null;
  try {
    const body = await res.clone().json();
    if (body && body.code === 'upgrade_required') {
      const plan = body.requiredPlan;
      const requiredPlan: PlanId = plan === 'growth' || plan === 'pro' ? plan : 'starter';
      return { requiredPlan, message: typeof body.error === 'string' ? body.error : undefined };
    }
  } catch {
    /* not JSON / no body — fall through */
  }
  return null;
}

// ─── Account data controls (DATA-005) ────────────────────────────────────────
// Typed wrappers for the self-serve data endpoints: GET /api/account/export
// returns a machine-readable JSON export of the caller's workspace, and
// POST /api/account/delete-data removes the workspace's audit data (emissions
// entries and facilities) while leaving the account itself in place.
// Auth follows buildApiRequestInit: callers pass the insforge client and we
// forward only the SDK-managed Authorization header (same as src/lib/session.ts).
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type AccountDataExport = {
  exportedAt?: string;
  [key: string]: unknown;
};

export type ExportMyDataResult = { blob: Blob; filename: string };

export async function exportMyData(client: InsForgeLikeClient): Promise<ApiResult<ExportMyDataResult>> {
  try {
    const res = await fetch('/api/account/export', { ...buildApiRequestInit(client), signal: AbortSignal.timeout(15000) }); // RT-06
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: dataControlError(res.status, (body as { error?: string }).error, 'Data export failed') };
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] || 'eco-auditor-data-export.json';
    return { ok: true, data: { blob, filename } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function deleteMyData(client: InsForgeLikeClient): Promise<ApiResult<{ deleted?: unknown }>> {
  try {
    const res = await fetch('/api/account/delete-data', { ...buildApiRequestInit(client), method: 'POST', signal: AbortSignal.timeout(15000) }); // RT-06
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: dataControlError(res.status, (body as { error?: string }).error, 'Failed to delete your audit data') };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data: data as { deleted?: unknown } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// Maps a failed data-control call to user-facing copy. A missing session is the
// most common failure for a signed-out visitor landing on Settings; everything
// else surfaces the server's own error or a stable fallback.
function dataControlError(status: number, serverMessage: string | undefined, fallback: string): string {
  if (status === 401) return 'You must be signed in to manage your data.';
  return serverMessage || fallback;
}

/**
 * Save a Blob to disk via a synthetic anchor click.
 *
 * The revoke MUST be deferred past the click. Revoking in the same turn frees
 * the blob before the browser has read it: Chrome tolerates that, but Firefox
 * and Safari resolve the download asynchronously and produce no file at all —
 * while the caller reports success and offers no retry.
 *
 * Two call sites had this bug independently (the account data export and the
 * report generator), so the dance lives here once. If you need to download a
 * blob, use this rather than re-implementing it.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough to clear the download turn on every engine, short enough that
  // the blob is not held for the life of the page.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
