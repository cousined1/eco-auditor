import { Link } from 'react-router-dom';
import { insforge, isInsForgeConfigured } from '../lib/insforge';
import {
  SOCIAL_AUTH_PROVIDERS,
  buildOAuthRedirectTo,
  startSocialSignIn,
  type SocialAuthProvider,
} from '../lib/socialAuth';
import { useState } from 'react';

export default function Login() {
  const [pendingProvider, setPendingProvider] = useState<SocialAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSocialLogin(provider: SocialAuthProvider) {
    setPendingProvider(provider);
    setError(null);

    const result = await startSocialSignIn({
      provider,
      redirectTo: buildOAuthRedirectTo(window.location.origin, '/auth/callback'),
      auth: insforge.auth,
    });

    if (!result.ok) {
      setError(result.error);
      setPendingProvider(null);
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
      <header className="border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
            <EcoMark />
            Eco-Auditor
          </Link>
          <Link to="/pricing" className="text-sm text-surface-500 hover:text-surface-900 dark:hover:text-white">
            Pricing
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <section className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Sign in to Eco-Auditor</h1>
            <p className="mt-2 text-sm text-surface-500">
              Continue to your emissions ledger, reports, and compliance dashboard.
            </p>
          </div>

          <div className="card space-y-3">
            {!isInsForgeConfigured && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                InsForge is not configured. Set VITE_INSFORGE_BASE_URL and VITE_INSFORGE_ANON_KEY before OAuth sign-in can start.
              </div>
            )}

            {SOCIAL_AUTH_PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!isInsForgeConfigured || pendingProvider !== null}
                onClick={() => void handleSocialLogin(provider.id)}
                className="w-full flex items-center justify-center gap-3 rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm font-semibold text-surface-800 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:hover:bg-surface-800"
              >
                <ProviderIcon provider={provider.id} />
                {pendingProvider === provider.id ? `Redirecting to ${provider.shortLabel}...` : provider.label}
              </button>
            ))}

            {error && (
              <div className="rounded-lg border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-sm text-risk-high">
                {error}
              </div>
            )}

            <p className="pt-2 text-center text-xs text-surface-400">
              By continuing, you agree to the <Link to="/terms" className="text-accent hover:underline">Terms</Link> and <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function ProviderIcon({ provider }: { provider: SocialAuthProvider }) {
  if (provider === 'google') {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.74-.07-1.45-.19-2.13H12v4.03h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.31 2.98-7.43Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.89 6.62-2.34l-3.23-2.51c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.08v2.59A9.99 9.99 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.41 13.98a6.01 6.01 0 0 1 0-3.96V7.43H3.08a9.99 9.99 0 0 0 0 9.14l3.33-2.59Z" />
        <path fill="#EA4335" d="M12 5.9c1.47 0 2.8.51 3.84 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a9.99 9.99 0 0 0-8.92 5.43l3.33 2.59C7.2 7.66 9.4 5.9 12 5.9Z" />
      </svg>
    );
  }

  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 1.43c0 1.1-.4 2.1-1.2 2.99-.86.96-1.9 1.51-3.02 1.42-.14-1.07.42-2.2 1.17-3.08.82-.97 2.18-1.7 3.05-1.33ZM20.2 17.12c-.52 1.19-.77 1.72-1.43 2.77-.93 1.43-2.24 3.22-3.86 3.24-1.44.02-1.81-.94-3.77-.93-1.96.01-2.37.96-3.81.94-1.62-.02-2.86-1.63-3.79-3.06-2.6-4-2.88-8.68-1.27-11.17 1.15-1.77 2.96-2.8 4.66-2.8 1.73 0 2.82.95 4.25.95 1.39 0 2.24-.95 4.24-.95 1.51 0 3.11.82 4.25 2.24-3.73 2.04-3.12 7.37.53 8.77Z" />
    </svg>
  );
}

function EcoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-brand-600 dark:text-brand-400" />
      <path d="M16 8V24M11 13C13 10 19 10 21 13M11 19C13 16 19 16 21 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-brand-500 dark:text-brand-300" />
      <circle cx="16" cy="16" r="3.5" className="fill-accent dark:fill-accent-light" />
    </svg>
  );
}
