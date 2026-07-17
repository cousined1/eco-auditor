import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { insforge, isInsForgeConfigured } from '../lib/insforge';
import {
  SOCIAL_AUTH_PROVIDERS,
  buildOAuthRedirectTo,
  startSocialSignIn,
  type SocialAuthProvider,
} from '../lib/socialAuth';
import { useEffect, useState } from 'react';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const plan = searchParams.get('plan');
  const billing = searchParams.get('billing');
  const safeRedirect =
    redirect && redirect.startsWith('/') && !redirect.startsWith('//')
      ? redirect
      : plan && billing
        ? `/app?checkout=${plan}_${billing}`
        : '/app';

  // ponytail: noindex for SPA-navigated auth views (prerendered static HTML covers direct/crawler loads)
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Already-authenticated users should land in the app, not on the login form.
  // Same auth check App.tsx uses (insforge.auth.getCurrentUser).
  useEffect(() => {
    if (!isInsForgeConfigured) return;
    let cancelled = false;
    async function checkSession() {
      try {
        const { data } = await insforge.auth.getCurrentUser();
        if (cancelled) return;
        if (data?.user) {
          navigate(safeRedirect, { replace: true });
        }
      } catch {
        // Not authenticated — stay on the login form.
      }
    }
    void checkSession();
    return () => { cancelled = true; };
  }, [navigate]);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: authError } = await insforge.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message || 'Invalid email or password.');
        return;
      }

      navigate(safeRedirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

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
              Welcome back. Continue to your emissions ledger, reports, and compliance dashboard.
            </p>
          </div>

          <div className="card space-y-3">
            {!isInsForgeConfigured && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                InsForge is not configured. Set VITE_INSFORGE_BASE_URL and VITE_INSFORGE_ANON_KEY before sign-in can start.
              </div>
            )}

            {/* Email / Password form */}
            <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-3">
              <div>
                <label htmlFor="login-email" className="sr-only">Email address</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm text-surface-900 placeholder-surface-400 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:placeholder-surface-500 dark:focus:border-accent"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="sr-only">Password</label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm text-surface-900 placeholder-surface-400 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:placeholder-surface-500 dark:focus:border-accent"
                />
                <div className="mt-1.5 text-right">
                  <a
                    href="mailto:hello@developer312.com?subject=Password%20reset%20request"
                    className="text-xs text-accent hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || !email.trim() || !password}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1" role="separator" aria-orientation="horizontal">
              <span className="flex-1 border-t border-surface-200 dark:border-surface-700" />
              <span className="text-xs text-surface-400">or continue with</span>
              <span className="flex-1 border-t border-surface-200 dark:border-surface-700" />
            </div>

            {/* OAuth buttons */}
            {SOCIAL_AUTH_PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!isInsForgeConfigured || pendingProvider !== null || submitting}
                onClick={() => void handleSocialLogin(provider.id)}
                className="w-full flex items-center justify-center gap-3 rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm font-semibold text-surface-800 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:hover:bg-surface-800"
              >
                <ProviderIcon provider={provider.id} />
                {pendingProvider === provider.id ? `Redirecting to ${provider.shortLabel}...` : provider.label}
              </button>
            ))}

            {error && (
              <div role="alert" className="rounded-lg border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-sm text-risk-high">
                {error}
              </div>
            )}

            <p className="pt-2 text-center text-xs text-surface-400">
              By continuing, you agree to the <Link to="/terms" className="text-accent hover:underline">Terms</Link> and <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
            </p>
          </div>

          <p className="mt-6 text-center text-sm text-surface-500">
            Don't have an account?{' '}
            <Link to={`/signup${searchParams.toString() ? '?' + searchParams.toString() : ''}`} className="font-medium text-accent hover:underline">
              Sign up
            </Link>
          </p>
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

  if (provider === 'azure') {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#F25022" d="M1 1h10v10H1z" />
        <path fill="#7FBA00" d="M13 1h10v10H13z" />
        <path fill="#00A4EF" d="M1 13h10v10H1z" />
        <path fill="#FFB900" d="M13 13h10v10H13z" />
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
    <svg width="28" height="28" viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <path fill="none" stroke="#06b6d4" strokeWidth="24" strokeLinecap="round" d="M380 310 A150 150 0 0 0 132 310" />
      <polygon points="115,295 132,270 148,298" fill="#06b6d4" />
      <path fill="none" stroke="#1e3a5f" strokeWidth="24" strokeLinecap="round" d="M132 202 A150 150 0 0 0 380 202" />
      <polygon points="397,217 380,242 364,214" fill="#1e3a5f" />
      <path fill="#52b788" d="M256 120 C256 120 200 170 200 260 C200 310 225 350 256 380 C287 350 312 310 312 260 C312 170 256 120 256 120Z" />
      <path fill="#ffffff" d="M256 160 C256 160 225 200 225 260 C225 300 240 330 256 350 C272 330 287 300 287 260 C287 200 256 160 256 160Z" />
      <line x1="256" y1="155" x2="256" y2="365" stroke="#2d6a4f" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
      <circle cx="256" cy="430" r="28" fill="#1e3a5f" />
      <polyline points="242,430 252,440 270,420" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
