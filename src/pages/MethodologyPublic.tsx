import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';
// Privacy/Terms/DPA links live in Footer. Without it these pages had no legal
// links at all — Google and Meta both require an accessible privacy policy
// from the ad destination. See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-9).
import Footer from '../components/Footer';
import { factorLabel } from '@/lib/emission-factors/registry';
// REL-001: counts come from the live factor catalog so this copy cannot drift
// back into an "every factor is verified" claim when factors change.
import {
  CATALOG_VERSION,
  factorProvenanceSummary,
  LEGACY_CATALOG_VERSION,
  PROVISIONAL_SCOPE12,
  PROVISIONAL_SCOPE12_CATEGORIES,
} from '@/lib/emission-factors/factors';
import routeMeta from '@/content/route-meta.json';
import faqContent from '@/content/faq.json';
import { SCOPES, CONFIDENCE_ROWS, LEGACY_MANUAL_ENTRY_CONFIDENCE } from '@/content/methodology';
import { CBAM_PRODUCT_STATEMENT, REGULATORY } from '@/content/regulatory';
import { trialHeadline, trialLimitsLabel } from '@/content/pricing';

const FACTOR_PROVENANCE = factorProvenanceSummary();

// Title and description come from src/content/route-meta.json, the file the
// prerender step writes into the HTML, so raw and JS-rendered meta agree. The
// FAQPage JSON-LD is emitted by the prerender step from the same faq.json this
// page renders; injecting it here as well made the page declare it twice.
const METHODOLOGY_META = routeMeta['/methodology'];
const HOME_META = routeMeta['/'];
const FAQS = faqContent.methodology;

const METHODOLOGY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Eco-Auditor Methodology — GHG Protocol Carbon Accounting",
  "description": "How Eco-Auditor calculates Scope 1, 2, and 3 emissions using EPA, eGRID, and IPCC AR5 emission factors, aligned with the GHG Protocol Corporate Standard.",
  "datePublished": "2026-05-21",
};

// Regulatory statements come from src/content/regulatory.ts (each carries its
// "as of" date and source) — never type a deadline into this page.
const STANDARDS_TOP = [
  { name: 'GHG Protocol Corporate Standard', org: 'WRI / WBCSD', desc: 'Scope 1 and 2 accounting and organizational boundary setting. The company chooses its consolidation approach (operational control, financial control or equity share) in Settings; reports say "not specified" until it does.' },
  { name: 'GHG Protocol Scope 3 Standard', org: 'WRI / WBCSD', desc: 'Corporate Value Chain (Scope 3) Standard with spend-based estimates for common Scope 3 categories.' },
  {
    name: 'California SB 253',
    org: 'CARB',
    desc: `${REGULATORY.sb253.statement} Smaller suppliers may still receive emissions-data requests from covered customers, and Eco-Auditor can help you assemble emissions data for those requests. ${REGULATORY.sb261.statement} Eco-Auditor does not produce SB 261 reports.`,
  },
];

const STANDARDS_BOTTOM = [
  {
    name: 'EU CBAM',
    org: 'European Commission',
    desc: `${CBAM_PRODUCT_STATEMENT} It can support the collection and organization of emissions inputs used in CBAM-related workflows, but it does not replace an authorized declarant, customs filing, legal review, or required verification. Applicability depends on importer status and goods traded. ${REGULATORY['eu-cbam'].statement}`,
  },
  { name: 'EPA GHG Inventory Guidance', org: 'US EPA', desc: 'Emission factor libraries from the EPA GHG Emission Factors Hub and eGRID.' },
];

