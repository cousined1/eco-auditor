import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import ChatbotWidget from '../components/ChatbotWidget';
import routeMeta from '@/content/route-meta.json';
import faqContent from '@/content/faq.json';
import { FEATURES, type Feature } from '@/content/features';
import { trialHeadline, trialLimitsLabel } from '@/content/pricing';

// The FAQ text is shared with scripts/prerender-head.mjs, which emits the
// FAQPage JSON-LD from the same file, so the structured data can never say more
// than this page shows. Do not inject FAQ JSON-LD from here: the prerendered
// head already carries it (a second copy made the homepage declare two).
const FAQS = faqContent.home;
const HOME_META = routeMeta['/'];

const FEATURE_ICONS: Record<Feature['id'], React.ReactNode> = {
  dashboard: <DashboardIcon />,
  intake: <DataIcon />,
  assistant: <AssistantIcon />,
  ledger: <LedgerIcon />,
  reports: <ReportsIcon />,
  suppliers: <SuppliersIcon />,
};

export default function LandingPage() {
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

  // Autoplay starts downloading the intro video at once, whatever `preload` says,
  // so the decorative background is mounted only after the visitor has touched
  // the page: a fresh load requests no video bytes (F-F-15).
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    const start = () => setInteracted(true);
    for (const event of events) window.addEventListener(event, start, { once: true, passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, start);
    };
  }, []);

  useEffect(() => {
    // Same values the prerendered HTML carries (src/content/route-meta.json).
    document.title = HOME_META.title;

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    const originalDesc = desc?.content ?? '';
    if (desc) desc.content = HOME_META.description;

    return () => {
      document.title = HOME_META.title;
      if (desc) desc.content = originalDesc;
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <ChatbotWidget />
      {/* ─── Header / Navbar (CTA-slot pattern) ─── */}
      <Header variant="landing" />
      <main id="main-content" tabIndex={-1}>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        {/* Video background with transparency */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950" />
          {isDesktop && interacted && (
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
            Live today: CSV import, emissions calculation and a PDF summary
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            Carbon accounting{' '}
            <br className="hidden sm:block" />
            <span className="text-brand-600 dark:text-brand-400">as easy as bookkeeping</span>
          </h1>
          <p className="mt-6 text-lg text-surface-600 dark:text-surface-400 max-w-2xl mx-auto leading-relaxed">
            Large-company disclosure rules are cascading through supply chains. Your buyers, lenders, and regulators increasingly want reviewable emissions data. Eco-Auditor helps you assemble it from your own activity data, without enterprise complexity.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup/" data-cta="primary" className="btn-primary !px-8 !py-3 text-base font-semibold shadow-lg shadow-brand-600/20">
              Start Free Trial
            </Link>
            <Link to="/demo/" className="btn-secondary !px-8 !py-3 text-base">Book a Demo</Link>
          </div>
          {/* The card-free trial has Starter limits (F-A-09): say so next to the CTA. */}
          <p className="mt-4 text-xs text-surface-600 dark:text-surface-400">
            {trialHeadline()} · No card required · {trialLimitsLabel()}
          </p>
        </div>
      </section>

      {/* ─── How it works: ONE three-step flow (the page used to list the same
             import step in two separate sections) ─── */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-12 scroll-mt-20">
        <h2 className="sr-only">How Eco-Auditor works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              step: '1',
              title: 'Upload your activity CSV',
              desc: 'Import utility bills, fuel invoices and freight records as CSV. Row-level errors are shown after import.',
              icon: <UploadIcon />,
            },
            {
              step: '2',
              title: 'We apply the factors',
              desc: 'Each row is priced with an EPA, eGRID or IPCC factor where one exists and scored for confidence. Spend-based Scope 3 factors are Eco-Auditor internal estimates.',
              icon: <AIIcon />,
            },
            {
              step: '3',
              title: 'Download a PDF summary',
              desc: 'Get a PDF emissions summary with totals by scope, an overall confidence score and the methodology used, to use as source material for customer, lender or regulatory requests.',
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
          <Link to="/methodology/" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
            See how we calculate emissions →
          </Link>
        </div>
      </section>

      {/* ─── Video Showcase ─── */}
      <section className="max-w-5xl mx-auto px-6 mb-12 relative z-10">
        <div className="rounded-2xl overflow-hidden shadow-2xl shadow-surface-900/10 dark:shadow-black/30 border border-surface-200 dark:border-surface-700 bg-black">
          {/* This is a click-to-play walkthrough, not the autoplaying background
              video, so it must NOT carry eco-hero-motion: that class hides the
              element for prefers-reduced-motion users and left the caption below
              pointing at nothing (F-C-24). With no autoplay it needs no hiding;
              reduced-motion users get the poster frame and the controls.
              preload="none": the poster stands in until play is pressed, so a visit
              that never plays it downloads none of the 27 MB file (F-F-15). */}
          <video
            className="w-full h-auto"
            controls
            preload="none"
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
              Watch the <Link to="/demo/">interactive product walkthrough</Link> or read the <Link to="/methodology/">methodology overview</Link> for a text-based explanation of how Eco-Auditor turns activity data into a reviewable carbon inventory.
            </p>
          </video>
        </div>
        <p className="text-center mt-4 text-xs text-surface-600 dark:text-surface-400">See how Eco-Auditor turns messy data into reviewable carbon records</p>
      </section>

      {/* ─── Social Proof ─── */}
      <section className="border-y border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <p className="text-center text-xs font-medium text-surface-600 dark:text-surface-400 uppercase tracking-wider mb-6">
            Built for operations and sustainability teams responding to SB 253 requests and supply-chain emissions questionnaires
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-surface-600 dark:text-surface-400">
            <span className="font-medium">GHG Protocol aligned</span>
            <span className="text-surface-300 dark:text-surface-600">•</span>
            <span className="font-medium">Scope 1, 2 &amp; 3 tracking</span>
            <span className="text-surface-300 dark:text-surface-600">•</span>
            <span className="font-medium">Per-row confidence scoring</span>
            <span className="text-surface-300 dark:text-surface-600">•</span>
            <span className="font-medium">CSV intake</span>
          </div>
        </div>
      </section>

      {/* ─── Value Props (finance and operations teams) ─── */}
      {/* Copy here states only what the product does today. The old "Cost Avoidance",
          "Contract Readiness" and "Audit Defensibility" cards promised dollar
          figures, a readiness verdict and factor-by-factor traceability that the
          app does not deliver (audit F-A-02, F-A-03), each with a pseudo-metric
          slot. See src/content/claims.ts for the withdrawn wording. */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Built for finance and operations teams</h2>
          <p className="mt-3 text-surface-500 max-w-xl mx-auto">See which numbers rest on metered data and which are estimates.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ValueCard
            icon={<DashboardIcon />}
            title="Estimates vs measured data"
            description="Every imported row carries a confidence score, and the PDF summary reports the overall figure, so you can see how much of your inventory rests on metered data and how much on spend-based estimates."
          />
          <ValueCard
            icon={<ShieldIcon />}
            title="Answering data requests"
            description="Use the PDF emissions summary as source material when a buyer, lender, or importer asks for your emissions data. Framework-specific filing templates are on the roadmap."
          />
          <ValueCard
            icon={<AuditIcon />}
            title="Documented methodology"
            description="Fuel and electricity factors come from the EPA and eGRID datasets; spend-based Scope 3 factors are Eco-Auditor internal estimates. The methodology page lists the sources and how confidence is scored."
          />
        </div>
      </section>

      {/* ─── Features: live and roadmap kept apart, from src/content/features.ts ─── */}
      <section id="features" className="bg-white dark:bg-surface-900 border-y border-surface-200 dark:border-surface-800 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Live today</h2>
            <p className="mt-3 text-surface-500 max-w-xl mx-auto">Built for companies in the $10M–$500M revenue range.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.filter((f) => f.status === 'live').map((f) => (
              <FeatureCard key={f.id} title={f.name} description={f.description} icon={FEATURE_ICONS[f.id]} />
            ))}
          </div>

          <div className="text-center mt-20 mb-14">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Coming next</h2>
            <p className="mt-3 text-surface-500 max-w-xl mx-auto">On our roadmap and not available yet.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.filter((f) => f.status === 'roadmap').map((f) => (
              <FeatureCard key={f.id} title={f.name} description={f.description} icon={FEATURE_ICONS[f.id]} comingSoon />
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ Section ─── */}
      <section id="faq" className="border-b border-surface-200 dark:border-surface-800">
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
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Ready to try it on your own data?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-8">
              Import a CSV and download a PDF emissions summary. Start your {trialHeadline()}; no card required.
            </p>
            <Link to="/signup/" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-base rounded-lg transition-colors shadow-lg">
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

function ValueCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-brand-600 dark:text-brand-400">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h3>
      </div>
      <p className="text-sm text-surface-500 leading-relaxed">{description}</p>
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

/* ─── Icons ─── */

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
