import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';
// Privacy/Terms/DPA links live in Footer. Without it these pages had no legal
// links at all — Google and Meta both require an accessible privacy policy
// from the ad destination. See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-9).
import Footer from '../components/Footer';
import { trustFacts, renderFact, contactDetails } from '@/content/trust-facts';
import { dataFacts } from '@/content/data-facts';
import routeMeta from '@/content/route-meta.json';

// Title and description come from src/content/route-meta.json, the file the
// prerender step writes into the HTML, so raw and JS-rendered meta agree
// (F-A-12). The JSON-LD reads the same entry, and unmounting restores the
// homepage entry rather than a retyped copy of it.
const SECURITY_META = routeMeta['/security'];
const HOME_META = routeMeta['/'];

const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": SECURITY_META.title,
  "description": SECURITY_META.description,
};

export default function Security() {
  useEffect(() => {
    document.title = SECURITY_META.title;

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = SECURITY_META.description;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(SCHEMA);
    document.head.appendChild(script);

    return () => {
      document.title = HOME_META.title;
      if (desc) desc.content = HOME_META.description;
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header variant="marketing" />
      <main id="main-content" tabIndex={-1}>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          {/* COUNSEL-REVIEW: F-C-18 - the pill that stood above this heading graded the security as enterprise level and called the product SMB-priced. Nothing in the repo substantiates the grade (this page itself says no SOC 2 audit has been completed, and the DPA lists no MFA, penetration test or disaster recovery), so the pill is removed rather than reworded. claims.ts lists the claim as withdrawn (F-C-18) and tests/claims-honesty.test.ts keeps it off this page. */}
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            Security & trust
          </h1>
          <p className="mt-6 text-lg text-surface-600 dark:text-surface-400 max-w-3xl mx-auto leading-relaxed">
            Your emissions data is sensitive — it tells the world how your business runs.
            We treat it that way. Here's exactly how we protect it.
          </p>
        </div>
      </section>

      {/* ─── Trust Grid ─── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TrustCard
            icon={<EncryptionIcon />}
            title="Encryption"
            items={[
              // COUNSEL-REVIEW: VF-14 (post-web) - the minimum on the next line is the trustFacts value (src/content/trust-facts.ts), which no file in the repo can evidence: it is a Cloudflare zone setting (SSL/TLS, Edge Certificates, Minimum TLS Version). The fact stays verified because verified:false would print "(verify before publication)" in this list. Privacy Section 10, DPA Section 7 and Annex II say TLS 1.2+ on the same footing, each marked. NEEDS-OWNER: check the Cloudflare setting and confirm it reads TLS 1.2 or higher, or remove the line.
              `Data in transit: ${renderFact(trustFacts.encryptionInTransitMinimum)} minimum (prefers ${renderFact(trustFacts.preferredTransport)})`,
              'HTTPS enforced across the entire application',
              // COUNSEL-REVIEW: F-A-06 - the first-party "AES-256" claim had no evidence; attributed to the provider, which publishes encryption at rest in its privacy policy (insforge.dev/privacy, section 7, read 2026-09-30). NEEDS-OWNER: confirm the project runs on InsForge Cloud and add the provider link.
              'Data at rest: encrypted by our database provider (InsForge)',
            ]}
          />
          <TrustCard
            icon={<InfraIcon />}
            title="Infrastructure"
            items={[
              // COUNSEL-REVIEW: F-A-13 - providers named from repo evidence (railway.toml and Railway proxy handling in server.cjs, Cloudflare handling in server.cjs, @insforge/sdk and the CSP connect-src). No region is stated because none is evidenced. NEEDS-OWNER: confirm each provider and region; the full list is DPA Annex III.
              'Application hosted on Railway, database and sign-in on InsForge, and site traffic served through Cloudflare (full list in the DPA)',
              'Security headers (CSP, HSTS) on all responses',
              'Rate limiting on API endpoints',
            ]}
          />
          <TrustCard
            icon={<AccessIcon />}
            title="Access Control"
            items={[
              'Sign-in via OAuth (InsForge)',
              // COUNSEL-REVIEW: VF-10 (post-web) - this item said Postgres row-level security isolates each workspace's data. Row-level security covers the records-API path only. The server, the app's main read and write path since K2, runs its writes with row security off (SET LOCAL row_security = off in server.cjs and server-entry-routes.cjs) and scopes every query by the company_id it resolves from the signed-in user (requireCompanyAccess), so tenants are separated by those checks as well. The item now names both layers, as the audit proposed (CLM-52); tests/legal-evidence-coupling.test.tsx fails if the page goes back to naming row-level security alone while the server bypasses it. This is not a tenant-isolation guarantee: the data and security lanes own that probe. NEEDS-OWNER: confirm both layers are what you want to publish.
              'Each workspace’s data is isolated by Postgres row-level security and by server-side tenant checks',
              'Session timeout and automatic re-authentication',
            ]}
          />
          <TrustCard
            icon={<DataIcon />}
            title="Data Handling"
            items={[
              // COUNSEL-REVIEW: D-7 - "We never share or sell customer data." was absolute, and the DPA names the providers customer data is shared with (Annex III: Railway, InsForge, Cloudflare, Stripe, Google). Counsel: Privacy Section 8 also allows disclosure required by law; decide whether to mirror that exception here. tests/sweep-copy-render.test.ts fails if any page says "never share" again.
              'Your data is yours. We do not sell customer data; we share it only with the service providers listed in DPA Annex III.',
              'CSV activity data you import is parsed and emission factors are applied; the file itself is not stored, and you can delete the resulting entries at any time',
              'Payments processed by Stripe — we never store card details',
              // COUNSEL-REVIEW: F-A-20 (VF-4 post-web) - describes what the export contains today, rendered from src/content/data-facts.ts. This marker used to say the entry SELECT in server.cjs omits factor, CO2e, activity date and notes; that has been false since K2 (F-B-08): loadEmissionEntriesForExport selects every entry column, and the file also carries the company name and industry, facilities, the details of each report and the import log. tests/export-claim-coupling.test.ts fails when a query changes without the module. NEEDS-OWNER: the Privacy Policy and the DPA also say what the file leaves out and when it caps; say here too if you want this card to carry them.
              `Export your data at any time from Settings — a machine-readable JSON download of your ${dataFacts.export.contents}`,
              // COUNSEL-REVIEW: VF-2 (post-web) - the item named what the control removes and nothing about reports. The delete-data handler never touches the reports table, and a stored report keeps a copy of the entries it covers (snapshot and PDF), so the item now says reports are not part of the deletion. Same sentence as Settings, Privacy Section 9, the DPA and the Terms (data-facts.ts); tests/legal-evidence-coupling.test.tsx ties it to the handler. OWNER DECISION: whether the control should also delete draft reports (see the Privacy Policy marker in Section 9).
              `“Delete my audit data” in Settings removes ${dataFacts.deleteAuditData.removes} immediately. ${dataFacts.deleteAuditData.reports}. Full account deletion is available via support`,
            ]}
          />
          <TrustCard
            icon={<ComplianceIcon />}
            title="Compliance"
            items={[
              'Privacy and data-processing controls designed to support customers’ GDPR and CCPA obligations. See the Privacy Policy and DPA for scope, roles, subprocessors, retention, and request procedures.',
              // COUNSEL-REVIEW: VF-1 (post-web) - this item said the methodology "follows" the GHG Protocol standards. The claims register (claims.ts, ghg-protocol-aligned) allows only "aligned with": alignment is not certification, the base year is stored but nothing recalculates against it, and Terms section 18 says Developer312 does not represent that the Service satisfies the GHG Protocol. The wording is now "aligned with", with a pointer to the Methodology page, which maps Scope 1 and 2 to the Corporate Standard and Scope 3 to the Corporate Value Chain Standard. The claim carries forbidden_patterns, and tests/claims-honesty.test.ts fails if a public page says "follows" again. NEEDS-OWNER: "security" is not in the claim's approved_surfaces (homepage, pricing, methodology, sample-report): approve this surface in claims.ts or drop the item.
              'Carbon accounting methodology is aligned with the GHG Protocol Corporate Standard and Scope 3 Standard (see the Methodology page for scope and limits)',
              // COUNSEL-REVIEW: F-A-06 - "in progress (Q3 2026)" had no auditor engagement or readiness artifact and the quarter ends 2026-09-30, so a plain negative statement replaces it. NEEDS-OWNER: state an engagement only if an auditor engagement letter exists.
              'No SOC 2 audit has been completed',
            ]}
          />
        </div>
      </section>

      {/* ─── Data handling details ─── */}
      <section className="border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-surface-900 dark:text-white">How we handle your data</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Transparency about what happens to your imported activity data, calculated emissions, and generated reports.</p>
          </div>
          <div className="space-y-6 max-w-3xl mx-auto">
            {[
              { q: 'Data import and processing', a: 'When you import a CSV of activity data, we apply emission factors to each row and store the resulting entries; the file itself is not stored. You can delete your entries and facilities at any time with “Delete my audit data” in Settings.' },
              // F-A-06 (R5 row 16): the QuickBooks/Xero integration sentence was removed - no such integrations exist.
              // COUNSEL-REVIEW: F-A-12 - the sentence also named "audit trails" and "compliance reports" as what the data is used for. The product has neither (no audit trail; the PDF is an emissions summary), so the outputs now name what exists. The purpose limit itself is unchanged.
              // COUNSEL-REVIEW: D-7 - same reason and same wording as the Data Handling card above: "We never share, sell, or license your emissions data to third parties" contradicted the named subprocessors in DPA Annex III. The purpose sentence and the no-training sentence are unchanged.
              { q: 'Data sharing and third parties', a: 'We do not sell or license your emissions data; we share it only with the service providers listed in DPA Annex III. Data you upload is used exclusively to provide the Service — generating emissions estimates and PDF emissions summaries. We do not train AI models on customer data.' },
              // COUNSEL-REVIEW: F-A-06 (R5 row 9) - "requires multi-factor authentication, and is logged and audited monthly" removed: no access-review log or MFA evidence in the repo. The answer's two remaining sentences, that production access is restricted to authorized staff and that support staff see customer data only to resolve documented requests with workspace owner consent, have no evidence in the repo either (the final web verification could not verify them) and were left as drafted. NEEDS-OWNER: confirm each reflects practice (who holds production access, and that support access needs the workspace owner's consent) or remove it; counsel decides whether a sentence without evidence may stay.
              { q: 'Employee and contractor access', a: 'Production access is restricted to authorized engineering and support staff. Support staff access customer data only to resolve specific, documented support requests with workspace owner consent.' },
              // COUNSEL-REVIEW: F-A-20/F-D-06 - states that nothing is deleted automatically and what "Delete my audit data" leaves behind. The DELETE statements that run only when a customer asks are the two in delete-data, the company-scoped per-entry DELETE /api/entries/:id in server-entry-routes.cjs, the facility DELETE in server-company-routes.cjs and the CSV import undo in server-csv-import-store.cjs. NEEDS-OWNER: confirm the runbook for full account deletion covers every table listed in F-A-20. VF-2 / VF-4 (post-web): the answer now also renders the description of the export and the sentence that generated reports are not part of the deletion, both from src/content/data-facts.ts (evidence and asks: the Privacy Policy markers in Section 9).
              // COUNSEL-REVIEW: K3 follow-up (VERIFY-W2A-DATA F5) - the one automatic deletion is the trigger reports_prune_drafts (migrations/20260930110000_report-snapshots.sql): storing a new frozen draft report deletes the same company's older unsigned drafts beyond the newest 25 (MAX_DRAFT_REPORTS in src/lib/reports/report-limits.cjs); signed-off reports are never deleted by it and a pruned draft cannot be recovered. Same sentence as Privacy Section 9, Terms Section 9 and DPA Section 11. OWNER DECISION: is a 25-draft bound acceptable?
              { q: 'Data export and deletion', a: `You can export your data at any time from Settings as a machine-readable JSON download of your ${dataFacts.export.contents}, and “Delete my audit data” in Settings removes all ${dataFacts.deleteAuditData.removes} immediately. ${dataFacts.deleteAuditData.reports}. Nothing is deleted automatically, with one exception: we keep only the 25 most recent unsigned draft reports per workspace and delete older drafts when a new report is generated; signed-off reports are not deleted this way. Nothing else is deleted automatically, including when a subscription ends: your account record, company profile, import history and billing record stay until you request full account deletion via support; deletion requests are processed within ${renderFact(trustFacts.accountDeletionRequestWindowDays)} days. Deleted data may remain in database backups until those backups expire or are deleted.` },
            ].map((item) => (
              <details key={item.q} className="group rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-surface-900 dark:text-white list-none">
                  {item.q}
                  <svg className="w-4 h-4 text-surface-600 dark:text-surface-400 transition-transform group-open:rotate-180 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </summary>
                <div className="px-5 pb-4 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Reports & Compliance ─── */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-surface-900 dark:text-white">Trust documentation</h2>
          <p className="mt-3 text-surface-500 max-w-2xl mx-auto">We publish our security and compliance documentation transparently. No NDA required for standard materials.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Privacy Policy', to: '/privacy/', desc: 'How we collect, use, and protect your personal data' },
            { label: 'Terms of Service', to: '/terms/', desc: 'Legal terms governing use of the platform' },
            // COUNSEL-REVIEW: F-A-20 (D-14) - the description used to call the DPA a compliance status, which implied that signing it makes a customer compliant.
            { label: 'Data Processing Addendum', to: '/dpa/', desc: 'Data Processing Addendum for EU customers' },
            { label: 'Contact Security Team', to: '/contact/?topic=security', desc: 'Report vulnerabilities or request a security review' },
          ].map((doc) => (
            <Link key={doc.label} to={doc.to} className="card hover:shadow-md transition-shadow group">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-1 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{doc.label}</h3>
              <p className="text-xs text-surface-500">{doc.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 dark:from-brand-700 dark:to-brand-900 px-8 py-12 text-center">
          <div className="relative">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-3">Questions about security?</h2>
            <p className="text-brand-100 max-w-lg mx-auto mb-6 text-sm">
              We're happy to answer specific questions about our security posture, infrastructure, or compliance roadmap.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/contact/" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-sm rounded-lg transition-colors shadow-lg">
                Contact Security Team
              </Link>
              <a href={`mailto:${contactDetails.email}?subject=Security%20Question`} className="inline-flex items-center justify-center px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-medium text-sm rounded-lg transition-colors border border-white/20">
                Email Us
              </a>
            </div>
          </div>
        </div>
      </section>
      </main>
      <Footer />
    </div>
  );
}

/* ─── Sub-components ─── */

function TrustCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className="card">
      <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-brand-600 dark:text-brand-400 mb-4">
        {icon}
      </div>
      {/* F-C-21: h2, not h3. The cards follow the page's h1 directly, so an h3 skipped a level. */}
      <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">{title}</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-400">
            <svg className="w-3.5 h-3.5 text-brand-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Icons ─── */

function EncryptionIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="8" width="12" height="11" rx="1.5" /><path d="M6.5 8V5.5a3.5 3.5 0 017 0V8" /><circle cx="10" cy="12.5" r="1.5" /></svg>;
}
function InfraIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 17l5-5 4 4 7-7" /><path d="M15 9h3v3" /></svg>;
}
function AccessIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="6" r="3.5" /><path d="M3 18c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /></svg>;
}
function DataIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h12v12H4z" /><path d="M8 4v12M4 8h12" /></svg>;
}
function ComplianceIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H3v-4l-3-3 3-3V5h4l3-3z" /><path d="M7 10l2 2 4-4" /></svg>;
}
