// Non-component shared pieces for the Login and Signup pages. Kept out of
// AuthShell.tsx because a module that exports both components and helpers
// breaks React Fast Refresh (react-refresh/only-export-components).
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { insforge, isInsForgeConfigured } from '../../lib/insforge';
import { buildOAuthRedirectTo, startSocialSignIn, type SocialAuthProvider } from '../../lib/socialAuth';
import { saveAuthIntent, type AuthIntent } from '../../lib/authIntent';

/** Shared input styling. One string, so the two forms cannot drift visually. */
export const authInputClass =
  'w-full rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm text-surface-900 placeholder-surface-400 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:placeholder-surface-500 dark:focus:border-accent';

/**
 * noindex for SPA-navigated auth views. The prerendered static HTML covers
 * direct and crawler loads; this covers client-side navigation into them.
 */
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}

/**
 * Sends an already-authenticated visitor into the app instead of leaving them
 * on an auth form. Same check App.tsx uses (insforge.auth.getCurrentUser).
 */
export function useRedirectIfAuthenticated(target: string): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isInsForgeConfigured) return;
    let cancelled = false;
    async function checkSession() {
      try {
        const { data } = await insforge.auth.getCurrentUser();
        if (cancelled) return;
        if (data?.user) navigate(target, { replace: true });
      } catch {
        // Not authenticated — stay on the form.
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
    // `target` is included deliberately: Login derives it from the query string,
    // and omitting it was the stale-closure bug eslint was warning about.
  }, [navigate, target]);
}

/**
 * Starts an OAuth sign-in, reporting failure through the caller's error state.
 *
 * The callback URL is fixed (it must match the backend's allowed-redirect
 * list), so any purchase intent is stashed in sessionStorage first and picked
 * up by AuthCallback — otherwise choosing a plan and then "Continue with
 * Google" silently dropped the sale.
 */
export async function startProviderSignIn(
  provider: SocialAuthProvider,
  onError: (message: string) => void,
  intent?: AuthIntent | null,
): Promise<void> {
  saveAuthIntent(intent ?? null);
  // startSocialSignIn is contracted never to throw; this guard keeps an
  // unexpected failure (or a saveAuthIntent/session fault) from leaving the
  // caller's provider button stuck in its pending state with no feedback.
  try {
    const result = await startSocialSignIn({
      provider,
      redirectTo: buildOAuthRedirectTo(window.location.origin, '/auth/callback'),
      auth: insforge.auth,
    });
    if (!result.ok) {
      saveAuthIntent(null);
      onError(result.error);
    }
  } catch (err) {
    saveAuthIntent(null);
    onError(
      err instanceof Error && err.message
        ? err.message
        : `Unable to start ${provider} sign in.`,
    );
  }
}
