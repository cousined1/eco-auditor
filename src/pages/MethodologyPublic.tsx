import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';
import { factorLabel } from '@/lib/emission-factors/registry';

const METHODOLOGY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Eco-Auditor Methodology — GHG Protocol Carbon Accounting",
  "description": "How Eco-Auditor calculates Scope 1, 2, and 3 emissions using EPA, eGRID, and IPCC AR5 emission factors, aligned with the GHG Protocol Corporate Standard.",
  "datePublished": "2026-05-21",
};

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Which emission factor databases does Eco-Auditor use?", "acceptedAnswer": { "@type": "Answer", "text": "Eco-Auditor uses the EPA GHG Emission Factors Hub, eGRID (location-based electricity), and IPCC AR5 GWP-100 values." } },
    { "@type": "Question", "name": "Is Eco-Auditor aligned with the GHG Protocol?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Eco-Auditor follows the GHG Protocol Corporate Accounting and Reporting Standard for Scope 1 and 2, and the Corporate Value Chain (Scope 3) Standard for Scope 3 emissions." } },
    { "@type": "Question", "name": "How does Eco-Auditor handle data quality?", "acceptedAnswer": { "@type": "Answer", "text": "Every entry receives a confidence score based on its activity category and the specificity of the emission factor applied — highest for metered electricity and fuel against published EPA and eGRID factors, lowest for spend-based Scope 3 estimates. You can supply your own confidence value in the import file." } },
    { "@type": "Question", "name": "What compliance frameworks does Eco-Auditor support?", "acceptedAnswer": { "@type": "Answer", "text": "Eco-Auditor produces a GHG Protocol-aligned Scope 1-3 inventory and a PDF emissions summary you can use as source material for California SB 253, EU CBAM, annual inventories, and customer procurement questionnaires. Framework-specific filing templates are on the roadmap." } },
  ]
};

const SCOPES = [
  {
    id: 'scope1',
    title: 'Scope 1 — Direct Emissions',
    subtitle: 'Sources you own or control',
    color: 'from-red-500 to-orange-500',
    examples: ['Natural gas combustion in boilers and furnaces', 'Company-owned vehicle fuel', 'Refrigerant leakage from HVAC equipment', 'On-site diesel generators', 'Process emissions from manufacturing'],
    method: 'Activity data (fuel bills, meter readings) × EPA emission factors. Refrigerant leakage calculated as refrigerant mass × IPCC AR5 GWP-100.',
    badge: 'GHG Protocol required',
  },
  {
    id: 'scope2',
    title: 'Scope 2 — Purchased Energy',
    subtitle: 'Indirect emissions from electricity, steam, heat, cooling',
    color: 'from-blue-500 to-indigo-500',
    examples: ['Purchased electricity (grid)', 'Purchased steam or hot water', 'Purchased cooling / chilled water', 'On-site solar (net metering)'],
    method: 'Location-based: kWh × eGRID subregion emission factor (lbs/MWh).',
    badge: 'Location-based',
  },
  {
    id: 'scope3',
    title: 'Scope 3 — Value Chain',
    subtitle: 'All other indirect emissions in your value chain',
    color: 'from-emerald-500 to-teal-500',
    examples: ['Purchased goods & services (spend-based)', 'Upstream transportation & distribution', 'Business travel (air, rail, hotel)', 'Employee commuting', 'Downstream transportation', 'Waste generated in operations'],
    method: 'Common Scope 3 categories via spend-based estimates applied to procurement spend data. These category-average factors are Eco-Auditor internal estimates, not a published EEIO dataset.',
    badge: 'Spend-based Scope 3',
  },
];

// The confidence values the engine actually assigns, per activity category
// (emissions-engine.cjs CONFIDENCE_BY_CATEGORY). Previously this page described
// a 5-level L1-L5 quality hierarchy with its own confidence bands; no such
// scoring exists in the product, so it is documented below as planned work
// rather than presented as a current capability.
const CONFIDENCE_BY_ACTIVITY = [
  { label: 'Purchased electricity', desc: 'Metered kWh against a published eGRID subregion factor', confidence: '97%' },
  { label: 'Stationary combustion', desc: 'Fuel volume against an EPA Emission Factors Hub factor', confidence: '90%' },
  { label: 'Mobile combustion', desc: 'Fuel volume against an EPA Emission Factors Hub factor', confidence: '88%' },
  { label: 'Waste, commuting', desc: 'Activity or spend against a category-average factor', confidence: '75%' },
  { label: 'Transport, business travel, fuel & energy', desc: 'Activity or spend against a category-average factor', confidence: '72%' },
  { label: 'Purchased goods, capital goods, leased assets', desc: 'Spend-based estimate against a category-average factor', confidence: '65%' },
];

