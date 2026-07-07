import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';

const METHODOLOGY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Eco-Auditor Methodology — GHG Protocol Carbon Accounting",
  "description": "How Eco-Auditor calculates Scope 1, 2, and 3 emissions using EPA, eGRID, and IPCC AR6 emission factors, aligned with the GHG Protocol Corporate Standard.",
  "datePublished": "2026-05-21",
};

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Which emission factor databases does Eco-Auditor use?", "acceptedAnswer": { "@type": "Answer", "text": "Eco-Auditor uses the EPA GHG Emission Factors Hub, eGRID (location-based electricity), and IPCC AR6 GWP-100 values." } },
    { "@type": "Question", "name": "Is Eco-Auditor aligned with the GHG Protocol?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Eco-Auditor follows the GHG Protocol Corporate Accounting and Reporting Standard for Scope 1 and 2, and the Corporate Value Chain (Scope 3) Standard for Scope 3 emissions." } },
    { "@type": "Question", "name": "How does Eco-Auditor handle data quality?", "acceptedAnswer": { "@type": "Answer", "text": "Every data point is scored on a 5-level quality hierarchy: direct measurement > primary source data > industry average > proxy data > default estimate. Low-confidence entries are flagged for human review." } },
    { "@type": "Question", "name": "What compliance frameworks does Eco-Auditor support?", "acceptedAnswer": { "@type": "Answer", "text": "You can export your inventory to support California SB 253 and EU CBAM reporting, as well as GHG Protocol annual inventories and customer procurement questionnaires." } },
  ]
};

const SCOPES = [
  {
    id: 'scope1',
    title: 'Scope 1 — Direct Emissions',
    subtitle: 'Sources you own or control',
    color: 'from-red-500 to-orange-500',
    examples: ['Natural gas combustion in boilers and furnaces', 'Company-owned vehicle fuel', 'Refrigerant leakage from HVAC equipment', 'On-site diesel generators', 'Process emissions from manufacturing'],
    method: 'Activity data (fuel bills, meter readings) × EPA emission factors. Refrigerant leakage calculated via OA replenishment × IPCC AR6 GWP.',
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
    method: 'Common Scope 3 categories via spend-based (EXIOBASE-style EEIO) estimates applied to procurement spend data.',
    badge: 'Spend-based Scope 3',
  },
];

const QUALITY_TIERS = [
  { level: 1, label: 'Direct Measurement', desc: 'Continuous monitoring or stack testing', confidence: '95–100%' },
  { level: 2, label: 'Primary Source Data', desc: 'Utility bills, fuel receipts, meter readings', confidence: '80–95%' },
  { level: 3, label: 'Industry Average Factors', desc: 'EPA, eGRID, and spend-based EEIO factors applied to activity data', confidence: '60–80%' },
  { level: 4, label: 'Proxy Data', desc: 'Scaled from similar facilities or time periods', confidence: '40–60%' },
  { level: 5, label: 'Default Estimate', desc: 'Statistical imputation where no source data exists', confidence: '< 40%' },
];

export default function MethodologyPublic() {
  useEffect(() => {
    document.title = 'Carbon Accounting Methodology — Eco-Auditor | GHG Protocol Alignment';

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = 'Eco-Auditor follows the GHG Protocol Corporate Standard for Scope 1-3 emissions. EPA, eGRID, and IPCC AR6 factors. Transparent, audit-ready carbon accounting methodology.';

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
      if (desc) desc.content = 'Eco-Auditor gives small and mid-size businesses audit-ready GHG emissions data. Upload bills, connect integrations, and generate Scope 1-3 reports aligned with the GHG Protocol.';
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
            Every number in Eco-Auditor traces back to a methodology, an emission factor, a source document, and a reviewer.
            No black boxes, no mystery calculations — just transparent, audit-ready carbon accounting.
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
            { name: 'California SB 253 / SB 261', org: 'CARB', desc: 'Export your inventory to support California\'s Climate Corporate Data Accountability Act disclosures.' },
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
            { name: 'EU CBAM', org: 'European Commission', desc: 'Export your inventory to support Carbon Border Adjustment Mechanism reporting for importers of carbon-intensive goods into the EU.' },
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
            <h2 className="text-2xl md:text-3xl font-bold text-surface-900 dark:text-white">Data quality hierarchy</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Not all data is equal. Every entry in your carbon inventory is scored on a 5-level quality scale so you know what is defensible and what needs improvement.</p>
          </div>
          <div className="space-y-3">
            {QUALITY_TIERS.map((tier) => (
              <div key={tier.level} className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                    tier.level <= 1 ? 'bg-brand-600' :
                    tier.level <= 2 ? 'bg-brand-500' :
                    tier.level <= 3 ? 'bg-amber-500' :
                    tier.level <= 4 ? 'bg-orange-500' : 'bg-risk-high'
                  }`}>
                    L{tier.level}
                  </div>
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
            Entries below L3 confidence are flagged for review. Your goal: move every material emissions source to L2 or above before filing.
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
              { name: 'EPA GHG Factor Hub 2024', org: 'US EPA', scopes: ['Scope 1', 'Scope 2'], coverage: 'Stationary combustion, mobile, fugitive, electricity' },
              { name: 'eGRID 2024', org: 'US EPA', scopes: ['Scope 2'], coverage: 'Subregion-level grid emission factors (lbs/MWh), location-based' },
              { name: 'IPCC AR6 GWP-100', org: 'IPCC', scopes: ['Scope 1'], coverage: 'Global warming potentials for methane (CH₄) and refrigerants (F-gases)' },
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
              { q: 'Which emission factor databases does Eco-Auditor use?', a: 'Eco-Auditor uses the EPA GHG Emission Factors Hub, eGRID (location-based electricity), and IPCC AR6 GWP-100 values.' },
              { q: 'Is Eco-Auditor aligned with the GHG Protocol?', a: 'Yes. Eco-Auditor follows the GHG Protocol Corporate Accounting and Reporting Standard (Scope 1 & 2) and the Corporate Value Chain (Scope 3) Standard. Our organizational boundary default is operational control, consistent with the Protocol\'s recommended approach.' },
              { q: 'How does Eco-Auditor handle data quality?', a: 'Every data point receives a confidence score on our 5-level quality hierarchy — from direct measurement (L1) down to default estimates (L5). Entries below L3 are surfaced for human review. This scoring is carried through to reports so reviewers know exactly which numbers are primary and which are estimated.' },
              { q: 'What compliance frameworks does Eco-Auditor support?', a: 'You can export your inventory to support California SB 253 and EU CBAM reporting, as well as customer procurement questionnaires (CDP, EcoVadis-style) and annual GHG inventories.' },
              { q: 'How often are emission factors updated?', a: 'We update factors annually when source agencies release new data (EPA GHG Emission Factors Hub in April, eGRID in January). We also publish change logs so you can assess the impact of factor updates on your baseline.' },
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
              Start free, no credit card required. Upload your first utility bills and see how transparent emissions tracking should work.
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
