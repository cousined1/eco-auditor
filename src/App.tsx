import { Routes, Route, NavLink, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { startTransition, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFocusTrap } from './hooks/useFocusTrap';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import { useGTM } from './lib/gtm';
import { insforge } from './lib/insforge';
import { onSessionExpired } from './lib/api';
import { useCompanyName } from './lib/companyName';
import { isSessionValid } from './lib/session';
import type { AuthNoticeState } from './components/auth/authHelpers';
import { VERIFY_EMAIL_PATH } from './components/auth/emailVerification';
import { createCheckoutSession, verifyCheckoutSession } from './lib/stripe';
// The public pages come from one module with two builds: static for the prerender
// step, the tests and dev, route-level chunks in the production client build
// (F-F-14). See src/routePages.ts.
import {
  AuthCallback,
  BlogList,
  BlogPostPage,
  ContactUs,
  DataProcessingAddendum,
  Demo,
  ForgotPassword,
  LandingPage,
  Login,
  MethodologyPublic,
  NotFound,
  Pricing,
  PrivacyPolicy,
  SampleReport,
  Security,
  Signup,
  TermsOfService,
  VerifyEmailCode,
} from '@/routePages';
import Footer from './components/Footer';
import Header from './components/Header';
import BrandMark from './components/BrandMark';
import ConnectionProblemBanner from './components/ConnectionProblemBanner';
import ScrollManager from './components/ScrollManager';
import SkipLink from './components/SkipLink';
import ThemeToggle from './components/ThemeToggle';
import TrialPill from './components/TrialPill';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyRoute, retryChunkLoads } from './lib/chunkRecovery';

// Authenticated surfaces are split out of the entry graph. Every one of these
// is behind the /app auth gate and none is prerendered, so an anonymous visitor
// on the landing page no longer downloads them — most importantly Dashboard and
// the calculator, which pull in recharts (~112KB gzipped of charting an
// unauthenticated visitor can never see).
//
// The public pages are static in the prerender and lazy in the client build, see
// src/routePages.ts: renderToString() cannot resolve a lazy chunk, so the
// prerender needs them imported.
//
// lazyRoute is React.lazy plus recovery from a chunk that will not load
// (offline, or a tab left open across a deploy): see src/lib/chunkRecovery.ts.
const Dashboard = lazyRoute(() => import('./pages/Dashboard'), 'Dashboard');
const DataIntake = lazyRoute(() => import('./pages/DataIntake'), 'DataIntake');
const AIAssistant = lazyRoute(() => import('./pages/AIAssistant'), 'AIAssistant');
const Ledger = lazyRoute(() => import('./pages/Ledger'), 'Ledger');
const Reports = lazyRoute(() => import('./pages/Reports'), 'Reports');
const Suppliers = lazyRoute(() => import('./pages/Suppliers'), 'Suppliers');
const Methodology = lazyRoute(() => import('./pages/Methodology'), 'Methodology');
const Settings = lazyRoute(() => import('./pages/Settings'), 'Settings');
const CarbonCalculator = lazyRoute(() => import('./components/carbon-calculator'), 'CarbonCalculator');
// First-run onboarding for a company the server created (F-B-03): wraps the routes
// that would otherwise be the first screen, and is authenticated-only like them.
const OnboardingGate = lazyRoute(() => import('./components/onboarding/OnboardingGate'), 'OnboardingGate');

// The authenticated mobile navigation, as a real modal dialog.
//
// It previously rendered as a bare <div>: opening it left focus on the trigger
// button, Tab walked straight through into the page behind, Escape did nothing,
// and assistive tech was never told the rest of the page was inert. useFocusTrap
// already implements all four behaviours (focus in, Tab containment, Escape,
// focus return) and was written for exactly this — it was just only wired up to
// the cookie-preferences dialog. Extracted into its own component because the
// hook must be called unconditionally, and the drawer renders conditionally.
function MobileNavDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-surface-950/50"
        aria-label="Close navigation menu"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        id="app-mobile-navigation"
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        className="relative z-50 flex h-full w-72 max-w-[85vw] flex-col border-r border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-xl"
      >
        {children}
      </aside>
    </div>
  );
}

// Shown while an /app chunk is in flight. Matches the Dashboard's own loading
// treatment so the transition does not read as a different kind of wait.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-96" role="status" aria-live="polite">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4"></div>
        <p className="text-surface-600 dark:text-surface-400">Loading…</p>
      </div>
    </div>
  );
}

