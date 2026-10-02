import { insforge } from './insforge';

type InsForgeLikeClient = {
  getHttpClient?: () => {
    getHeaders?: () => Record<string, string>;
  };
};

/** What apiFetch needs from the InsForge client: its current headers and an explicit session refresh. */
export type ApiClient = InsForgeLikeClient & {
  auth?: {
    refreshSession?: () => Promise<{
      data: { accessToken?: string | null } | null;
      error: { statusCode?: number } | null;
    }>;
  };
};

// ─── Authenticated calls to server.cjs ───────────────────────────────────────
// The SDK only refreshes an expired access token for requests it sends itself.
// server.cjs routes are plain fetch() calls, so an expired token used to come
// back as a 401 that a global window.fetch patch turned into a sign-out, once
// per token lifetime, although the refresh cookie was still valid. apiFetch
// refreshes and retries instead, and reports the session as over only when it
// cannot be recovered.

let sessionExpiredHandler: (() => void) | null = null;

/**
 * Registers what happens when the session cannot be recovered: the server
 * rejected the token and the refresh was refused (App signs out and sends the
 * user to /login). Returns the unregister function.
 */
export function onSessionExpired(handler: () => void): () => void {
  sessionExpiredHandler = handler;
  return () => {
    if (sessionExpiredHandler === handler) sessionExpiredHandler = null;
  };
}

function notifySessionExpired(): void {
  clearConnectionProblem();
  sessionExpiredHandler?.();
}

type RefreshOutcome = 'refreshed' | 'rejected' | 'unavailable';

// ─── A refresh that keeps failing (I-1) ──────────────────────────────────────
// A refresh that fails for a transient reason (see isTransientStatus) leaves the
// user signed in and hands the caller the 401 and its usual error state. That is
// right for a blip. When it keeps happening it is not: every screen shows its own
// unexplained error and nothing says the connection is the cause. So consecutive
// transient refresh failures are counted, and at CONNECTION_PROBLEM_FAILURES of
// them, or CONNECTION_PROBLEM_AFTER_MS after the first, a connection problem is
// reported; the app shell shows it as a banner (ConnectionProblemBanner) with
// Retry and Sign in again. Nobody is signed out by it: a refresh the server
// refuses (401/403) stays terminal through onSessionExpired, and ends the streak,
// as does a refresh that works or any authenticated request the server accepts.

const CONNECTION_PROBLEM_FAILURES = 3;
const CONNECTION_PROBLEM_AFTER_MS = 2 * 60 * 1000;

let transientFailures = 0;
let firstTransientFailureAt = 0;
let connectionProblem = false;
const connectionProblemListeners = new Set<() => void>();

/** useSyncExternalStore subscription: whether the session refresh keeps failing. */
export function subscribeConnectionProblem(listener: () => void): () => void {
  connectionProblemListeners.add(listener);
  return () => {
    connectionProblemListeners.delete(listener);
  };
}

export function getConnectionProblem(): boolean {
  return connectionProblem;
}

function setConnectionProblem(active: boolean): void {
  if (connectionProblem === active) return;
  connectionProblem = active;
  connectionProblemListeners.forEach((listener) => listener());
}

function clearConnectionProblem(): void {
  transientFailures = 0;
  setConnectionProblem(false);
}

function recordRefreshOutcome(outcome: RefreshOutcome): void {
  if (outcome !== 'unavailable') {
    clearConnectionProblem();
    return;
  }
  const now = Date.now();
  if (transientFailures === 0) firstTransientFailureAt = now;
  transientFailures += 1;
  if (transientFailures >= CONNECTION_PROBLEM_FAILURES || now - firstTransientFailureAt >= CONNECTION_PROBLEM_AFTER_MS) {
    setConnectionProblem(true);
  }
}

// The server accepted the token, so the session works whatever the refresh said.
function noteAccepted(res: Response): Response {
  if (res.ok && (transientFailures > 0 || connectionProblem)) clearConnectionProblem();
  return res;
}

/**
 * The banner's Retry: one more refresh now. Resolves true when the session is
 * usable again; a refresh the server refuses ends the session like any other.
 */
export async function retryConnection(client: ApiClient = insforge): Promise<boolean> {
  const outcome = await refreshSessionOnce(client);
  if (outcome === 'rejected') notifySessionExpired();
  return outcome === 'refreshed';
}

/** The banner's "Sign in again": the user's own choice, handled like an unrecoverable session. */
export function signInAgain(): void {
  notifySessionExpired();
}

// One refresh per client at a time. The web refresh rotates the CSRF token, so
// two concurrent refreshes (the dashboard sends two requests at once) could
// invalidate each other and sign the user out. The outcome is recorded once per
// refresh, not once per request that was waiting on it.
const refreshesInFlight = new WeakMap<object, Promise<RefreshOutcome>>();

function refreshSessionOnce(client: ApiClient): Promise<RefreshOutcome> {
  const pending = refreshesInFlight.get(client);
  if (pending) return pending;
  const attempt = runRefresh(client)
    .then((outcome) => {
      recordRefreshOutcome(outcome);
      return outcome;
    })
    .finally(() => refreshesInFlight.delete(client));
  refreshesInFlight.set(client, attempt);
  return attempt;
}

async function runRefresh(client: ApiClient): Promise<RefreshOutcome> {
  const auth = client.auth;
  if (!auth?.refreshSession) return 'rejected';
  try {
    const { data, error } = await auth.refreshSession();
    if (!error) return data?.accessToken ? 'refreshed' : 'rejected';
    return isTransientStatus(error.statusCode) ? 'unavailable' : 'rejected';
  } catch {
    return 'unavailable';
  }
}

