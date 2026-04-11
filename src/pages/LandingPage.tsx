import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import Footer from '../components/Footer';

export default function LandingPage() {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      {/* ─── Header / Navbar ─── */}
      <header className="sticky top-0 z-50 border-b border-surface-200/80 dark:border-surface-800/80 bg-white/90 dark:bg-surface-900/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <EcoLogo />
            <span className="font-semibold text-sm text-surface-900 dark:text-white tracking-tight">Eco-Auditor</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm" aria-label="Main navigation">
            <a href="#features" className="text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors">How It Works</a>
            <Link to="/pricing" className="text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors">Pricing</Link>
            <Link to="/app" className="text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors">Login</Link>
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
            <Link to="/app" className="btn-primary text-sm !py-2 !px-5">
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        {/* Video background with transparency */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950" />
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-[0.08] dark:opacity-[0.06] mix-blend-multiply dark:mix-blend-screen pointer-events-none"
            aria-hidden="true"
          >
            <source src="/api/video" type="video/mp4" />
          </video>
        </div>
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            Now in beta — built for SMBs
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            Carbon accounting<br className="hidden sm:block" />
            <span className="text-brand-600 dark:text-brand-400">as easy as bookkeeping</span>
          </h1>
          <p className="mt-6 text-lg text-surface-500 dark:text-surface-400 max-w-2xl mx-auto leading-relaxed">
            Large-company disclosure rules are cascading through supply chains. Your buyers, lenders, and regulators increasingly want audit-ready emissions data. Eco-Auditor gets you there — without enterprise complexity or consultant fees.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/app" className="btn-primary !px-8 !py-3 text-base font-semibold shadow-lg shadow-brand-600/20">
              Start Free Trial
            </Link>
            <a href="mailto:hello@developer312.com?subject=Eco-Auditor%20Demo%20Request" className="btn-secondary !px-8 !py-3 text-base">
              Book a Demo
            </a>
          </div>
          <p className="mt-4 text-xs text-surface-400">No credit card required · 14-day free trial · Set up in under 10 minutes</p>
        </div>
      </section>

      {/* ─── Video Showcase ─── */}
      <section className="max-w-5xl mx-auto px-6 -mt-8 mb-12 relative z-10">
        <div className="rounded-2xl overflow-hidden shadow-2xl shadow-surface-900/10 dark:shadow-black/30 border border-surface-200 dark:border-surface-700 bg-black">
          <video
            autoPlay
            loop
            muted
            playsInline
            controls
            className="w-full h-auto"
          >
            <source src="/api/video" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
        <p className="text-center mt-4 text-xs text-surface-400">See how Eco-Auditor turns messy data into audit-ready carbon records</p>
      </section>

      {/* ─── Social Proof ─── */}
      <section className="border-y border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <p className="text-center text-xs font-medium text-surface-400 uppercase tracking-wider mb-6">Trusted by operations and sustainability teams at</p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {['Northstar Foods', 'Pacific Freight Co.', 'Greenleaf Packaging', 'Summit Manufacturing', 'Coastal Exports', 'Redwood Supply'].map((name) => (
              <span key={name} className="text-sm font-semibold text-surface-300 dark:text-surface-600 tracking-wide">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Value Props (CFO-facing) ─── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Built for the CFO, not the consultant</h2>
          <p className="mt-3 text-surface-500 max-w-xl mx-auto">Know exactly where you stand — in dollars at risk, not jargon.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ValueCard
            icon={<DollarIcon />}
            title="Cost Avoidance"
            description="See how much you're saving versus hiring consultants. Track estimated spend avoided, identify exposure from incomplete disclosures, and eliminate manual spreadsheet risk."
            metric="$84K"
            metricLabel="avg. consultant spend avoided"
          />
          <ValueCard
            icon={<ShieldIcon />}
            title="Contract Readiness"
            description="Know whether your data can satisfy buyer procurement packets, lender ESG requests, and importer compliance requirements — before the deadline."
            metric="72%"
            metricLabel="reporting package readiness"
          />
          <ValueCard
            icon={<AuditIcon />}
            title="Audit Defensibility"
            description="Every number traces back to a source document, emission factor, reviewer, and timestamp. Your auditor sees a ledger, not a mystery spreadsheet."
            metric="87%"
            metricLabel="records defensible in audit"
          />
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="bg-white dark:bg-surface-900 border-y border-surface-200 dark:border-surface-800">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Four steps to audit-ready emissions</h2>
            <p className="mt-3 text-surface-500 max-w-xl mx-auto">From messy utility bills to a defensible carbon inventory in weeks, not months.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Connect Data', desc: 'Upload utility bills, invoices, and freight docs. Or connect QuickBooks and Xero directly.' },
              { step: '02', title: 'AI Extraction', desc: 'OCR and AI parse your documents, apply emission factors, and flag low-confidence entries.' },
              { step: '03', title: 'Review & Verify', desc: 'Your team reviews flagged items, confirms assumptions, and builds an immutable audit trail.' },
              { step: '04', title: 'Export Reports', desc: 'Generate compliance-ready packages for California, CBAM, customer procurement, and annual inventory.' },
            ].map((item) => (
              <div key={item.step} className="text-center md:text-left">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-sm font-bold mb-4">
                  {item.step}
                </div>
                <h3 className="text-base font-semibold text-surface-900 dark:text-white mb-2">{item.title}</h3>
                <p className="text-sm text-surface-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Everything you need, nothing you don't</h2>
          <p className="mt-3 text-surface-500 max-w-xl mx-auto">Purpose-built for companies in the $10M–$500M range. Not enterprise bloatware.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            title="Executive Dashboard"
            description="Total emissions, scope breakdown, readiness scores, missing data alerts, and compliance tasks — all at a glance."
            icon={<DashboardIcon />}
          />
          <FeatureCard
            title="Data Intake"
            description="Upload utility bills, invoices, and freight docs. OCR extraction with confidence scores and a human review queue."
            icon={<DataIcon />}
          />
          <FeatureCard
            title="AI Carbon Assistant"
            description="Ask questions in plain English. Get methodology-backed answers with citations, assumptions, and next actions."
            icon={<AssistantIcon />}
          />
          <FeatureCard
            title="Emissions Ledger"
            description="Immutable audit trail. Every entry shows source, emission factor, reviewer, timestamp, and version history."
            icon={<LedgerIcon />}
          />
          <FeatureCard
            title="Reporting Center"
            description="Generate California readiness packages, CBAM supplier data, GHG inventories, and customer procurement packets."
            icon={<ReportsIcon />}
          />
          <FeatureCard
            title="Supplier Hub"
            description="Track vendor questionnaires, response rates, primary vs estimated data, and follow-up reminders by spend."
            icon={<SuppliersIcon />}
          />
        </div>
      </section>

      {/* ─── Testimonials ─── */}
      <section className="bg-white dark:bg-surface-900 border-y border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">What teams are saying</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <TestimonialCard
              quote="We went from a 40-page spreadsheet nobody trusted to an audit trail our board actually reviews. Setup took two weeks."
              name="Maria Gonzalez"
              role="VP Operations, Pacific Freight Co."
            />
            <TestimonialCard
              quote="Our largest retail buyer asked for Scope 3 data with 30 days notice. Eco-Auditor had the report ready in 3. That contract was worth $2M."
              name="James Park"
              role="Sustainability Lead, Northstar Foods"
            />
          </div>
        </div>
      </section>

      {/* ─── CTA Banner ─── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 dark:from-brand-700 dark:to-brand-900 px-8 py-14 text-center">
          <div className="absolute top-0 left-0 w-72 h-72 bg-brand-400/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-400/10 rounded-full translate-x-1/3 translate-y-1/3" />
          <div className="relative">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Ready to get audit-ready?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-8">
              Join hundreds of SMBs turning messy data into defensible emissions records. Start free — no credit card, no consultant required.
            </p>
            <Link to="/app" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-base rounded-lg transition-colors shadow-lg">
              Start Your Free Trial
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <Footer />
    </div>
  );
}

/* ─── Sub-components ─── */

function ValueCard({ icon, title, description, metric, metricLabel }: { icon: React.ReactNode; title: string; description: string; metric: string; metricLabel: string }) {
  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-brand-600 dark:text-brand-400">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h3>
      </div>
      <p className="text-sm text-surface-500 leading-relaxed mb-5">{description}</p>
      <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
        <span className="text-2xl font-bold text-brand-600 dark:text-brand-400">{metric}</span>
        <span className="ml-2 text-xs text-surface-400">{metricLabel}</span>
      </div>
    </div>
  );
}

function FeatureCard({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="card hover:shadow-md transition-shadow group">
      <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent/20 flex items-center justify-center text-accent mb-4 group-hover:bg-accent/20 transition-colors">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">{title}</h3>
      <p className="text-sm text-surface-500 leading-relaxed">{description}</p>
    </div>
  );
}

function TestimonialCard({ quote, name, role }: { quote: string; name: string; role: string }) {
  return (
    <div className="card">
      <svg className="w-8 h-8 text-brand-200 dark:text-brand-800 mb-4" viewBox="0 0 32 32" fill="currentColor">
        <path d="M10 8H6a4 4 0 00-4 4v4a4 4 0 004 4h4v4a4 4 0 01-4 4H5a1 1 0 000 2h1a6 6 0 006-6V10a2 2 0 00-2-2zm16 0h-4a4 4 0 00-4 4v4a4 4 0 004 4h4v4a4 4 0 01-4 4h-1a1 1 0 000 2h1a6 6 0 006-6V10a2 2 0 00-2-2z" />
      </svg>
      <blockquote className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed mb-5">"{quote}"</blockquote>
      <div>
        <div className="text-sm font-medium text-surface-900 dark:text-white">{name}</div>
        <div className="text-xs text-surface-400">{role}</div>
      </div>
    </div>
  );
}

/* ─── Icons ─── */

function EcoLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-brand-600 dark:text-brand-400" />
      <path d="M16 8V24M11 13C13 10 19 10 21 13M11 19C13 16 19 16 21 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-brand-500 dark:text-brand-300" fill="none" />
      <circle cx="16" cy="16" r="3.5" className="fill-accent dark:fill-accent-light" />
    </svg>
  );
}

function DollarIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="8" /><path d="M10 5v10M7.5 7.5a2 2 0 012-1.5h1a2 2 0 010 4H9a2 2 0 000 4h1.5a2 2 0 002-1.5" /></svg>;
}

function ShieldIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V5l7-3z" /><path d="M7 10l2 2 4-4" /></svg>;
}

function AuditIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h9l3 3v11H4z" /><path d="M13 3v3h3" /><path d="M7 9h6M7 12h6M7 15h3" /></svg>;
}

function DashboardIcon() {
  return <svg className="w-4.5 h-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="5.5" height="5.5" rx="1"/><rect x="9.5" y="1" width="5.5" height="5.5" rx="1"/><rect x="1" y="9.5" width="5.5" height="5.5" rx="1"/><rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1"/></svg>;
}

function DataIcon() {
  return <svg className="w-4.5 h-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h12M2 8h12M2 12h8"/><path d="M12 10l2 2-2 2"/></svg>;
}

function AssistantIcon() {
  return <svg className="w-4.5 h-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5 9s1 2 3 2 3-2 3-2"/><circle cx="6" cy="7" r="0.5" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="0.5" fill="currentColor" stroke="none"/></svg>;
}

function LedgerIcon() {
  return <svg className="w-4.5 h-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h12v12H2z"/><path d="M5 2v12M2 5h12M2 8h12M2 11h12"/></svg>;
}

function ReportsIcon() {
  return <svg className="w-4.5 h-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3"/><path d="M5 8h6M5 10h6M5 12h3"/></svg>;
}

function SuppliersIcon() {
  return <svg className="w-4.5 h-4.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4 4-4s4 1.5 4 4"/><path d="M7 13c0-2.5 2-4 4-4s4 1.5 4 4"/></svg>;
}

function MoonIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 018 2.5a5.5 5.5 0 010 11z"/></svg>;
}

function SunIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>;
}