const LEGAL_PATHS = ['/privacy', '/terms', '/dpa', '/contact'];

// `soon` marks destinations that render a ComingSoon stub. Half the sidebar
// led to placeholders with nothing to distinguish them, so the only way to
// find out was to click — which reads as a broken app rather than a roadmap.
const NAV_ITEMS = [
  { to: '/app', label: 'Dashboard', icon: DashboardIcon, end: true },
  { to: '/app/intake', label: 'Data Intake', icon: DataIcon },
  { to: '/app/calculator', label: 'Calculator', icon: CalculatorIcon },
  { to: '/app/assistant', label: 'AI Assistant', icon: AssistantIcon, soon: true },
  { to: '/app/ledger', label: 'Ledger', icon: LedgerIcon, soon: true },
  { to: '/app/reports', label: 'Reports', icon: ReportsIcon },
  { to: '/app/suppliers', label: 'Suppliers', icon: SuppliersIcon, soon: true },
  { to: '/app/methodology', label: 'Methodology', icon: MethodologyIcon, soon: true },
  { to: '/app/pricing', label: 'Pricing', icon: PricingIcon },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
];

type AppUser = { email: string; name: string; initials: string; companyName?: string };

type SidebarContentProps = {
  user: AppUser | null;
  onLogout: () => void;
  onNavigate?: () => void;
};

function TrackPageViews() {
  const location = useLocation();
  const { trackPageView } = useGTM();

  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location, trackPageView]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* First in the document, so it comes before the page in the tab order and
          in reading order (F-C-07). Last, it took every link on the page to reach
          by Tab; first, Shift+Tab from the page content gets to it after the
          header's few controls. (ScrollManager leaves focus alone at load, so the
          first Tab reaches this bar, and the skip link once it is answered: D-6.)
          It is a fixed bar, so its place in the DOM does not change where it is
          drawn. */}
      <CookieConsentBanner />
      <AppContent />
      <TrackPageViews />
      <ScrollManager />
    </ErrorBoundary>
  );
}