export default function MethodologyPublic() {
  useEffect(() => {
    document.title = 'Carbon Accounting Methodology — Eco-Auditor | GHG Protocol Alignment';

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = 'Eco-Auditor follows the GHG Protocol Corporate Standard for Scope 1-3 emissions. EPA, eGRID, and IPCC AR5 factors. Transparent, reviewable carbon accounting methodology.';

    // Structured data
    const scripts = [
      { type: 'application/ld+json', id: 'methodology-schema', text: JSON.stringify(METHODOLOGY_SCHEMA) },
      { type: 'application/ld+json', id: 'faq-schema', text: JSON.stringify(FAQ_SCHEMA) },
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
      document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs';
      if (desc) desc.content = 'Eco-Auditor gives small and mid-size businesses reviewable GHG emissions data. Import activity data by CSV, connect integrations (roadmap), and generate Scope 1-3 reports aligned with the GHG Protocol.';
      elements.forEach((el) => document.head.removeChild(el));
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header variant="marketing" />
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            GHG Protocol aligned
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            How we calculate<br className="hidden sm:block" />
            <span className="text-brand-600 dark:text-brand-400">your carbon footprint</span>
          </h1>
          <p className="mt-6 text-lg text-surface-500 dark:text-surface-400 max-w-3xl mx-auto leading-relaxed">
            Every number in Eco-Auditor traces back to the activity data you imported, the emission factor applied, and the published dataset that factor came from.
            No black boxes, no mystery calculations — just transparent, reviewable carbon accounting.
          </p>
        </div>
      </section>

      {/* ─── In-page nav ─── */}
      <nav className="sticky top-0 z-40 border-b border-surface-200 dark:border-surface-800 bg-white/90 dark:bg-surface-900/90 backdrop-blur-md overflow-x-auto">
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
      <section id="standards" className="max-w-5xl mx-auto px-6 py-16 scroll-mt-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Aligned with global carbon accounting standards</h2>
          <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Eco-Auditor has been designed from the ground up to follow established GHG accounting frameworks — not proprietary black-box models. Every methodology decision is documented and auditable.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { name: 'GHG Protocol Corporate Standard', org: 'WRI / WBCSD', desc: 'Scope 1 and 2 accounting, organizational boundary setting (operational control), and base year emissions tracking.' },
            { name: 'GHG Protocol Scope 3 Standard', org: 'WRI / WBCSD', desc: 'Corporate Value Chain (Scope 3) Standard with spend-based estimates for common Scope 3 categories.' },
            { name: 'California SB 253 / SB 261', org: 'CARB', desc: 'California\'s first-year Scope 1 and Scope 2 reporting deadline is August 10, 2026, for covered entities (companies doing business in California with over $1B revenue). Smaller suppliers may still receive emissions-data requests from covered customers. Eco-Auditor helps assemble traceable data for both direct reporting and customer-driven requests.' },
          ].map((s) => (
            <div key={s.name} className="card">
              <div className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider mb-1">{s.org}</div>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">{s.name}</h3>
              <p className="text-sm text-surface-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { name: 'EU CBAM', org: 'European Commission', desc: 'Eco-Auditor can support the collection and organization of emissions inputs used in CBAM-related workflows. It does not replace an authorized declarant, customs filing, legal review, or required verification. Applicability depends on importer status and goods traded.' },
            { name: 'EPA GHG Inventory Guidance', org: 'US EPA', desc: 'Emission factor libraries from the EPA GHG Emission Factors Hub and eGRID.' },
          ].map((s) => (
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
        <section key={scope.id} id={scope.id} className="scroll-mt-16 border-t border-surface-200 dark:border-surface-800">
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
                    <li key={ex} className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
                      <svg className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {ex}
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
      <section id="data-quality" className="scroll-mt-16 border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Data confidence</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Not all data is equal. Every entry carries a confidence score so you can see which numbers rest on metered activity data and which are spend-based estimates.</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 mb-6 max-w-3xl mx-auto">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <strong>Eco-Auditor data-confidence score.</strong> This score is an internal decision-support indicator — not an assurance opinion and not a GHG Protocol certification. It is assigned from the activity category and the specificity of the factor applied, or taken from a confidence column in your import file when you supply one. It is not externally standardized. A per-entry quality hierarchy, reviewer sign-off, and confidence overrides are planned, not shipped.
            </p>
          </div>
          <div className="space-y-3">
            {CONFIDENCE_BY_ACTIVITY.map((tier) => (
              <div key={tier.label} className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-4">
                  <div>
                    <div className="text-sm font-semibold text-surface-900 dark:text-white">{tier.label}</div>
                    <p className="text-xs text-surface-500 mt-0.5">{tier.desc}</p>
                  </div>
                </div>
                <div className="text-xs font-medium text-surface-600 dark:text-surface-400 whitespace-nowrap">
                  Confidence: <span className="font-semibold text-surface-800 dark:text-surface-200">{tier.confidence}</span>
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
      <section id="factors" className="scroll-mt-16 border-t border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Emission factor libraries</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">We aggregate and maintain emission factors from authoritative sources, updated annually. Every factor is citation-tracked to its source document.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: factorLabel('epa-efh-2025'), org: 'US EPA', scopes: ['Scope 1', 'Scope 2'], coverage: 'Stationary combustion, mobile, fugitive, electricity' },
              { name: factorLabel('epa-egrid-2023'), org: 'US EPA', scopes: ['Scope 2'], coverage: 'Subregion-level grid emission factors (lbs/MWh), location-based' },
              { name: factorLabel('ipcc-ar5-gwp100'), org: 'IPCC', scopes: ['Scope 1'], coverage: 'Global warming potentials for methane (CH₄) and refrigerants (F-gases)' },
            ].map((lib) => (
              <div key={lib.name} className="card">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-1">{lib.name}</h3>
                <p className="text-xs text-surface-400 mb-2">{lib.org}</p>
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
      <section id="faq" className="scroll-mt-16 border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Methodology FAQ</h2>
          </div>
          <div className="space-y-4">
            {[
              { q: 'Which emission factor databases does Eco-Auditor use?', a: 'Eco-Auditor uses the EPA GHG Emission Factors Hub, eGRID (location-based electricity), and IPCC AR5 GWP-100 values.' },
              { q: 'Is Eco-Auditor aligned with the GHG Protocol?', a: 'Eco-Auditor follows the GHG Protocol Corporate Accounting and Reporting Standard (Scope 1 & 2) and the Corporate Value Chain (Scope 3) Standard. Eco-Auditor defaults to the operational-control approach for initial setup. The GHG Protocol also permits equity-share and financial-control approaches. Organizations should select and document the boundary method appropriate to their structure and reporting requirements.' },
              { q: 'How does Eco-Auditor handle data quality?', a: 'Every entry receives a confidence score based on its activity category and the specificity of the emission factor applied — highest for metered electricity and fuel against published EPA and eGRID factors, lowest for spend-based Scope 3 estimates. The aggregate score is carried through to the report so reviewers can see how much of an inventory rests on estimates. A per-entry quality hierarchy and a review queue are planned.' },
              { q: 'What compliance frameworks does Eco-Auditor support?', a: 'Eco-Auditor produces a GHG Protocol-aligned Scope 1-3 inventory and a PDF emissions summary you can use as source material for California SB 253, EU CBAM, annual inventories, and procurement questionnaires. Framework-specific filing templates are on the roadmap.' },
              { q: 'How often are emission factors updated?', a: 'We update factors when source agencies release new data. Every factor records the publisher, version, and data year it came from, so you can see exactly which vintage produced a number. A published change log is on the roadmap.' },
            ].map((faq) => (
              <details key={faq.q} className="group rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-surface-900 dark:text-white list-none">
                  {faq.q}
                  <svg className="w-4 h-4 text-surface-400 transition-transform group-open:rotate-180 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
              14-day free trial · No card required · Cancel anytime. Import your first activity data by CSV and see how transparent emissions tracking should work.
            </p>
            <Link to="/signup" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-sm rounded-lg transition-colors shadow-lg">
              Start Free Trial
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
