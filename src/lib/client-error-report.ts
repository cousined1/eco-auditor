/**
 * Browser error reporting (F-G-08, F-F-08). A render crash (ErrorBoundary), an
 * uncaught error or an unhandled rejection used to reach only the visitor's own
 * console, so a broken page was found by a customer. Each is now posted to
 * POST /api/client-error (server-observability.cjs), which logs it.
 *
 * What is sent: the error message, its stack, where it came from, and the page
 * PATH (never the query string or fragment, which can carry tokens or an email).
 * It is a plain public POST with no cookies (credentials: 'omit') and no bearer
 * token, and it holds no personal data, so it is not gated by the cookie banner.
 * A page load sends at most MAX_REPORTS_PER_PAGE reports, each distinct once.
 * Reporting never throws and never retries.
 */

export type ClientErrorSource = 'boundary' | 'error' | 'unhandledrejection';

const ENDPOINT = '/api/client-error';
const MAX_REPORTS_PER_PAGE = 5;
// The server rejects anything longer; trim here so a long stack still arrives.
const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
const MAX_PATH = 200;

const reported = new Set<string>();

function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const message = error.message || error.name || 'Error';
    return typeof error.stack === 'string' ? { message, stack: error.stack } : { message };
  }
  // A non-Error reason is described by its type, never serialised: an object
  // could hold anything.
  if (typeof error === 'string' && error) return { message: error };
  return { message: 'Non-Error value: ' + Object.prototype.toString.call(error) };
}

export function reportClientError(error: unknown, source: ClientErrorSource): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  const { message, stack } = describeError(error);
  const key = source + ':' + message;
  if (reported.has(key) || reported.size >= MAX_REPORTS_PER_PAGE) return;
  reported.add(key);

  const body: Record<string, string> = {
    source,
    message: message.slice(0, MAX_MESSAGE),
    route: window.location.pathname.slice(0, MAX_PATH),
  };
  if (stack) body.stack = stack.slice(0, MAX_STACK);
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting an error must never cause one.
  }
}

/** Hooks window 'error' and 'unhandledrejection'; returns the unhook function. */
export function installClientErrorReporting(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    // A cross-origin script error arrives as "Script error." with no detail: nothing to act on.
    if (!event.error && /^Script error\.?$/.test(event.message)) return;
    reportClientError(event.error ?? event.message, 'error');
  };
  const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, 'unhandledrejection');
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
