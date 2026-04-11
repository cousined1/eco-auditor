import { Routes, Route, NavLink, Link, Navigate } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import DataIntake from './pages/DataIntake';
import AIAssistant from './pages/AIAssistant';
import Ledger from './pages/Ledger';
import Reports from './pages/Reports';
import Suppliers from './pages/Suppliers';
import Methodology from './pages/Methodology';
import Pricing from './pages/Pricing';
import Settings from './pages/Settings';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import ContactUs from './pages/ContactUs';
import DataProcessingAddendum from './pages/DataProcessingAddendum';
import Footer from './components/Footer';

const LEGAL_PATHS = ['/privacy', '/terms', '/dpa', '/contact'];

const NAV_ITEMS = [
  { to: '/app', label: 'Dashboard', icon: DashboardIcon, end: true },
  { to: '/app/intake', label: 'Data Intake', icon: DataIcon },
  { to: '/app/assistant', label: 'AI Assistant', icon: AssistantIcon },
  { to: '/app/ledger', label: 'Ledger', icon: LedgerIcon },
  { to: '/app/reports', label: 'Reports', icon: ReportsIcon },
  { to: '/app/suppliers', label: 'Suppliers', icon: SuppliersIcon },
  { to: '/app/methodology', label: 'Methodology', icon: MethodologyIcon },
  { to: '/app/pricing', label: 'Pricing', icon: PricingIcon },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const { theme, toggle } = useTheme();
  const location = window.location.pathname;
  const isLegalPage = LEGAL_PATHS.includes(location);
  const isAppPage = location.startsWith('/app');

  /* ─── Legal pages (standalone layout) ─── */
  if (isLegalPage) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <header className="border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <EcoLogo />
              <span className="font-semibold text-sm text-surface-900 dark:text-white">Eco-Auditor</span>
            </Link>
            <button type="button" onClick={toggle} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
          </div>
        </header>
        <Routes>
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/dpa" element={<DataProcessingAddendum />} />
          <Route path="/contact" element={<ContactUs />} />
        </Routes>
        <Footer />
      </div>
    );
  }

  /* ─── App shell (sidebar + dashboard pages) ─── */
  if (isAppPage) {
    return (
      <div className="flex h-screen overflow-hidden bg-surface-50 dark:bg-surface-950">
        <aside className="hidden md:flex flex-col w-60 border-r border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
          <div className="flex items-center gap-2.5 px-5 py-4 border-b border-surface-200 dark:border-surface-800">
            <Link to="/">
              <EcoLogo />
            </Link>
            <div>
              <Link to="/" className="font-semibold text-sm text-surface-900 dark:text-white tracking-tight hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Eco-Auditor</Link>
              <div className="text-2xs text-surface-500">Carbon Accounting</div>
            </div>
          </div>
          <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-3 px-3 scrollbar-thin">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end || false}
                aria-label={item.label}
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
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-surface-200 dark:border-surface-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-800 flex items-center justify-center text-xs font-semibold text-brand-700 dark:text-brand-200">SC</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">Sarah Chen</div>
                <div className="text-2xs text-surface-500 truncate">Sustainability Lead</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="flex items-center justify-between px-6 py-3 border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
            <div className="flex items-center gap-3 md:hidden">
              <EcoLogo />
              <span className="font-semibold text-sm">Eco-Auditor</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <span className="text-surface-400">Northstar Foods</span>
              <span className="text-surface-300">/</span>
              <span className="font-medium text-surface-800 dark:text-surface-200">FY 2026</span>
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
              <button
                type="button"
                className="relative p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
                aria-label="Notifications — 1 unread alert"
              >
                <BellIcon aria-hidden="true" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-risk-high rounded-full" aria-hidden="true" />
              </button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/app" element={<Dashboard />} />
              <Route path="/app/intake" element={<DataIntake />} />
              <Route path="/app/assistant" element={<AIAssistant />} />
              <Route path="/app/ledger" element={<Ledger />} />
              <Route path="/app/reports" element={<Reports />} />
              <Route path="/app/suppliers" element={<Suppliers />} />
              <Route path="/app/methodology" element={<Methodology />} />
              <Route path="/app/pricing" element={<Pricing />} />
              <Route path="/app/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
    );
  }

  /* ─── Public pages (landing, pricing standalone) ─── */
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<LandingPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function EcoLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-brand-600 dark:text-brand-400" />
      <path d="M16 8V24M11 13C13 10 19 10 21 13M11 19C13 16 19 16 21 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-brand-500 dark:text-brand-300" fill="none" />
      <circle cx="16" cy="16" r="3.5" className="fill-accent dark:fill-accent-light" />
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
function SettingsIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>;
}
function MoonIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 018 2.5a5.5 5.5 0 010 11z"/></svg>;
}
function SunIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>;
}
function BellIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6a4 4 0 018 0c0 4 2 5 2 5H2s2-1 2-5z"/><path d="M6.5 13a1.5 1.5 0 003 0"/></svg>;
}
