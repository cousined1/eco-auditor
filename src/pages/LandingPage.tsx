import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { useTheme } from '../hooks/useTheme';
import Footer from '../components/Footer';
import ChatbotWidget from '../components/ChatbotWidget';

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "What is Scope 1, 2, and 3 emissions?", "acceptedAnswer": { "@type": "Answer", "text": "Scope 1 covers direct emissions from sources you own or control (e.g., natural gas boilers, company vehicles). Scope 2 covers indirect emissions from purchased electricity, steam, heating, and cooling. Scope 3 covers all other indirect emissions in your value chain, including purchased goods, business travel, and waste." } },
    { "@type": "Question", "name": "What is SB 253 and who does it affect?", "acceptedAnswer": { "@type": "Answer", "text": "California's Climate Corporate Data Accountability Act (SB 253) requires companies doing business in California with over $1 billion in annual revenue to disclose Scope 1 and Scope 2 emissions starting in 2026, and Scope 3 starting in 2027. The requirements cascade through supply chains, affecting SMBs that supply larger companies." } },
    { "@type": "Question", "name": "How is Eco-Auditor different from enterprise ESG platforms?", "acceptedAnswer": { "@type": "Answer", "text": "Eco-Auditor is purpose-built for companies in the $10M–$500M revenue range. It provides CSV import, a confidence score, and a PDF emissions summary at a fraction of enterprise platform costs — typically $149–$999/month versus six-figure annual licenses. Some factors are provisional." } },
    { "@type": "Question", "name": "How long does it take to get started?", "acceptedAnswer": { "@type": "Answer", "text": "You import a CSV and the calculator applies emission factors with per-entry confidence scoring. Some factors are provisional internal estimates." } },
    { "@type": "Question", "name": "What compliance frameworks does Eco-Auditor support?", "acceptedAnswer": { "@type": "Answer", "text": "Eco-Auditor calculates a GHG Protocol-aligned inventory with location-based Scope 2. Some factors are provisional internal estimates. A PDF emissions summary is what ships today. Framework-specific filing packages for California SB 253 and EU CBAM are on the roadmap." } },
    { "@type": "Question", "name": "Do I need a sustainability consultant to use Eco-Auditor?", "acceptedAnswer": { "@type": "Answer", "text": "No. Eco-Auditor is designed for operations, finance, and sustainability teams to use independently. The platform provides methodology guidance, emission factor libraries, and an AI assistant on the roadmap to answer questions. That said, you can always engage a consultant to review your final reports." } },
  ]
};

const FAQS = [
  { q: "What is Scope 1, 2, and 3 emissions?", a: "Scope 1 covers direct emissions from sources you own or control (e.g., natural gas boilers, company vehicles). Scope 2 covers indirect emissions from purchased electricity, steam, heating, and cooling. Scope 3 covers all other indirect emissions in your value chain, including purchased goods, business travel, and waste." },
  { q: "What is SB 253 and who does it affect?", a: "California's Climate Corporate Data Accountability Act (SB 253) requires companies doing business in California with over $1 billion in annual revenue to disclose Scope 1 and Scope 2 emissions starting in 2026, and Scope 3 starting in 2027. The requirements cascade through supply chains, affecting SMBs that supply larger companies." },
  { q: "How is Eco-Auditor different from enterprise ESG platforms?", a: "Eco-Auditor is purpose-built for companies in the $10M–$500M revenue range. It provides CSV import, a confidence score, and a PDF emissions summary at a fraction of enterprise platform costs — typically $149–$999/month versus six-figure annual licenses. Some factors are provisional." },
  { q: "How long does it take to get started?", a: "You import a CSV and the calculator applies emission factors with per-entry confidence scoring. Some factors are provisional internal estimates." },
  { q: "What compliance frameworks does Eco-Auditor support?", a: "Eco-Auditor calculates a GHG Protocol-aligned inventory with location-based Scope 2. Some factors are provisional internal estimates. A PDF emissions summary is what ships today. Framework-specific filing packages for California SB 253 and EU CBAM are on the roadmap." },
  { q: "Do I need a sustainability consultant to use Eco-Auditor?", a: "No. Eco-Auditor is designed for operations, finance, and sustainability teams to use independently. The platform provides methodology guidance, emission factor libraries, and an AI assistant on the roadmap to answer questions. That said, you can always engage a consultant to review your final reports." },
];

