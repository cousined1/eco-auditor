import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import Header from '../components/Header';
import { renderFact, trustFacts } from '@/content/trust-facts';

const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Security & Trust — Eco-Auditor",
  "description": "Eco-Auditor security practices: encryption at rest and in transit, SOC 2-aligned controls, data handling, access management, and security and compliance practices.",
};

export default function Security() {
  useEffect(() => {
    document.title = 'Security & Trust — Eco-Auditor | Data Protection and Compliance';

    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = 'Eco-Auditor uses enterprise-grade encryption (AES-256, TLS 1.3), SOC 2-aligned controls, role-based access, and automated data retention. Your carbon data is yours — we never share or sell it.';

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(SCHEMA);
    document.head.appendChild(script);

    return () => {
      document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs';
      if (desc) desc.content = 'Eco-Auditor gives small and mid-size businesses reviewable GHG emissions data. Upload bills, connect integrations, and generate Scope 1-3 reports aligned with the GHG Protocol.';
      document.head.removeChild(script);
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
            Enterprise-grade, SMB-priced
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            Security & trust
          </h1>
          <p className="mt-6 text-lg text-surface-500 dark:text-surface-400 max-w-3xl mx-auto leading-relaxed">
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
              'Data in transit: TLS 1.2 minimum, TLS 1.3 preferred',
              'Data at rest: AES-256 encryption for all stored data',
              'Database volumes encrypted at the storage layer',
              'Backups encrypted with separate key material',
            ]}
          />
          <TrustCard
            icon={<InfraIcon />}
            title="Infrastructure"
            items={[
              `Cloud infrastructure: ${renderFact(trustFacts.cloudHosting)}`,
              'Multi-region redundancy for production workloads',
              'DDoS protection and WAF at the edge',
              'Automated vulnerability scanning (weekly)',
            ]}
          />
          <TrustCard
            icon={<AccessIcon />}
            title="Access Control"
            items={[
              'Role-based access control (RBAC) per workspace',
              'SSO-ready: SAML 2.0 and OIDC on Pro plan',
              'API keys scoped to specific permissions',
              'Session timeout and automatic re-authentication',
            ]}
          />
          <TrustCard
            icon={<DataIcon />}
            title="Data Handling"
            items={[
              'Your data is yours. We never share or sell customer data.',
              'Document processing: files parsed, factors applied, source deleted on schedule',
              'Data retention policies configurable per workspace',
              'GDPR-aligned data processing agreement available',
            ]}
          />
          <TrustCard
            icon={<ComplianceIcon />}
            title="Compliance"
            items={[
              'SOC 2 Type II audit in progress (Q3 2026)',
              'Aligned with GDPR requirements',
              'Designed around CCPA requirements',
              'Carbon accounting methodology follows GHG Protocol',
            ]}
          />
          <TrustCard
            icon={<BackupIcon />}
            title="Backup & Recovery"
            items={[
              'Automated daily backups with 30-day retention',
              'Cross-region backup replication',
              'Point-in-time recovery (PITR) for databases',
              'Disaster recovery plan tested quarterly',
            ]}
          />
        </div>
      </section>

      {/* ─── Data handling details ─── */}
      <section className="border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-surface-900 dark:text-white">How we handle your data</h2>
            <p className="mt-3 text-surface-500 max-w-2xl mx-auto">Transparency about what happens to your uploaded documents, extracted data, and generated reports.</p>
          </div>
          <div className="space-y-6 max-w-3xl mx-auto">
            {[
              { q: 'Document upload and processing', a: 'When you upload a utility bill, invoice, or freight document, the file is encrypted and stored temporarily. Our AI extracts relevant data points (usage amounts, dates, provider names) and applies emission factors. Source documents can be auto-deleted after extraction based on your retention policy (default: 90 days).' },
              { q: 'Data sharing and third parties', a: 'We never share, sell, or license your emissions data to third parties. Data you upload is used exclusively to provide the Service — generating emissions estimates, audit trails, and compliance reports. We do not train AI models on customer data. Integrations with QuickBooks, Xero, or other platforms are read-only where possible and require explicit OAuth authorization.' },
              { q: 'Employee and contractor access', a: 'Production access is restricted to authorized engineering and support staff, requires multi-factor authentication, and is logged and audited monthly. Support staff access customer data only to resolve specific, documented support requests with workspace owner consent.' },
              { q: 'Data deletion on cancellation', a: 'When a subscription is canceled, customer data is retained for 90 days to allow for export and transition. After this period, all customer data is securely deleted from production systems, backups, and disaster recovery storage. Customers can request expedited deletion at any time.' },
            ].map((item) => (
              <details key={item.q} className="group rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-surface-900 dark:text-white list-none">
                  {item.q}
                  <svg className="w-4 h-4 text-surface-400 transition-transform group-open:rotate-180 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
            { label: 'Privacy Policy', to: '/privacy', desc: 'How we collect, use, and protect your personal data' },
            { label: 'Terms of Service', to: '/terms', desc: 'Legal terms governing use of the platform' },
            { label: 'Data Processing Addendum', to: '/dpa', desc: 'GDPR-aligned DPA for EU customers' },
            { label: 'Contact Security Team', to: '/contact', desc: 'Report vulnerabilities or request a security review' },
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
              <Link to="/contact" className="inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-surface-50 text-brand-700 font-semibold text-sm rounded-lg transition-colors shadow-lg">
                Contact Security Team
              </Link>
              <a href="mailto:hello@developer312.com?subject=Security%20Question" className="inline-flex items-center justify-center px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-medium text-sm rounded-lg transition-colors border border-white/20">
                Email Us
              </a>
            </div>
          </div>
        </div>
      </section>
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
      <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">{title}</h3>
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
function BackupIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3a7 7 0 017 7v1" /><path d="M17 11l-2-2-2 2" /><path d="M10 17a7 7 0 01-7-7V9" /><path d="M3 9l2 2 2-2" /></svg>;
}