export default function MethodologyPublic() {
  useEffect(() => {
    document.title = METHODOLOGY_META.title;

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = METHODOLOGY_META.description;

    // Structured data
    const scripts = [
      { type: 'application/ld+json', id: 'methodology-schema', text: JSON.stringify(METHODOLOGY_SCHEMA) },
    ];
    const elements = scripts.map((s) => {
      const el = document.createElement('script');
      el.type = s.type;
      el.id = s.id;
      el.textContent = s.text;
      document.head.appendChild(el);
      return el;
    });

    return () => {
      document.title = HOME_META.title;
      if (desc) desc.content = HOME_META.description;
      elements.forEach((el) => document.head.removeChild(el));
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header variant="marketing" />
      <main id="main-content" tabIndex={-1}>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            GHG Protocol aligned
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            How we calculate{' '}
            <br className="hidden sm:block" />
            <span className="text-brand-600 dark:text-brand-400">your carbon footprint</span>
          </h1>
          <p className="mt-6 text-lg text-surface-600 dark:text-surface-400 max-w-3xl mx-auto leading-relaxed">
            Eco-Auditor applies emission factors from the EPA, eGRID and IPCC datasets to the activity data you import. Spend-based Scope 3 categories use Eco-Auditor internal estimates, and provisional factors are flagged.
            No black boxes, no mystery calculations — just transparent, reviewable carbon accounting.
          </p>
        </div>
      </section>

      {/* ─── In-page nav. It sticks BELOW the site header (57px on phones, 63px from
             md up); at top-0 it slid underneath it (F-C-22). ─── */}
      <nav className="sticky top-[57px] md:top-[63px] z-40 border-b border-surface-200 dark:border-surface-800 bg-white/90 dark:bg-surface-900/90 backdrop-blur-md overflow-x-auto">
        <div className="max-w-5xl mx-auto px-6 flex items-center gap-6 text-sm py-3">
          {[
            { href: '#standards', label: 'Standards' },
            { href: '#scope1', label: 'Scope 1' },
            { href: '#scope2', label: 'Scope 2' },
            { href: '#scope3', label: 'Scope 3' },
            { href: '#data-quality', label: 'Data Quality' },
            { href: '#factors', label: 'Emission Factors' },
            { href: '#faq', label: 'FAQ' },
          ].map((item) => (
            <a key={item.href} href={item.href} className="text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white whitespace-nowrap transition-colors">{item.label}</a>
          ))}
        </div>
      </nav>

      {/* ─── Standards ─── */}
      <section id="standards" className="max-w-5xl mx-auto px-6 py-16 scroll-mt-32">
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Aligned with global carbon accounting standards</h2>
          <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Eco-Auditor has been designed from the ground up to follow established GHG accounting frameworks — not proprietary black-box models. Every methodology decision is documented and auditable.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STANDARDS_TOP.map((s) => (
            <div key={s.name} className="card">
              <div className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider mb-1">{s.org}</div>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">{s.name}</h3>
              <p className="text-sm text-surface-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {STANDARDS_BOTTOM.map((s) => (
            <div key={s.name} className="card">
              <div className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider mb-1">{s.org}</div>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">{s.name}</h3>
              <p className="text-sm text-surface-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Scope Sections ─── */}
      {SCOPES.map((scope) => (
        <section key={scope.id} id={scope.id} className="scroll-mt-32 border-t border-surface-200 dark:border-surface-800">
          <div className="max-w-5xl mx-auto px-6 py-16">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-3 h-3 rounded-full bg-gradient-to-br ${scope.color}`} />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">{scope.badge}</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">{scope.title}</h2>
            <p className="text-surface-500 mt-1">{scope.subtitle}</p>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="card">
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">What's included</h3>
                <ul className="space-y-2">
                  {scope.examples.map((ex) => (
                    <li key={ex.label} className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
                      <svg className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {ex.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card">
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Calculation method</h3>
                <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{scope.method}</p>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* ─── Data Quality Hierarchy ─── */}
      <section id="data-quality" className="scroll-mt-32 border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Data confidence</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Not all data is equal. Every entry carries a confidence score, and the overall score shows how much of your inventory rests on metered activity data and how much on spend-based estimates.</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 mb-6 max-w-3xl mx-auto">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <strong>Eco-Auditor data-confidence score.</strong> This score is an internal decision-support indicator — not an assurance opinion and not a GHG Protocol certification. It is assigned from the activity category and the specificity of the factor applied, or taken from a confidence column in your import file when you supply one. Entries typed into the calculator are scored by their category the same way; calculator entries saved before that keep the fixed {LEGACY_MANUAL_ENTRY_CONFIDENCE}% they were stored with. The overall score weights each entry by its emissions, Σ(CO2e × score) ÷ Σ CO2e, so an estimate counts as much as it weighs in your total; a period whose entries were all saved before the {CATALOG_VERSION} factor catalog still shows the simple average of its entries' scores until they are restated. It is not externally standardized. A per-entry quality hierarchy, reviewer sign-off, and confidence overrides are planned, not shipped.
            </p>
          </div>
          <div className="space-y-3">
            {CONFIDENCE_ROWS.map((tier) => (
              <div key={tier.label} className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-4">
                  <div>
                    <div className="text-sm font-semibold text-surface-900 dark:text-white">{tier.label}</div>
                    <p className="text-xs text-surface-500 mt-0.5">{tier.desc}</p>
                  </div>
                </div>
                <div className="text-xs font-medium text-surface-600 dark:text-surface-400 whitespace-nowrap">
                  Confidence: <span className="font-semibold text-surface-800 dark:text-surface-200">{tier.confidence}%</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-surface-500 text-center">
            Your goal: move every material emissions source off spend-based estimates and onto metered activity data before filing.
          </p>
        </div>
      </section>

      {/* ─── Emission Factor Libraries ─── */}
      <section id="factors" className="scroll-mt-32 border-t border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Emission factor libraries</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">
              The libraries below are reviewed when the source agencies release new data. Spend-based Scope 3 factors are Eco-Auditor internal estimates rather than a published dataset. {FACTOR_PROVENANCE.provisional} of{' '}
              {FACTOR_PROVENANCE.total} factors are provisional — industry-typical values pending verification, including{' '}
              {PROVISIONAL_SCOPE12} in Scope 1/2 categories ({PROVISIONAL_SCOPE12_CATEGORIES.join(', ').toLowerCase()}) — and all
              provisional factors are flagged in generated reports. New entries are priced with the {CATALOG_VERSION} factor
              catalog; each entry keeps the catalog it was saved under (entries saved without one use the{' '}
              {LEGACY_CATALOG_VERSION} catalog), so a correction to a factor never changes a past total by itself.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: factorLabel('epa-efh-2025'), org: 'US EPA', scopes: ['Scope 1', 'Scope 2', 'Scope 3'], coverage: 'Stationary and mobile combustion, steam and heat, business travel, commuting and freight distances' },
              { name: factorLabel('epa-egrid-2023'), org: 'US EPA', scopes: ['Scope 2'], coverage: 'Subregion-level grid emission factors (lbs/MWh), location-based' },
              { name: factorLabel('ipcc-ar5-gwp100'), org: 'IPCC', scopes: ['Scope 1'], coverage: 'Global warming potentials for methane (CH₄) and refrigerants (F-gases)' },
              { name: factorLabel('epa-warm-2023'), org: 'US EPA', scopes: ['Scope 3'], coverage: 'Landfill, recycling and composting of mixed waste (AR4 GWPs, as EPA publishes them)' },
              { name: factorLabel('desnz-2026'), org: 'UK DESNZ', scopes: ['Scope 3'], coverage: 'Hotel stays in the United States, per room-night' },
            ].map((lib) => (
              <div key={lib.name} className="card">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-1">{lib.name}</h3>
                <p className="text-xs text-surface-600 dark:text-surface-400 mb-2">{lib.org}</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {lib.scopes.map((s) => <span key={s} className="badge-blue text-2xs">{s}</span>)}
                </div>
                <p className="text-xs text-surface-500">{lib.coverage}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="scroll-mt-32 border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Methodology FAQ</h2>
          </div>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-surface-900 dark:text-white list-none">
                  {faq.q}
                  <svg className="w-4 h-4 text-surface-600 dark:text-surface-400 transition-transform group-open:rotate-180 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </summary>
                <div className="px-5 pb-4 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 dark:from-brand-700 dark:to-brand-900 px-8 py-12 text-center">
          <div className="relative">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-3">Ready to build your carbon inventory?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-6 text-sm">
              {trialHeadline()} · No card required · {trialLimitsLabel()}. Import your first activity data by CSV and see how transparent emissions tracking should work.
            </p>
            <Link to="/signup/" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-sm rounded-lg transition-colors shadow-lg">
              Start Free Trial
            </Link>
          </div>
        </div>
      </section>
      </main>
      <Footer />
    </div>
  );
}