export default function LandingPage() {
  const { theme, toggle } = useTheme();

  // Perf: the 27MB hero background video is a desktop-only flourish.
  // On viewports < 768px it dominates LCP/TBT for an 8%-opacity effect,
  // so we simply don't mount it there. SSR renders without it by default.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs | Scope 1-3 Reporting';

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    const originalDesc = desc?.content ?? '';
    if (desc) desc.content = 'Eco-Auditor is carbon accounting for SMBs. Import activity data by CSV and get a calculated inventory with per-entry confidence scoring. Some factors are provisional. 14-day free trial on signup without a plan; no card required on that path.';

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(FAQ_SCHEMA);
    document.head.appendChild(script);
    return () => {
      document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs';
      if (desc) desc.content = originalDesc;
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <ChatbotWidget />
      {/* ─── Header / Navbar (CTA-slot pattern) ─── */}
      <Header
        variant="landing"
        extra={
          <button
            type="button"
            onClick={toggle}
            className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        }
      />
      <main id="main-content" tabIndex={-1}>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        {/* Video background with transparency */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950" />
          {isDesktop && (
            <video
              autoPlay
              loop
              muted
              playsInline
              preload="none"
              className="eco-hero-motion absolute inset-0 w-full h-full object-cover opacity-[0.08] dark:opacity-[0.06] mix-blend-multiply dark:mix-blend-screen pointer-events-none"
              aria-hidden="true"
            >
              <source src="/api/video" type="video/mp4" />
            </video>
          )}
        </div>
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            Now live — open for business
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            Carbon accounting<br className="hidden sm:block" />
            <span className="text-brand-600 dark:text-brand-400">as easy as bookkeeping</span>
          </h1>
          <p className="mt-6 text-lg text-surface-600 dark:text-surface-400 max-w-2xl mx-auto leading-relaxed">
            Large-company disclosure rules are cascading through supply chains. Buyers and lenders are asking for emissions numbers they can check. Eco-Auditor calculates an inventory from your CSV — without enterprise complexity or consultant fees. Some factors are provisional.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup" data-cta="primary" className="btn-primary !px-8 !py-3 text-base font-semibold shadow-lg shadow-brand-600/20">
              Start Free Trial
            </Link>
            <Link to="/demo" className="btn-secondary !px-8 !py-3 text-base">Book a Demo</Link>
          </div>
          <p className="mt-4 text-xs text-surface-600 dark:text-surface-400">14-day free trial · No card required · Cancel anytime before trial ends</p>
        </div>
      </section>

      {/* ─── 3-Step Quick-Start Workflow (P0-3, P0-6) ─── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="sr-only">How Eco-Auditor works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              step: '1',
              title: 'Import your data',
              desc: 'Bring in activity data by CSV — utility bills, fuel invoices, freight records. Accounting connections such as QuickBooks and Xero are on the roadmap.',
              icon: <UploadIcon />,
            },
            {
              step: '2',
              title: 'Calculate',
              desc: 'Apply EPA, eGRID, and IPCC factors and score every entry for confidence. Some Scope 3 factors are provisional internal estimates.',
              icon: <AIIcon />,
            },
            {
              step: '3',
              title: 'Export a summary',
              desc: 'Export a PDF emissions summary you can share as source material. Framework-specific filing packages are on the roadmap. Provisional factors are estimates, not a published dataset.',
              icon: <ReportIcon />,
            },
          ].map((item) => (
            <div key={item.step} className="card text-center relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shadow-md">
                {item.step}
              </div>
              <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-brand-600 dark:text-brand-400 mx-auto mb-4 mt-2">
                {item.icon}
              </div>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">{item.title}</h3>
              <p className="text-xs text-surface-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link to="/methodology" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
            See how we calculate emissions →
          </Link>
        </div>
      </section>

      {/* ─── Video Showcase ─── */}
      <section className="max-w-5xl mx-auto px-6 mb-12 relative z-10">
        <div className="rounded-2xl overflow-hidden shadow-2xl shadow-surface-900/10 dark:shadow-black/30 border border-surface-200 dark:border-surface-700 bg-black">
          <video
            className="w-full h-auto eco-hero-motion"
            controls
            preload="metadata"
            poster="/og-image.png"
            aria-describedby="product-video-description"
          >
            <source src="/api/video" type="video/mp4" />
            {/* The captions track pointed at /video/product-workflow.en.vtt,
                which 404s — public/video/ does not exist. An advertised
                captions track that fails to load is worse than none, because
                the control appears available. The text alternative below
                carries the content until a real .vtt is authored. */}
            <p id="product-video-description">
              Watch the <Link to="/demo">interactive product walkthrough</Link> or read the <Link to="/methodology">methodology overview</Link> for a text-based explanation of how Eco-Auditor turns activity data into a calculated inventory.
            </p>
          </video>
        </div>
        <p className="text-center mt-4 text-xs text-surface-600 dark:text-surface-400">See how Eco-Auditor turns imported activity data into a calculated inventory</p>
      </section>

      {/* ─── Social Proof ─── */}
      <section className="border-y border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <p className="text-center text-xs font-medium text-surface-600 dark:text-surface-400 uppercase tracking-wider mb-6">
            Built for operations and sustainability teams preparing for SB 253, CBAM, and supply-chain disclosure
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-surface-600 dark:text-surface-400">
            <span className="font-medium">GHG Protocol aligned (location-based Scope 2)</span>
            <span className="text-surface-300 dark:text-surface-600">•</span>
            <span className="font-medium">Scope 1, 2 &amp; 3 tracking</span>
            <span className="text-surface-300 dark:text-surface-600">•</span>
            <span className="font-medium">Confidence score</span>
            <span className="text-surface-300 dark:text-surface-600">•</span>
            <span className="font-medium">CSV intake</span>
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
            description="Identify exposure from incomplete disclosures and eliminate manual spreadsheet risk."
            metric="Visible"
            metricLabel="estimated vs primary data, per report"
          />
          {/* FEW-04: the "savings versus hiring consultants" comparison and the
              "Track estimated spend avoided" metric were removed - claims.ts marks
              consultant-cost-comparison status:'unverified' (pricing-only, review
              overdue) and no cost-avoidance metric is implemented. Restore only
              with a citable source recorded in claims.ts. */}
          <ValueCard
            icon={<ShieldIcon />}
            title="Contract Readiness"
            description="A PDF emissions summary you can attach to a buyer or lender request. Filing packages for those requests are on the roadmap."
            metric="PDF"
            metricLabel="summary you can share"
          />
          <ValueCard
            icon={<AuditIcon />}
            title="Audit Defensibility"
            description="Each calculated row keeps the activity you imported, the factor applied, and a confidence score. Some factors are provisional internal estimates, not a published dataset."
            metric="Scored"
            metricLabel="activity, factor, and confidence"
          />
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="bg-white dark:bg-surface-900 border-y border-surface-200 dark:border-surface-800">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Four steps to defensible emissions</h2>
            <p className="mt-3 text-surface-500 max-w-xl mx-auto">From messy data to a defensible carbon inventory in weeks, not months.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Import Data', desc: 'Bring in activity data by CSV — utility bills, invoices, and freight docs. Accounting connections are on the roadmap.' },
              { step: '02', title: 'Calculate', desc: 'Apply EPA, eGRID, and IPCC factors and score each row for confidence. Some Scope 3 factors are provisional.' },
              { step: '03', title: 'Review & Verify', desc: 'Your team checks the imported rows and confidence scores, and corrects anything that looks wrong.' },
              { step: '04', title: 'Export Reports', desc: 'Export a PDF emissions summary to support California, CBAM, procurement, and annual inventory work.' },
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
            description="Total emissions, Scope 1/2/3 breakdown, 12-month trend, and an overall data-confidence score — all at a glance."
            icon={<DashboardIcon />}
          />
          <FeatureCard
            title="Data Intake"
            description="Upload CSV activity data and get a per-entry confidence score, with row-level errors surfaced on import."
            icon={<DataIcon />}
          />
          <FeatureCard
            title="AI Carbon Assistant"
            description="Ask questions in plain English. Get methodology-backed answers with citations, assumptions, and next actions."
            icon={<AssistantIcon />}
            comingSoon
          />
          <FeatureCard
            title="Emissions Ledger"
            description="Traceable emissions ledger. Every entry records its source, emission factor, and confidence score."
            icon={<LedgerIcon />}
            comingSoon
          />
          <FeatureCard
            title="Reporting Center"
            description="Generate California readiness packages, CBAM supplier data, GHG inventories, and customer procurement packets."
            icon={<ReportsIcon />}
            comingSoon
          />
          <FeatureCard
            title="Supplier Hub"
            description="Track vendor questionnaires, response rates, primary vs estimated data, and follow-up reminders by spend."
            icon={<SuppliersIcon />}
            comingSoon
          />
        </div>
      </section>

      {/* ─── Testimonials (illustrative) ─── */}
      <section className="bg-white dark:bg-surface-900 border-y border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">What teams will be able to say</h2>
            <p className="mt-3 text-xs text-surface-600 dark:text-surface-400 uppercase tracking-wider">
              Illustrative — composite examples of the workflow we are building, not real customer quotes
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <TestimonialCard
              quote="We went from a 40-page spreadsheet nobody trusted to an audit trail our board actually reviews. Setup took two weeks."
              name="Operations lead"
              role="Composite example — mid-market distributor"
            />
            <TestimonialCard
              quote="Our largest retail buyer asked for Scope 3 data with 30 days notice. Eco-Auditor had the report ready in 3."
              name="Sustainability lead"
              role="Composite example — food &amp; beverage supplier"
            />
          </div>
        </div>
      </section>

      {/* ─── FAQ Section ─── */}
      <section id="faq" className="bg-white dark:bg-surface-900 border-y border-surface-200 dark:border-surface-800">
        <div className="max-w-4xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Frequently asked questions</h2>
            <p className="mt-3 text-surface-500 max-w-xl mx-auto">Common questions about carbon accounting, compliance, and Eco-Auditor.</p>
          </div>
          <div className="space-y-6">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-surface-900 dark:text-white list-none">
                  {faq.q}
                  <svg className="w-4 h-4 text-surface-600 dark:text-surface-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </summary>
                <div className="px-5 pb-4 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA Banner ─── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 dark:from-brand-700 dark:to-brand-900 px-8 py-14 text-center">
          <div className="absolute top-0 left-0 w-72 h-72 bg-brand-400/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-400/10 rounded-full translate-x-1/3 translate-y-1/3" />
          <div className="relative">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Ready to calculate an inventory?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-8">
              Turn messy data into defensible emissions records. Start your 14-day free trial — no consultant required.
            </p>
            <Link to="/signup" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-base rounded-lg transition-colors shadow-lg">
              Start Your Free Trial
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      </main>
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
        <span className="ml-2 text-xs text-surface-600 dark:text-surface-400">{metricLabel}</span>
      </div>
    </div>
  );
}

function FeatureCard({ title, description, icon, comingSoon }: { title: string; description: string; icon: React.ReactNode; comingSoon?: boolean }) {
  return (
    <div className="card hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between mb-4">
        <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent/20 flex items-center justify-center text-accent-text group-hover:bg-accent/20 transition-colors">
          {icon}
        </div>
        {comingSoon && (
          <span className="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-400">
            Coming soon
          </span>
        )}
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
        <div className="text-xs text-surface-600 dark:text-surface-400">{role}</div>
      </div>
    </div>
  );
}

/* ─── Icons ─── */

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

function UploadIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v10M6 7l4-4 4 4"/><path d="M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1"/></svg>;
}

function AIIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2l1.5 3.5L15 7l-3.5 1.5L10 12l-1.5-3.5L5 7l3.5-1.5L10 2z"/><circle cx="14" cy="15" r="3"/><path d="M12 15h4"/></svg>;
}

function ReportIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h8l4 4v10H4z"/><path d="M12 3v4h4"/><path d="M7 10h5M7 13h5M7 16h3"/></svg>;
}

function MoonIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 018 2.5a5.5 5.5 0 010 11z"/></svg>;
}

function SunIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>;
}