function AppContent() {
  const locationInfo = useLocation();
  // express.static 301-redirects bare marketing paths to their trailing-slash
  // form (/privacy -> /privacy/), and the prerenderer declares that slashed URL
  // canonical. The <Route> paths below tolerate it because react-router appends
  // an optional-slash terminator, but the two manual comparisons here did not —
  // so every direct load, refresh, or shared link to a legal page fell through
  // to the catch-all 404. Normalise once, before both checks.
  const location = locationInfo.pathname.replace(/\/+$/, '') || '/';
  const navigate = useNavigate();
  const isLegalPage = LEGAL_PATHS.includes(location);
  // Exact '/app' or a '/app/' subpath — NOT '/apple', '/application', etc.
  const isAppPage = location === '/app' || location.startsWith('/app/');

  const [user, setUser] = useState<AppUser | null>(null);
  // The company's own name, once a screen has loaded it (the auth profile never holds one).
  const companyName = useCompanyName();
  const [authStatus, setAuthStatus] = useState<'loading' | 'authed' | 'anon'>('loading');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Close the mobile nav on navigation. Render-time state adjustment
  // (https://react.dev/learn/you-might-not-need-an-effect) instead of an effect.
  const [prevLocation, setPrevLocation] = useState(location);
  if (prevLocation !== location) {
    setPrevLocation(location);
    setMobileNavOpen(false);
  }

  useEffect(() => {
    if (!isAppPage) return;
    let cancelled = false;
    async function loadUser() {
      try {
        const { data } = await insforge.auth.getCurrentUser();
        if (cancelled) return;
        if (!data?.user) {
          setAuthStatus('anon');
          return;
        }
        const email = data.user.email || '';
        const profileName = readStringProperty(data.user.profile, 'name');
        const metaName = readStringProperty(data.user.metadata, 'name');
        const name = profileName || metaName || email.split('@')[0] || 'User';
        const initials = name.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
        const companyName =
          readStringProperty(data.user.profile, 'company_name') ||
          readStringProperty(data.user.metadata, 'company_name') ||
          readStringProperty(data.user.metadata, 'company') ||
          readStringProperty(data.user, 'company_name');
        setUser(companyName ? { email, name, initials, companyName } : { email, name, initials });
        setAuthStatus('authed');
      } catch {
        if (!cancelled) setAuthStatus('anon');
      }
    }
    void loadUser();
    return () => { cancelled = true; };
  }, [isAppPage]);

  // Read through a ref so the effect below is set up once per signed-in app
  // session: `navigate` changes identity on every pathname change, and keying
  // the effect on it tore the expiry handling down on each navigation.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // #81: Real mid-session expiry detection. The browser SDK's getCurrentUser()
  // only reads cached session state, so re-validation must hit the server.
  // (a) Every server call goes through apiFetch (src/lib/api.ts), which
  // refreshes an expired access token and calls onSessionExpired only when the
  // session cannot be recovered; (b) we proactively re-validate against an
  // auth-guarded endpoint on an interval and whenever the tab regains focus.
  useEffect(() => {
    if (!isAppPage || authStatus !== 'authed') return;
    let done = false;
    const forceReauth = async () => {
      if (done) return;
      done = true;
      // Clear the SDK's cached session BEFORE navigating, and await it.
      //
      // Resetting only React state left the SDK holding accessToken + user in
      // memory, and getCurrentUser() answers from that cache without a network
      // call — so /login's useRedirectIfAuthenticated saw a "valid" user and
      // sent the browser straight back to /app. That produced a burst of
      // redirects (/app -> /login -> /app -> …) which settled on /app showing a
      // fully rendered dashboard shell, sidebar and the user's own email, while
      // every API call underneath returned 401. It looked signed in and was not.
      //
      // The await matters: firing signOut() without waiting loses the race
      // against the login page's own session check, which reads the still-warm
      // cache and bounces back — the redirect burst reproduced unchanged.
      // signOut() also revokes the session server-side; if that request fails
      // the local cache is cleared regardless, which is the part that fixes
      // this, so the rejection is deliberately swallowed.
      try {
        await insforge.auth.signOut();
      } catch {
        /* local session is cleared either way */
      }
      // Preserve where the user was so re-login returns them there. Login
      // already honors ?redirect=; sending a bare /login discarded the deep
      // link and any pending ?checkout= intent on a mid-session expiry.
      const returnTo = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      const state: AuthNoticeState = { authNotice: 'session-expired' };
      // One transition for the reset and the navigation. BrowserRouter applies
      // navigations inside startTransition, so a plain setAuthStatus('anon')
      // rendered the signed-out <Navigate> below first, with the old location;
      // its navigation replaced this one and dropped the notice.
      startTransition(() => {
        setUser(null);
        setAuthStatus('anon');
        navigateRef.current(`/login?redirect=${returnTo}`, { replace: true, state });
      });
    };
    // No handling of the result: apiFetch reports an unrecoverable session
    // itself, and a transient failure must not sign anyone out.
    const revalidate = () => {
      void isSessionValid();
    };
    const unregister = onSessionExpired(() => { void forceReauth(); });
    const intervalId = window.setInterval(revalidate, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      unregister();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAppPage, authStatus]);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    const params = new URLSearchParams(locationInfo.search);
    const sessionId = params.get('session_id');
    const checkout = params.get('checkout');
    let replaced = false;

    if (sessionId) {
      params.delete('session_id');
      replaced = true;
      queueMicrotask(() => {
        setCheckoutBanner({
          message: 'Welcome back! Confirming your subscription…',
          type: 'success',
        });
      });
      // Don't rely on the webhook alone. If it has not landed yet, or failed
      // and is still being retried, the customer would sit behind the paywall
      // they just paid to remove. This reconciles against Stripe directly.
      void (async () => {
        const result = await verifyCheckoutSession(sessionId);
        if (!result.ok) {
          // Verification actually failed (expired session, 5xx, network). Never
          // claim the payment landed — send the customer somewhere actionable
          // instead (FEW-02).
          setCheckoutBanner({
            message: 'We could not confirm your payment yet — check Settings → Billing or contact support.',
            type: 'error',
          });
          return;
        }
        setCheckoutBanner(
          result.data.verified
            ? { message: 'Your subscription is active. Thanks!', type: 'success' }
            : {
                message:
                  'Payment received. Your subscription is still being finalized — it should appear in Settings → Billing shortly.',
                type: 'success',
              },
        );
      })();
    }

    if (checkout) {
      const [planId, billing] = checkout.split('_');
      if (planId && (billing === 'monthly' || billing === 'annual')) {
        params.delete('checkout');
        replaced = true;
        void (async () => {
          const result = await createCheckoutSession({ priceId: `${planId}_${billing}`, planId, billing, trial: billing === 'monthly' });
          if (result.ok) {
            window.location.assign(result.data.url);
          } else {
            setCheckoutBanner({ message: result.error || 'Could not start checkout. Please try again.', type: 'error' });
          }
        })();
      }
    }

    if (replaced) {
      navigate({ pathname: locationInfo.pathname, search: params.toString() }, { replace: true });
    }
  }, [authStatus, locationInfo.pathname, locationInfo.search, navigate]);

  async function handleLogout() {
    // signOut hits /api/auth/logout to kill the server session. Log (don't
    // swallow) failures so a session that fails to end is visible, then clear
    // local state and reload regardless so the UI never shows a stale session.
    try {
      await insforge.auth.signOut();
    } catch (err) {
      console.warn('Sign-out request failed; clearing local session anyway.', err);
    }
    setUser(null);
    setAuthStatus('anon');
    navigate('/login', { replace: true });
    window.location.reload();
  }

  /* ─── Legal pages (standalone layout) ─── */
  if (isLegalPage) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Header variant="legal" />
        <main id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/dpa" element={<DataProcessingAddendum />} />
            <Route path="/contact" element={<ContactUs />} />
          </Routes>
        </main>
        <Footer />
      </div>
    );
  }

  /* ─── App shell (sidebar + dashboard pages) ─── */
  if (isAppPage) {
    if (authStatus === 'loading') {
      return (
        <div className="flex h-screen items-center justify-center bg-surface-50 dark:bg-surface-950">
          <div className="text-sm text-surface-500" role="status">Loading…</div>
        </div>
      );
    }
    if (authStatus === 'anon') {
      const returnTo = encodeURIComponent(locationInfo.pathname + locationInfo.search);
      return <Navigate to={`/login?redirect=${returnTo}`} replace />;
    }
    return (
      <div className="flex h-screen overflow-hidden bg-surface-50 dark:bg-surface-950">
        <SkipLink />
        {mobileNavOpen && (
          <MobileNavDrawer onClose={() => setMobileNavOpen(false)}>
            <SidebarContent user={user} onLogout={handleLogout} onNavigate={() => setMobileNavOpen(false)} />
          </MobileNavDrawer>
        )}

        <aside className="hidden md:flex flex-col w-60 border-r border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
          <SidebarContent user={user} onLogout={handleLogout} />
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="flex items-center justify-between px-6 py-3 border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
            <div className="flex items-center gap-3 md:hidden">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="p-1.5 -ml-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
                aria-label="Open navigation menu"
                aria-controls="app-mobile-navigation"
                aria-expanded={mobileNavOpen}
              >
                <MenuIcon />
              </button>
              <BrandMark />
              <span className="font-semibold text-sm">Eco-Auditor</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <span className="truncate max-w-[200px]">{companyName || user?.companyName || 'Your organization'}</span>
              <span className="text-surface-300">/</span>
              <span className="font-medium text-surface-800 dark:text-surface-200">FY {new Date().getFullYear()}</span>
            </div>
            <div className="flex items-center gap-3">
              <TrialPill />
              <ThemeToggle />
            </div>
          </header>

          <ConnectionProblemBanner />

          {checkoutBanner && (
            <div
              className={`px-6 py-3 border-b ${
                checkoutBanner.type === 'success'
                  ? 'bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-800'
                  : 'bg-risk-high/10 border-risk-high/20'
              }`}
              role={checkoutBanner.type === 'error' ? 'alert' : 'status'}
            >
              <div className="flex items-center justify-between gap-4">
                <span
                  className={`text-sm ${
                    checkoutBanner.type === 'success'
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-risk-high'
                  }`}
                >
                  {checkoutBanner.message}
                </span>
                <button
                  type="button"
                  onClick={() => setCheckoutBanner(null)}
                  className="text-xs text-surface-500 hover:text-surface-800 dark:hover:text-surface-200"
                  aria-label="Dismiss"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
            <Suspense fallback={<RouteFallback />}>
              {/* A page that fails (a chunk that will not load, or a render error)
                  is contained here, so the sidebar and navigation survive it. */}
              <ErrorBoundary inShell resetKey={locationInfo.key} onReset={retryChunkLoads}>
                <Routes>
                  {/* The onboarding gate shows onboarding instead of these while a
                      company the server created is unnamed and has not chosen
                      "Finish later"; Settings and Pricing stay reachable without it. */}
                  <Route element={<OnboardingGate />}>
                    <Route path="/app" element={<Dashboard />} />
                    <Route path="/app/intake" element={<DataIntake />} />
                    <Route path="/app/calculator" element={<CarbonCalculator />} />
                    <Route path="/app/reports" element={<Reports />} />
                  </Route>
                  <Route path="/app/assistant" element={<AIAssistant />} />
                  <Route path="/app/ledger" element={<Ledger />} />
                  <Route path="/app/suppliers" element={<Suppliers />} />
                  <Route path="/app/methodology" element={<Methodology />} />
                  <Route path="/app/pricing" element={<Pricing embedded />} />
                  <Route path="/app/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound title="Page not found" message="That section of the app does not exist." homeHref="/app" />} />
                </Routes>
              </ErrorBoundary>
            </Suspense>
          </main>
        </div>
      </div>
    );
  }

  /* ─── Public pages (landing, marketing, auth) ─── */
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
          <Header variant="marketing" />
          <main id="main-content" tabIndex={-1} className="flex-1">
            <Pricing />
          </main>
          <Footer />
        </div>
      } />
      <Route path="/methodology" element={<MethodologyPublic />} />
      <Route path="/sample-report" element={<SampleReport />} />
      <Route path="/security" element={<Security />} />
      <Route path="/blog" element={
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
          <BlogList />
        </div>
      } />
      <Route path="/blog/:slug" element={
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
          <BlogPostPage />
        </div>
      } />
      <Route path="/demo" element={<Demo />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path={VERIFY_EMAIL_PATH} element={<VerifyEmailCode />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function SidebarContent({ user, onLogout, onNavigate }: SidebarContentProps) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-surface-200 dark:border-surface-800">
        <Link to="/" onClick={onNavigate} aria-label="Eco-Auditor home">
          <BrandMark />
        </Link>
        <div>
          <Link to="/" onClick={onNavigate} className="font-semibold text-sm text-surface-900 dark:text-white tracking-tight hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Eco-Auditor</Link>
          <div className="text-2xs text-surface-500">Carbon Accounting</div>
        </div>
      </div>
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-3 px-3 scrollbar-thin">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end || false}
            aria-label={item.soon ? `${item.label} (coming soon)` : item.label}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                isActive
                  ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                  : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'
              }`
            }
          >
            <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {item.label}
            {item.soon && (
              <span className="ml-auto rounded-full bg-surface-100 px-1.5 py-0.5 text-2xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                Soon
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-surface-200 dark:border-surface-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-800 flex items-center justify-center text-xs font-semibold text-brand-700 dark:text-brand-200">
            {user?.initials || '??'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">
              {user?.name || 'User'}
            </div>
            <div className="text-2xs text-surface-500 truncate">
              {user?.email || ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-risk-high transition-colors"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogoutIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="5.5" height="5.5" rx="1"/><rect x="9.5" y="1" width="5.5" height="5.5" rx="1"/><rect x="1" y="9.5" width="5.5" height="5.5" rx="1"/><rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1"/></svg>;
}
function DataIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h12M2 8h12M2 12h8"/><path d="M12 10l2 2-2 2"/></svg>;
}
function AssistantIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5 9s1 2 3 2 3-2 3-2"/><circle cx="6" cy="7" r="0.5" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="0.5" fill="currentColor" stroke="none"/></svg>;
}
function LedgerIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h12v12H2z"/><path d="M5 2v12M2 5h12M2 8h12M2 11h12"/></svg>;
}
function ReportsIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3"/><path d="M5 8h6M5 10h6M5 12h3"/></svg>;
}
function SuppliersIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4 4-4s4 1.5 4 4"/><path d="M7 13c0-2.5 2-4 4-4s4 1.5 4 4"/></svg>;
}
function MethodologyIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2l4 3-4 3"/><path d="M8 12h5"/></svg>;
}
function PricingIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M6.5 6.5a1.5 1.5 0 011.5-1.5h0a1.5 1.5 0 011.5 1.5c0 .83-.67 1-1.5 1.5s-1.5.67-1.5 1.5M8 11v.5"/></svg>;
}
function CalculatorIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="1" width="12" height="14" rx="1"/><path d="M5 4h6M5 7h2M9 7h2M5 10h2M9 10h2M5 13h6"/></svg>;
}
function SettingsIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>;
}
function MenuIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>;
}
function LogoutIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3"/><path d="M10.5 11.5L14 8l-3.5-3.5"/><path d="M14 8H6"/></svg>;
}
