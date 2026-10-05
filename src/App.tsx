import { Routes, Route, NavLink, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTheme } from './hooks/useTheme';
import { useFocusTrap } from './hooks/useFocusTrap';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import { useGTM } from './lib/gtm';
import { insforge } from './lib/insforge';
import { isSessionValid, installUnauthorizedInterceptor } from './lib/session';
import { createCheckoutSession, verifyCheckoutSession } from './lib/stripe';
import { readIntentFromCheckout } from './lib/authIntent';
import LandingPage from './pages/LandingPage';
import BlogList from './pages/BlogList';
import BlogPostPage from './pages/BlogPost';
import MethodologyPublic from './pages/MethodologyPublic';
import SampleReport from './pages/SampleReport';
import Security from './pages/Security';
import Pricing from './pages/Pricing';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import ContactUs from './pages/ContactUs';
import Demo from './pages/Demo';
import DataProcessingAddendum from './pages/DataProcessingAddendum';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import AuthCallback from './pages/AuthCallback';
import NotFound from './pages/NotFound';
import Footer from './components/Footer';
import Header from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';

// Authenticated surfaces are split out of the entry graph. Every one of these
// is behind the /app auth gate and none is prerendered, so an anonymous visitor
// on the landing page no longer downloads them — most importantly Dashboard and
// the calculator, which pull in recharts (~112KB gzipped of charting an
// unauthenticated visitor can never see).
//
// The prerendered marketing routes above stay static on purpose:
// scripts/prerender.mjs calls renderToString(), which cannot resolve a lazy
// chunk, so making those lazy would empty the prerendered HTML.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DataIntake = lazy(() => import('./pages/DataIntake'));
const AIAssistant = lazy(() => import('./pages/AIAssistant'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Reports = lazy(() => import('./pages/Reports'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Settings = lazy(() => import('./pages/Settings'));
const CarbonCalculator = lazy(() => import('./components/carbon-calculator'));

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
  { to: '/app/reports', label: 'Reports', icon: ReportsIcon, soon: true },
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

  // A SPA keeps the scroll position across navigations, so moving from a
  // scrolled landing page to /pricing used to land mid-page. Reset scroll and
  // move focus to the main landmark, which also gives keyboard and screen
  // reader users a defined starting point instead of leaving focus on the link
  // they just followed.
  useEffect(() => {
    if (location.hash) {
      // In-page anchor: honour the target rather than jumping to the top.
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
      return;
    }
    window.scrollTo(0, 0);
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname, location.hash]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
      <CookieConsentBanner />
      <TrackPageViews />
    </ErrorBoundary>
  );
}

function AppContent() {
  const { theme, toggle } = useTheme();
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
  const [authStatus, setAuthStatus] = useState<'loading' | 'authed' | 'anon'>('loading');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // The purchase intent survives a failed checkout so the banner can offer a
  // real retry instead of stranding the customer on an empty dashboard.
  const [pendingCheckout, setPendingCheckout] = useState<{ plan: string; billing: 'monthly' | 'annual' } | null>(null);
  const [retryingCheckout, setRetryingCheckout] = useState(false);

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

  // #81: Real mid-session expiry detection. The browser SDK's getCurrentUser()
  // only reads cached session state, so re-validation must hit the server.
  // We (a) intercept any /api/* 401 to force re-login immediately, and
  // (b) proactively re-validate against an auth-guarded endpoint on an interval
  // and whenever the tab regains focus.
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
      setUser(null);
      setAuthStatus('anon');
      // Preserve where the user was so re-login returns them there. Login
      // already honors ?redirect=; sending a bare /login discarded the deep
      // link and any pending ?checkout= intent on a mid-session expiry.
      const returnTo = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      navigate(`/login?redirect=${returnTo}`, { replace: true });
    };
    const revalidate = async () => {
      const ok = await isSessionValid();
      if (!ok) void forceReauth();
    };
    const uninstall = installUnauthorizedInterceptor(() => { void forceReauth(); });
    const intervalId = window.setInterval(revalidate, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void revalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      uninstall();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAppPage, authStatus, navigate]);

  // Starts (or retries) the Stripe checkout for a purchase intent. Shared by the
  // ?checkout= trigger and the "Retry checkout" banner button so both paths
  // build an identical request.
  async function startCheckout(planId: string, billing: 'monthly' | 'annual') {
    return createCheckoutSession({
      priceId: `${planId}_${billing}`,
      planId,
      billing,
      trial: billing === 'monthly',
    });
  }

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
      const intent = readIntentFromCheckout(checkout);
      if (intent) {
        const { plan: planId, billing } = intent;
        // Strip the trigger only once checkout actually succeeds — on success
        // the browser leaves for Stripe, so the param is irrelevant, and on
        // failure keeping it means a refresh re-attempts instead of silently
        // dropping a purchase the customer already chose.
        void (async () => {
          const result = await startCheckout(planId, billing);
          if (result.ok) {
            window.location.assign(result.data.url);
          } else {
            setPendingCheckout(intent);
            setCheckoutBanner({
              message: result.error || 'Could not start checkout. Please try again.',
              type: 'error',
            });
          }
        })();
      }
    }

    if (replaced) {
      navigate({ pathname: locationInfo.pathname, search: params.toString() }, { replace: true });
    }
  }, [authStatus, locationInfo.pathname, locationInfo.search, navigate]);

  async function handleRetryCheckout() {
    if (!pendingCheckout || retryingCheckout) return;
    setRetryingCheckout(true);
    const intent = pendingCheckout;
    const result = await startCheckout(intent.plan, intent.billing);
    setRetryingCheckout(false);
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setCheckoutBanner({
      message: result.error || 'Could not start checkout. Please try again.',
      type: 'error',
    });
  }

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
        <Header
          variant="legal"
          extra={
            <button type="button" onClick={toggle} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
          }
        />
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
              <EcoLogo />
              <span className="font-semibold text-sm">Eco-Auditor</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <span className="truncate max-w-[200px]">{user?.companyName || 'Your organization'}</span>
              <span className="text-surface-300">/</span>
              <span className="font-medium text-surface-800 dark:text-surface-200">FY {new Date().getFullYear()}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? <MoonIcon /> : <SunIcon />}
              </button>
            </div>
          </header>

          {checkoutBanner && (
            <div
              className={`px-6 py-3 border-b ${
                checkoutBanner.type === 'success'
                  ? 'bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-800'
                  : 'bg-risk-high/10 border-risk-high/20'
              }`}
              role="status"
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
                {pendingCheckout && checkoutBanner?.type === 'error' && (
                    <button
                      type="button"
                      onClick={() => void handleRetryCheckout()}
                      disabled={retryingCheckout}
                      className="text-xs font-medium px-3 py-1 rounded-md border border-risk-high/30 text-risk-high hover:bg-risk-high/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {retryingCheckout ? 'Retrying…' : 'Retry checkout'}
                    </button>
                  )}
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

          {/* The route-change effect focuses #main-content on navigation. Every
              other shell in the app defines it; /app did not, so the focus move
              was a silent no-op and keyboard/screen-reader users had no named
              main landmark on the paid pages. */}
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/app" element={<Dashboard />} />
                <Route path="/app/intake" element={<DataIntake />} />
                <Route path="/app/calculator" element={<CarbonCalculator />} />
                <Route path="/app/assistant" element={<AIAssistant />} />
                <Route path="/app/ledger" element={<Ledger />} />
                <Route path="/app/reports" element={<Reports />} />
                <Route path="/app/suppliers" element={<Suppliers />} />
                <Route path="/app/methodology" element={<Methodology />} />
                <Route path="/app/pricing" element={<Pricing />} />
                <Route path="/app/settings" element={<Settings />} />
                <Route path="*" element={<NotFound title="Page not found" message="That section of the app does not exist." homeHref="/app" />} />
              </Routes>
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
        <Link to="/" onClick={onNavigate}>
          <EcoLogo />
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

function EcoLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Bottom cycle arrow — teal */}
      <path fill="none" stroke="#06b6d4" strokeWidth="24" strokeLinecap="round" d="M380 310 A150 150 0 0 0 132 310" />
      <polygon points="115,295 132,270 148,298" fill="#06b6d4" />
      {/* Top cycle arrow — navy */}
      <path fill="none" stroke="#1e3a5f" strokeWidth="24" strokeLinecap="round" d="M132 202 A150 150 0 0 0 380 202" />
      <polygon points="397,217 380,242 364,214" fill="#1e3a5f" />
      {/* Abstract leaf */}
      <path fill="#52b788" d="M256 120 C256 120 200 170 200 260 C200 310 225 350 256 380 C287 350 312 310 312 260 C312 170 256 120 256 120Z" />
      <path fill="#ffffff" d="M256 160 C256 160 225 200 225 260 C225 300 240 330 256 350 C272 330 287 300 287 260 C287 200 256 160 256 160Z" />
      <line x1="256" y1="155" x2="256" y2="365" stroke="#2d6a4f" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
      {/* Checkmark badge */}
      <circle cx="256" cy="430" r="28" fill="#1e3a5f" />
      <polyline points="242,430 252,440 270,420" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
function MoonIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 018 2.5a5.5 5.5 0 010 11z"/></svg>;
}
function SunIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>;
}
function MenuIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>;
}
function LogoutIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3"/><path d="M10.5 11.5L14 8l-3.5-3.5"/><path d="M14 8H6"/></svg>;
}
