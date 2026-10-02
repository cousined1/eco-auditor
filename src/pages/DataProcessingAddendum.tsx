import { useState } from 'react';
import { contactDetails } from '@/content/trust-facts';
import { dataFacts } from '@/content/data-facts';

const SECTIONS = [
  { id: 'purpose', label: 'Purpose & Scope' },
  { id: 'definitions', label: 'Definitions' },
  { id: 'roles', label: 'Roles of the Parties' },
  { id: 'subject-matter', label: 'Subject Matter & Duration' },
  { id: 'processing-instructions', label: 'Processing Instructions' },
  { id: 'confidentiality', label: 'Confidentiality' },
  { id: 'security', label: 'Security of Processing' },
  { id: 'subprocessors', label: 'Use of Subprocessors' },
  { id: 'data-subject-rights', label: 'Data Subject Rights' },
  { id: 'breach-notification', label: 'Breach Notification' },
  { id: 'return-deletion', label: 'Return & Deletion' },
  { id: 'audit-rights', label: 'Information & Audit Rights' },
  { id: 'international-transfers', label: 'International Transfers' },
  { id: 'scc', label: 'Standard Contractual Clauses' },
  { id: 'liability-precedence', label: 'Liability & Precedence' },
  { id: 'governing-law', label: 'Governing Law' },
  { id: 'changes', label: 'Changes to DPA' },
  { id: 'contact-dpa', label: 'Contact' },
  { id: 'annex-i', label: 'Annex I: Details of Processing' },
  { id: 'annex-ii', label: 'Annex II: Security Measures' },
  { id: 'annex-iii', label: 'Annex III: Subprocessors' },
  { id: 'annex-iv', label: 'Annex IV: Transfers & SCCs' },
];

