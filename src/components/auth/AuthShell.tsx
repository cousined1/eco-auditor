// Shared chrome and behaviour for the Login and Signup pages, which carried
// ~160 lines of verbatim duplication between them: the page shell, the logo,
// the provider icons, the OAuth button list, the input styling, and both
// effects. Divergence here is a real risk — the two pages are one flow, and a
// fix applied to only one of them is a bug users hit on the other.
// Hooks, the shared input class, and the OAuth starter live in ./authHelpers —
// a module exporting both components and helpers breaks React Fast Refresh.
import { Link } from 'react-router-dom';
import { isInsForgeConfigured } from '../../lib/insforge';
import { SOCIAL_AUTH_PROVIDERS, type SocialAuthProvider } from '../../lib/socialAuth';

type AuthShellProps = {
  readonly children: React.ReactNode;
  /** Centres the section, for the post-signup verification screen. */
  readonly centered?: boolean;
};

/** Page chrome: header with logo and Pricing link, then a centred card column. */
export function AuthShell({ children, centered }: AuthShellProps) {
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
        <section className={centered ? 'w-full max-w-md text-center' : 'w-full max-w-md'}>{children}</section>
      </main>
    </div>
  );
}

/** Heading block above the auth card. */
export function AuthHeading({ title, subtitle }: { readonly title: string; readonly subtitle: string }) {
  return (
    <div className="mb-8 text-center">
      <h1 className="text-2xl font-bold text-surface-900 dark:text-white">{title}</h1>
      <p className="mt-2 text-sm text-surface-500">{subtitle}</p>
    </div>
  );
}

/** Shown when InsForge credentials are missing, so the form's failure is legible. */
export function ConfigWarning({ action }: { readonly action: string }) {
  if (isInsForgeConfigured) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      InsForge is not configured. Set VITE_INSFORGE_BASE_URL and VITE_INSFORGE_ANON_KEY before {action} can start.
    </div>
  );
}

type SocialAuthButtonsProps = {
  readonly pendingProvider: SocialAuthProvider | null;
  readonly disabled: boolean;
  readonly onSelect: (provider: SocialAuthProvider) => void;
};

/** "or continue with" divider plus one button per configured OAuth provider. */
export function SocialAuthButtons({ pendingProvider, disabled, onSelect }: SocialAuthButtonsProps) {
  return (
    <>
      <div className="flex items-center gap-3 py-1" role="separator" aria-orientation="horizontal">
        <span className="flex-1 border-t border-surface-200 dark:border-surface-700" />
        <span className="text-xs text-surface-400">or continue with</span>
        <span className="flex-1 border-t border-surface-200 dark:border-surface-700" />
      </div>
      {SOCIAL_AUTH_PROVIDERS.map((provider) => (
        <button
          key={provider.id}
          type="button"
          disabled={!isInsForgeConfigured || pendingProvider !== null || disabled}
          onClick={() => onSelect(provider.id)}
          className="w-full flex items-center justify-center gap-3 rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm font-semibold text-surface-800 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:hover:bg-surface-800"
        >
          <ProviderIcon provider={provider.id} />
          {pendingProvider === provider.id ? `Redirecting to ${provider.shortLabel}...` : provider.label}
        </button>
      ))}
    </>
  );
}

export function AuthError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-sm text-risk-high">
      {message}
    </div>
  );
}

export function TermsNotice() {
  return (
    <p className="pt-2 text-center text-xs text-surface-400">
      By continuing, you agree to the <Link to="/terms" className="text-accent hover:underline">Terms</Link> and{' '}
      <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
    </p>
  );
}

/** Spinner + label for a submitting button, matching both forms' treatment. */
export function SubmitLabel({ submitting, idle, busy }: { readonly submitting: boolean; readonly idle: string; readonly busy: string }) {
  if (!submitting) return <>{idle}</>;
  return (
    <>
      <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
      {busy}
    </>
  );
}

function ProviderIcon({ provider }: { readonly provider: SocialAuthProvider }) {
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

export function EcoMark() {
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