// No response (0), timeout (408), throttling (429) and server errors say
// nothing about the session itself; signing out on them would log users out
// on a network blip. A 401/403 (no valid refresh cookie, bad CSRF) does.
function isTransientStatus(status: number | undefined): boolean {
  return status === undefined || status === 0 || status === 408 || status === 429 || status >= 500;
}

// The only place in the app that reads the SDK's token (tests/api-auth-guard.test.ts
// keeps it that way): apiFetch sends it, hasSession answers true or false.
function authorizationFrom(client: InsForgeLikeClient): string | undefined {
  const headers = client.getHttpClient?.().getHeaders?.() || {};
  return headers.Authorization || headers.authorization || undefined;
}

/**
 * Whether the SDK holds a signed-in user's access token, without handing the token
 * out. A signed-out visitor still has headers: the SDK falls back to the public
 * anon key ("const authToken = this.userToken || this.anonKey"), and that must
 * read as signed out, or Pricing's "not signed in: go to /signup" never fires and
 * the anonymous funnel dies on a raw 401 (FE-01). Callers use this as a gate; the
 * token itself stays in this file, so no other code can send it (D-5).
 */
export function hasSession(client: ApiClient = insforge): boolean {
  try {
    const token = authorizationFrom(client)?.replace(/^Bearer\s+/i, '') ?? '';
    const anonKey = (import.meta.env.VITE_INSFORGE_ANON_KEY as string | undefined) || '';
    return token !== '' && !(anonKey && token === anonKey);
  } catch {
    return false;
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

// apiFetch owns the Authorization header: whatever the caller passed is
// replaced by the SDK's current token.
function withAuthorization(init: RequestInit, authorization: string | undefined): RequestInit {
  const headers = Object.fromEntries(
    Object.entries(headersToRecord(init.headers)).filter(([name]) => name.toLowerCase() !== 'authorization'),
  );
  if (authorization) headers.Authorization = authorization;
  return { ...init, headers };
}

/**
 * Same-origin /api/* only. /api/auth/* belongs to InsForge and is reached
 * through the SDK; anything else never receives the bearer token.
 */
function isServerApiPath(path: string): boolean {
  try {
    const url = new URL(path, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth');
  } catch {
    return false;
  }
}

/**
 * fetch() for Eco-Auditor's own /api routes, with the signed-in user's token.
 * Every authenticated server.cjs call goes through here.
 *
 * On a 401 it asks the SDK to refresh the session (one refresh shared by all
 * concurrent callers) and retries the request once with the new token. It
 * reports through onSessionExpired only when the refresh is refused or the
 * fresh token is rejected too; when the refresh fails for a transient reason
 * the caller gets the 401 and its usual error state, and nobody is signed out.
 *
 * Other URLs are passed to fetch() untouched: no token, no retry. Bodies must
 * be replayable (string, FormData, Blob, URLSearchParams), as all callers'
 * are. A server.cjs 401 comes from its auth guard, before any handler runs,
 * so the retry cannot repeat a side effect.
 *
 * Refreshes that keep failing for a transient reason are counted and reported
 * as a connection problem (see "A refresh that keeps failing" above).
 */
export async function apiFetch(path: string, init: RequestInit = {}, client: ApiClient = insforge): Promise<Response> {
  if (!isServerApiPath(path)) return fetch(path, init);

  const sentWith = authorizationFrom(client);
  const first = await fetch(path, withAuthorization(init, sentWith));
  if (first.status !== 401) return noteAccepted(first);

  let current = authorizationFrom(client);
  // A different token means another request refreshed (or ended) the session
  // while this one was in flight: retry with it rather than refresh again.
  if (current === sentWith) {
    const outcome = await refreshSessionOnce(client);
    if (outcome === 'unavailable') return first;
    current = authorizationFrom(client);
    if (outcome === 'rejected' && current === sentWith) {
      notifySessionExpired();
      return first;
    }
  }

  const retried = await fetch(path, withAuthorization(init, current));
  if (retried.status === 401) notifySessionExpired();
  return noteAccepted(retried);
}

export type PlanId = 'starter' | 'growth' | 'pro';

export interface UpgradeRequired {
  requiredPlan: PlanId;
  message?: string;
  /** The card-free trial ran out and nothing was ever bought (the server's reason 'trial_expired'). */
  trialEnded?: boolean;
  /** When the trial ended, when the server says. */
  trialEndedAt?: string;
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
      const info: UpgradeRequired = { requiredPlan, message: typeof body.error === 'string' ? body.error : undefined };
      // `reason` only adds detail to the same plan gate: an ended trial gets its own
      // paywall wording; every other 402 is read exactly as before.
      if (body.reason === 'trial_expired') {
        info.trialEnded = true;
        if (typeof body.trialEndedAt === 'string') info.trialEndedAt = body.trialEndedAt;
      }
      return info;
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
// Auth goes through apiFetch: callers pass the insforge client, and only the
// SDK-managed Authorization header is forwarded (refreshed on expiry).
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type AccountDataExport = {
  exportedAt?: string;
  [key: string]: unknown;
};

export type ExportMyDataResult = { blob: Blob; filename: string };

export async function exportMyData(client: ApiClient): Promise<ApiResult<ExportMyDataResult>> {
  try {
    const res = await apiFetch('/api/account/export', { signal: AbortSignal.timeout(15000) }, client); // RT-06
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

export async function deleteMyData(client: ApiClient): Promise<ApiResult<{ deleted?: unknown }>> {
  try {
    const res = await apiFetch('/api/account/delete-data', { method: 'POST', signal: AbortSignal.timeout(15000) }, client); // RT-06
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