export default function DataProcessingAddendum() {
  const [activeSection, setActiveSection] = useState('purpose');

  return (
    <div className="flex min-h-screen">
      <nav className="hidden lg:block w-56 flex-shrink-0 border-r border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 sticky top-0 h-screen overflow-y-auto scrollbar-thin">
        <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">On This Page</h2>
        <ul className="space-y-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} onClick={() => setActiveSection(s.id)} className={`block text-xs py-1 px-2 rounded transition-colors ${activeSection === s.id ? 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 font-medium' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'}`}>{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="flex-1 max-w-3xl mx-auto px-6 py-10 lg:px-12">
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Data Processing Addendum</h1>
        {/* COUNSEL-REVIEW: the date is the drafting date of these factual corrections (K14), not a publication date. NEEDS-OWNER: set the effective date at publication and decide whether existing DPA customers must be notified under Section 17, because Annex II representations were reduced. */}
        <p className="text-sm text-surface-500">Last updated: September 30, 2026</p>

        <S id="purpose" title="1. Purpose and Scope" onScroll={setActiveSection}>
          <p>This Data Processing Addendum ("DPA") forms part of the Terms of Service between Developer312 and the Customer and supplements the Terms with respect to the processing of personal data.</p>
          {/* COUNSEL-REVIEW: F-A-06 - the adjective this sentence used before "controller-to-processor" read as a compliance status and is gone from the meta, the Contact page and the Security page. Same meaning, no status word. */}
          <p>This DPA applies where Developer312 processes personal data on behalf of the Customer in connection with the Eco-Auditor platform. It is intended to support controller-to-processor arrangements under the GDPR.</p>
          <p>In the event of a conflict between this DPA and the Terms of Service, this DPA shall prevail with respect to the processing of personal data.</p>
        </S>

        <S id="definitions" title="2. Definitions" onScroll={setActiveSection}>
          <p>Unless defined otherwise, terms used in this DPA have the meanings given in the General Data Protection Regulation (Regulation (EU) 2016/679) ("GDPR"). Key definitions:</p>
          <ul>
            <li><strong>"Customer"</strong> means the organization that has entered into a subscription agreement for the Eco-Auditor platform</li>
            <li><strong>"Processor"</strong> means Developer312, acting on behalf of the Customer in processing personal data</li>
            <li><strong>"Controller"</strong> means the Customer, which determines the purposes and means of processing personal data</li>
            <li><strong>"Personal Data"</strong> means any information relating to an identified or identifiable natural person</li>
            <li><strong>"Subprocessor"</strong> means any third party engaged by Developer312 to process personal data on behalf of the Customer</li>
            <li><strong>"Data Subject"</strong> means an identified or identifiable natural person whose personal data is processed</li>
          </ul>
        </S>

        <S id="roles" title="3. Roles of the Parties" onScroll={setActiveSection}>
          <p>The Customer acts as the Controller of personal data. Developer312 acts as the Processor, processing personal data on the Customer's behalf and only in accordance with the Customer's documented instructions.</p>
          <p>Where Developer312 decides on the purposes and means of processing its own employee or business data separate from the Customer's data, Developer312 acts as Controller for that processing.</p>
        </S>

        <S id="subject-matter" title="4. Subject Matter and Duration of Processing" onScroll={setActiveSection}>
          <p>The subject matter of processing is the hosting, storing, organizing, analyzing, and displaying of customer-submitted business data within the Eco-Auditor platform.</p>
          {/* COUNSEL-REVIEW: F-A-20 - the previous text relied on a post-termination period "as specified in the Terms of Service" that the Terms never defined, and cited Section 12 (Audit Rights) for deletion. This states what actually happens and cites Section 11. NEEDS-OWNER: decide whether to commit to automatic deletion after termination (needs a job or runbook) and its length. */}
          <p>This DPA applies for the duration of the Customer's subscription and for as long afterwards as Developer312 continues to hold the Customer's personal data. Developer312 does not delete workspace data automatically when a subscription ends; personal data is deleted as described in Section 11.</p>
        </S>

        <S id="processing-instructions" title="5. Processing on Documented Instructions" onScroll={setActiveSection}>
          <p>Developer312 shall process personal data only on documented instructions from the Customer, including:</p>
          <ul>
            <li>Instructions provided through the Eco-Auditor platform interface</li>
            <li>Instructions provided in writing (including email) by authorized Customer representatives</li>
            <li>Processing necessary to comply with applicable legal obligations</li>
          </ul>
          <p>Developer312 shall not process personal data for its own purposes or for purposes not authorized by the Customer, unless required by applicable law, in which case Developer312 shall inform the Customer unless legally prohibited from doing so.</p>
        </S>

        <S id="confidentiality" title="6. Confidentiality" onScroll={setActiveSection}>
          <p>Developer312 ensures that all persons authorized to process personal data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.</p>
          {/* COUNSEL-REVIEW: F-A-06 - "receive data protection training" removed (no evidence). The confidentiality-agreement statement below has no evidence in the repo either (the final web verification could not verify it) and was left as drafted. NEEDS-OWNER: confirm that employees and contractors are bound by confidentiality agreements or remove the sentence; counsel decides whether a sentence without evidence may stay. */}
          <p>Developer312's employees and contractors are bound by confidentiality agreements.</p>
        </S>

        <S id="security" title="7. Security of Processing" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: F-A-06 / F-R4-01 - this list keeps only measures with evidence in the repo, its launch record or the provider's published statements. Removed: multi-factor authentication (no customer MFA; admin MFA unevidenced), intrusion detection, disaster recovery (restore never exercised, LAUNCH_AUDIT gate 11), staging environment (every recorded deployment targets one production environment), incident response, security training. VF-14 / VF-15 (post-web): the final verification found the list does not keep to that rule in three places. (1) The TLS 1.2+ line: the minimum version is a Cloudflare zone setting that no file in the repo shows (src/content/trust-facts.ts keeps the note). (2) The role-based access and least-privilege line: the browser roles (anon, authenticated) keep table write grants until docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql is applied, so least privilege is the aim, not yet the state. (3) The employee confidentiality line has no evidence in the repo (see the Section 6 marker). The three Subprocessor Management lines are marked in Annex II. NEEDS-OWNER: restore any removed item only with evidence; create a staging environment (D3) if the staging promise should return; confirm or remove the three lines above. */}
          <p>Developer312 implements appropriate technical and organizational measures to ensure a level of security appropriate to the risk, as detailed in Annex II. These measures include:</p>
          <ul>
            <li>Role-based access controls and least-privilege access</li>
            <li>Encryption of personal data in transit (TLS 1.2+); encryption at rest is provided by our database provider (InsForge)</li>
            <li>Authentication through our identity provider (InsForge), with email verification, password requirements, and OAuth sign-in</li>
            <li>Application request and error logging</li>
            <li>Database backups taken through our database provider</li>
            <li>Separation of production from development and test environments</li>
            <li>Vulnerability management and security patching</li>
            <li>Employee confidentiality obligations</li>
            <li>Deletion of customer data on request, as described in Section 11</li>
          </ul>
        </S>

        <S id="subprocessors" title="8. Use of Subprocessors" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: VF-15 (post-web) - the statement in the first paragraph below that subprocessors are bound by written agreements imposing obligations no less protective than this DPA has no evidence in the repo: no agreement, order form or terms acceptance with any listed provider is stored or referenced (only the list of providers is evidenced, see Annex III). It was left as drafted because removing or softening it is counsel's call; the same claim is repeated in Annex II. NEEDS-OWNER: confirm that each subprocessor's agreement says this, or remove the sentence. */}
          <p>The Customer authorizes Developer312 to engage subprocessors to process personal data on the Customer's behalf. Developer312 ensures that subprocessors are bound by written agreements that impose data protection obligations no less protective than those in this DPA.</p>
          <p>A current list of subprocessors is maintained in Annex III. Developer312 will notify the Customer of any addition or replacement of subprocessors, providing the Customer with a reasonable opportunity to object to such changes.</p>
          <p>If the Customer objects to a subprocessor change and the parties cannot reach a resolution, the Customer may terminate the affected portion of the service or, if the change affects the entire service, terminate the subscription.</p>
        </S>

        <S id="data-subject-rights" title="9. Assistance with Data Subject Rights" onScroll={setActiveSection}>
          <p>Developer312 shall assist the Customer in fulfilling its obligations to respond to data subject requests for exercising their rights under applicable data protection laws, including rights of access, rectification, erasure, portability, restriction, and objection.</p>
          <p>Developer312 will promptly notify the Customer if it receives a data subject request directly and will not respond to such requests without the Customer's instructions, except as required by applicable law.</p>
        </S>

        <S id="breach-notification" title="10. Personal Data Breach Notification" onScroll={setActiveSection}>
          <p>Developer312 shall notify the Customer without undue delay after becoming aware of a personal data breach, providing:</p>
          <ul>
            <li>The nature of the breach, including the categories and approximate number of data subjects and records affected</li>
            <li>The likely consequences of the breach</li>
            <li>The measures taken or proposed to address the breach and mitigate its effects</li>
            <li>A designated point of contact for further information</li>
          </ul>
          <p>Developer312 will cooperate with the Customer in investigating breaches and will provide all reasonably available information to assist the Customer in meeting its notification obligations under applicable law.</p>
        </S>

        <S id="return-deletion" title="11. Return and Deletion of Personal Data" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: F-A-20 / F-D-06 - lists what the export contains today, says plainly that nothing is deleted automatically and what "delete audit data" leaves behind, and adds the backup caveat (a provider backup exists, LAUNCH_AUDIT.md). Deletion behaviour is unchanged. NEEDS-OWNER: the 30-day request window rests on a manual process with no runbook (F-A-20 fix 2); widen the export list if the export is widened (F-A-03). */}
          {/* COUNSEL-REVIEW: VF-2 / VF-4 (post-web) - the export list that was here (company profile, facilities and eight entry fields) had drifted from the export: the file holds the company name and industry, facilities, every entry column including factor, CO2e, activity date and notes (the newest 10,000 entries at most, with a note in the file when it caps), the details of each report (not the PDF or its snapshot) and the import log, and it leaves out the edit records, so the Return item now renders that description from src/content/data-facts.ts, with the cap and the omissions. The Deletion item adds that generated reports are not part of the deletion and that a stored report keeps a copy of the entries it covers (the delete-data handler touches no reports column; see the Privacy Policy markers in Section 9 for the evidence and the owner decision). tests/export-claim-coupling.test.ts and tests/legal-evidence-coupling.test.tsx fail when the code and these sentences part. NEEDS-OWNER: the edit records hold the editor's account ID; decide whether the export should carry them (Art. 28(3)(g) return of personal data) so that the omission sentence can go. */}
          {/* COUNSEL-REVIEW: K3 follow-up (VERIFY-W2A-DATA F5) - the "No automatic deletion" item now carves out the one automatic deletion, the trigger reports_prune_drafts (migrations/20260930110000_report-snapshots.sql): storing a new frozen draft report deletes the same company's older unsigned drafts beyond the newest 25 (MAX_DRAFT_REPORTS in src/lib/reports/report-limits.cjs); signed-off reports are never deleted by it and a pruned draft cannot be recovered. Same sentence as Privacy Section 9, Security (Data export and deletion) and Terms Section 9. OWNER DECISION: is a 25-draft bound acceptable? */}
          <p>Personal data is returned and deleted as follows:</p>
          <ul>
            <li><strong>Return:</strong> The Customer can export its workspace data at any time from the Service's Settings as a machine-readable JSON download of its {dataFacts.export.contents}. {dataFacts.export.limitNote}. {dataFacts.export.leavesOutNote}</li>
            <li><strong>Deletion:</strong> The Customer can delete its audit data (emissions entries and facilities) at any time from the Service's Settings; deletion takes effect immediately. {dataFacts.deleteAuditData.reports}. The account record is deleted by submitting a deletion request to support, which Developer312 will process within 30 days of the request</li>
            <li><strong>No automatic deletion:</strong> Developer312 does not delete workspace data automatically, including when a subscription ends, with one exception: it keeps only the 25 most recent unsigned draft reports per workspace and deletes older drafts when a new report is generated; signed-off reports are not deleted this way. Until the Customer deletes its audit data or requests deletion of the account record, the account record, company profile, import history, and billing linkage remain</li>
            <li><strong>Backups:</strong> Deleted data may remain in database backups taken through Developer312's database provider until those backups expire or are deleted</li>
          </ul>
          <p>This obligation does not apply where retention of personal data is required by applicable law, in which case Developer312 will continue to process such data only for the purpose and duration required by law.</p>
          <p>This Section covers the Customer's workspace data. Records that Developer312 keeps as a controller, such as cookie-consent records (kept as proof of consent) and demo or contact requests, are described in the Privacy Policy.</p>
        </S>

        <S id="audit-rights" title="12. Information and Audit Rights" onScroll={setActiveSection}>
          <p>Developer312 shall make available to the Customer all information necessary to demonstrate compliance with this DPA and shall allow for and contribute to audits, including inspections, conducted by the Customer or an auditor mandated by the Customer.</p>
          <p>Such audits shall be conducted during normal business hours with reasonable advance notice, and the Customer shall bear the cost of such audits unless they reveal a material breach of this DPA by Developer312.</p>
        </S>

        <S id="international-transfers" title="13. International Data Transfers" onScroll={setActiveSection}>
          <p>Developer312 may process or access personal data outside the EEA, UK, or Switzerland depending on hosting, support, or infrastructure operations.</p>
          <p>Where required, international transfers shall be governed by the Standard Contractual Clauses described in Section 14 and Annex IV.</p>
          <p>Developer312 will ensure that any transfer of personal data to a third country is subject to appropriate safeguards as required by applicable data protection law.</p>
        </S>

        <S id="scc" title="14. Standard Contractual Clauses" onScroll={setActiveSection}>
          <p>Where personal data is transferred from the EEA, the parties agree to incorporate the Standard Contractual Clauses ("SCCs") as adopted by the European Commission, consisting of:</p>
          <ul>
            <li><strong>Module Two</strong> (Controller to Processor): Where the Customer acts as Controller and Developer312 acts as Processor</li>
            <li><strong>Module Three</strong> (Processor to Processor): Where both parties act as Processors in a chain of processing</li>
          </ul>
          <p>The specific module(s) applicable will depend on the processing context. Annex IV provides the relevant SCC details and transfer information.</p>
          <p>For transfers to the UK, the UK Addendum to the EU SCCs as approved by the UK Information Commissioner's Office shall apply as a supplementary measure.</p>
        </S>

        <S id="liability-precedence" title="15. Liability and Order of Precedence" onScroll={setActiveSection}>
          <p>Liability under this DPA shall be subject to the limitations and exclusions set out in the Terms of Service.</p>
          <p>The order of precedence for conflicting terms shall be: (1) this DPA, (2) the Terms of Service, and (3) any other agreement between the parties with respect to the processing of personal data.</p>
        </S>

        <S id="governing-law" title="16. Governing Law" onScroll={setActiveSection}>
          <p>This DPA shall be governed by and construed in accordance with the laws specified in the Terms of Service.</p>
          <p>Nothing in this DPA shall prejudice the data subject's rights under applicable data protection law.</p>
        </S>

        <S id="changes" title="17. Changes to this DPA" onScroll={setActiveSection}>
          <p>Developer312 may update this DPA to reflect changes in applicable law, regulatory requirements, or data processing practices. Where the update represents a material change, Developer312 will provide the Customer with notice and an opportunity to review the updated terms.</p>
          <p>Updated subprocessor information will be provided in accordance with Section 8.</p>
        </S>

        <S id="contact-dpa" title="18. Contact Information" onScroll={setActiveSection}>
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4 my-3">
            <p className="font-medium text-surface-800 dark:text-surface-200">Developer312 — Data Protection</p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">Email: <a href={`mailto:${contactDetails.email}`} className="text-accent-text hover:underline">{contactDetails.email}</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href={contactDetails.phoneHref} className="text-accent-text hover:underline">{contactDetails.phone}</a></p>
          </div>
        </S>

        <div className="border-t border-surface-200 dark:border-surface-700 my-10" />

        <h2 className="text-xl font-bold text-surface-900 dark:text-white mb-6">Annexes</h2>

        <S id="annex-i" title="Annex I: Details of Processing" onScroll={setActiveSection}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mb-4">
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {[
                  ['Subject matter', 'Hosting, storing, organizing, analyzing, and displaying customer-submitted business data in the Eco-Auditor platform'],
                  // COUNSEL-REVIEW: F-A-20 - the Terms define no post-termination period; see Section 4.
                  ['Duration', 'For the subscription term and for as long afterwards as Developer312 holds personal data of the Customer; deletion is on request, as described in Section 11'],
                  // COUNSEL-REVIEW: VF-9 (post-web) - "audit trails" is removed from the purposes: the product has no audit trail (claims.ts, audit-ready; an audit trail is on the roadmap), and a processing purpose the product does not perform should not be listed in Annex I. The other purposes are unchanged. NEEDS-OWNER: confirm the list of purposes.
                  ['Purpose', 'Providing workflow automation, reporting preparation, user account administration, support, security, and related SaaS functionality'],
                  ['Categories of data subjects', 'Customer personnel, customer users, vendor/supplier contacts, uploaded-record contacts, and other business contacts contained in customer data'],
                  ['Categories of personal data', 'Name, business email, work phone, job title, account identifiers, support correspondence, uploaded business records that may contain personal data, billing contacts, usage/log data, and similar business-related personal data'],
                ].map(([label, value]) => (
                  <tr key={String(label)}>
                    <td className="py-2 pr-4 font-medium text-surface-800 dark:text-surface-200 w-48 align-top">{label}</td>
                    <td className="py-2 text-surface-600 dark:text-surface-400">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        <S id="annex-ii" title="Annex II: Technical and Organizational Security Measures" onScroll={setActiveSection}>
          <p>Developer312 implements the following technical and organizational measures to protect personal data:</p>
          <div className="space-y-3 mt-3">
            {[
              // COUNSEL-REVIEW: F-A-06 / F-R4-01 - Annex II lists measures with evidence (R5 section 5b), except four items that the final web verification found have none in the repo and that stay marked rather than removed (VF-14, VF-15): the TLS 1.2+ line (the Cloudflare minimum is a zone setting no file shows; src/content/trust-facts.ts keeps the note), the least-privilege wording of the access line (the browser roles keep write grants until the deferred REVOKE), the employee confidentiality line, and the first two lines of Subprocessor Management (marked beside them). Removed: multi-factor authentication for administrative access, access reviews, AES-256 as a first-party claim, encrypted backups and key management, staging environment, network segmentation and firewall controls, penetration testing, incident response escalation, security training, disaster recovery with tested restore, redundant infrastructure (the app runs as a single instance). Reworded to what exists: provider-managed backups, provider-attributed encryption at rest, separation of production from development and test. NEEDS-OWNER: (1) restore a removed item only with evidence; (2) check Cloudflare, SSL/TLS, Edge Certificates, Minimum TLS Version, and confirm it reads 1.2 or higher before the TLS 1.2+ line is published; (3) create a staging environment (D3) if the staging promise should return; (4) confirm or remove each of the four items named at the start of this marker.
              { category: 'Access Control', measures: ['Role-based access controls with least-privilege principles', 'Unique user identification and authentication through our identity provider (InsForge), with email verification'] },
              { category: 'Data Encryption', measures: ['TLS 1.2+ for all data in transit', 'Encryption of data at rest by our database provider (InsForge)'] },
              { category: 'Infrastructure Security', measures: ['Separation of production from development and test environments', 'Network protection provided by our infrastructure providers (Cloudflare and Railway)', 'Vulnerability management and security patching', 'Periodic internal security reviews and automated dependency vulnerability scanning'] },
              { category: 'Operational Security', measures: ['Application request and error logging', 'Employee confidentiality obligations', 'Deletion of customer data on request, as described in Section 11'] },
              { category: 'Business Continuity', measures: ['Database backups taken through our database provider (InsForge)', 'Backup restores are not currently tested on a schedule'] },
              // COUNSEL-REVIEW: VF-15 (post-web) - the first two lines of the Subprocessor Management group below, the written agreements with every subprocessor and the ongoing review of their security practices, have no evidence in the repo (no agreement, order form, review record or schedule exists here), although the Annex II marker above says the list keeps only measures with evidence. Both were left as drafted because removing them is counsel's call. NEEDS-OWNER: confirm each of the two or remove it. The third line, notification of subprocessor changes, is also promised in Section 8 and Annex III, and no runbook or notification procedure for it is in the repo either.
              { category: 'Subprocessor Management', measures: ['Written data processing agreements with all subprocessors', 'Ongoing review of subprocessor security practices', 'Notification procedures for subprocessor changes'] },
            ].map((group) => (
              <div key={group.category} className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                {/* F-C-21: h3 under the Annex's h2 (it was h4, which skipped a level). */}
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{group.category}</h3>
                <ul className="list-disc pl-5 space-y-1 mt-1">
                  {group.measures.map((m) => <li key={m} className="text-xs text-surface-600 dark:text-surface-400">{m}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-surface-500 mt-3">This is a summary of key measures. Detailed security documentation is available upon request under NDA. Developer312 does not overclaim certifications or controls not currently in place.</p>
        </S>

        <S id="annex-iii" title="Annex III: List of Subprocessors" onScroll={setActiveSection}>
          <p>The following subprocessors are authorized to process personal data on behalf of the Customer:</p>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                  <th className="pb-2 font-medium">Subprocessor</th>
                  <th className="pb-2 font-medium">Purpose</th>
                  <th className="pb-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {[
                  // COUNSEL-REVIEW: F-A-13 - every row is evidenced in the repo: Railway (railway.toml, Railway proxy handling in server.cjs), InsForge (@insforge/sdk, CSP connect-src, auth config in insforge.toml, migrations applied through the InsForge CLI), Cloudflare (proxy handling in server.cjs), Stripe (stripe dependency, checkout and webhook routes), Google (Tag Manager loader in src/lib/gtm.ts after analytics consent). The generic rows (analytics, email/communications, support platform) had no evidence and were removed.
                  // COUNSEL-REVIEW: F-F-06 - the Google Fonts clause was deleted from the Google row (it read "and Google Fonts (web fonts loaded with each page)"): the site's fonts are now served from our own domain (public/fonts) and the Content-Security-Policy allows no Google font host. tests/legal-evidence-coupling.test.tsx keeps this two-way: Google Fonts may be named here only while the code loads fonts from Google. Same change in Privacy Section 8.
                  // Only the Stripe region is asserted; the others keep the "pending verification" wording (tests/audit-20260917-regressions.test.ts, FE-04) because no region is evidenced.
                  // NEEDS-OWNER: (1) confirm each provider's region and replace the pending wording; (2) confirm whether the support mailbox or any ticketing tool processes customer data and list it; (3) InsForge and Railway rely on their own subprocessors (published by each provider), which are not listed here; (4) confirm who sends the sign-up and password-reset emails (InsForge default sender, custom SMTP is disabled in insforge.toml).
                  { name: 'Railway Corporation', purpose: 'Application hosting (web application and API server)', location: 'Region pending verification — available upon request' },
                  { name: 'InsForge, Inc.', purpose: 'Authentication (including sign-up and password-reset emails) and PostgreSQL database for account and workspace data', location: 'Region pending verification — available upon request' },
                  { name: 'Cloudflare, Inc.', purpose: 'DNS, content delivery, and TLS for ecoauditor.io (site traffic passes through Cloudflare)', location: 'Region pending verification — available upon request' },
                  { name: 'Stripe, Inc.', purpose: 'Payment processing and billing', location: 'United States' },
                  { name: 'Google LLC', purpose: 'Google Tag Manager and analytics (loaded only if the user accepts analytics cookies)', location: 'Region pending verification — available upon request' },
                ].map((sp) => (
                  <tr key={sp.name}>
                    <td className="py-2.5 font-medium text-surface-800 dark:text-surface-200">{sp.name}</td>
                    <td className="py-2.5 text-surface-600 dark:text-surface-400">{sp.purpose}</td>
                    <td className="py-2.5 text-surface-600 dark:text-surface-400">{sp.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* COUNSEL-REVIEW: F-A-13 - sign-in providers are chosen by the user (AuthShell renders Google, Apple and work-account buttons; socialAuth.ts documents the Microsoft Entra External ID tenant). Shown as a note, not a table row, because tests/audit-20260917-regressions.test.ts (FE-04) pins five rows. NEEDS-OWNER: decide whether Microsoft Corporation belongs in the table (FE-04 then needs updating) and confirm its region. */}
          <p className="text-xs text-surface-500 mt-3">Sign-in providers: if a user chooses to sign in with Google, Apple, or a work account, that provider authenticates the user and, through InsForge, shares the account details the user authorizes (typically name and email address). The work-account option is served by a Microsoft Entra External ID tenant hosted by Microsoft Corporation.</p>
          {/* COUNSEL-REVIEW: D-3 (F-A-07 notifier) - server-notify.cjs, wired in server.cjs (announceLead, called by writeLead after a lead is stored), posts a Slack-compatible message with the lead's type, source, name, email, company, preferred date and time and message to the URL in LEAD_NOTIFY_WEBHOOK_URL; it reads nothing from a customer workspace. Shown as a note, not a table row, for the same reason as the sign-in providers note (FE-04 pins five rows), and the provider is not named because nothing in the repo evidences which one the operator will use. "May receive": nothing is posted while that variable is unset. Counsel: these are requests made to Developer312 (Developer312 as controller), so whether the DPA is the right place is your call; Privacy Section 8 says its provider list is the one in Annex III, which is why the note sits here. NEEDS-OWNER: set LEAD_NOTIFY_WEBHOOK_URL only after this text is live, then name the provider and its region here and in Privacy Section 8. tests/legal-evidence-coupling.test.tsx requires this note while the notifier exists. */}
          <p className="text-xs text-surface-500 mt-3">Lead notifications: when someone submits a demo, contact, or chat request, the team messaging workspace that Developer312 uses to handle those requests may receive a notification containing the details submitted (name, email address, company, message, and any preferred date and time). This carries requests made to Developer312 through those forms; it does not carry data from a Customer&apos;s workspace.</p>
          <p className="text-xs text-surface-500 mt-3">Developer312 will notify the Customer of changes to this subprocessor list in accordance with Section 8 of this DPA. A current list is available upon request.</p>
        </S>

        <S id="annex-iv" title="Annex IV: International Data Transfers and SCC Information" onScroll={setActiveSection}>
          <p>Where personal data is transferred outside the EEA/UK/Switzerland, the following applies:</p>
          <div className="space-y-4 mt-3">
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">SCC Module Applicability</h3>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">Module Two (Controller to Processor) applies where the Customer acts as Controller. Module Three (Processor to Processor) applies where Developer312 engages subprocessors.</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Transfer Mechanism</h3>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">The European Commission's Standard Contractual Clauses (Decision 2021/914) serve as the primary transfer mechanism. For UK transfers, the UK Addendum to the EU SCCs applies.</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Supplementary Measures</h3>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">Encryption in transit and at rest, access controls, and the security measures described in Annex II serve as supplementary technical measures to support the adequacy of the transfer.</p>
            </div>
          </div>
          <p className="text-xs text-surface-500 mt-3">Specific SCC annex details, including data exporter/importer information, competent supervisory authority, and governing law selections, shall be completed upon execution. This DPA does not constitute a signed SCC agreement until countersigned by both parties.</p>
        </S>
      </article>
    </div>
  );
}

function S({ id, title, onScroll, children }: { id: string; title: string; onScroll: (id: string) => void; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-6" onMouseEnter={() => onScroll(id)}>
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">{title}</h2>
      <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-accent-text [&_a]:hover:underline [&_p]:text-surface-600 [&_p]:dark:text-surface-400 [&_strong]:text-surface-800 [&_strong]:dark:text-surface-200">
        {children}
      </div>
    </section>
  );
}