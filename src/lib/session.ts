import { insforge } from './insforge';
import { buildApiRequestInit } from './api';

// A real server round-trip to confirm the token is still valid. The browser SDK's
// insforge.auth.getCurrentUser() only reads cached session state, so it never
// detects server-side expiry — this hits an auth-guarded endpoint instead and
// treats a 401 as an expired/invalid session.
export async function isSessionValid(): Promise<boolean> {
  try {
    const res = await fetch('/api/trial-status', buildApiRequestInit(insforge));
    return res.status !== 401;
  } catch {
    // Network/transient error — don't force a logout on a blip.
    return true;
  }
}

function requestPath(input: RequestInfo | URL): string {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith('http') ? new URL(url).pathname : url;
  } catch {
    return '';
  }
}

// Wraps window.fetch so any same-origin /api/* response with status 401 triggers
// onUnauthorized exactly once (e.g. to force re-login on mid-session expiry).
// Auth endpoints are excluded so a failed login doesn't self-trigger. Returns an
// uninstall function that restores the original fetch.
export function installUnauthorizedInterceptor(onUnauthorized: () => void): () => void {
  const original = window.fetch;
  const boundOriginal = original.bind(window);
  let fired = false;
  const patched: typeof fetch = async (input, init) => {
    const res = await boundOriginal(input, init);
    const path = requestPath(input as RequestInfo | URL);
    if (res.status === 401 && path.startsWith('/api/') && !path.startsWith('/api/auth')) {
      if (!fired) {
        fired = true;
        onUnauthorized();
      }
    }
    return res;
  };
  window.fetch = patched;
  return () => {
    if (window.fetch === patched) window.fetch = original;
  };
}
