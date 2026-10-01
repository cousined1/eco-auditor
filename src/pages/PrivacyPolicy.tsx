import { useState } from 'react';
import { contactDetails } from '@/content/trust-facts';
import { dataFacts } from '@/content/data-facts';

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'who-we-are', label: 'Who We Are' },
  { id: 'info-collected', label: 'Information We Collect' },
  { id: 'info-provided', label: 'Information You Provide' },
  { id: 'info-automatic', label: 'Information Collected Automatically' },
  { id: 'info-third-parties', label: 'Information from Integrations' },
  { id: 'how-we-use', label: 'How We Use Information' },
  { id: 'how-we-share', label: 'How We Share Information' },
  { id: 'data-retention', label: 'Data Retention' },
  { id: 'data-security', label: 'Data Security' },
  { id: 'international', label: 'International Data Handling' },
  { id: 'privacy-rights', label: 'Your Privacy Rights' },
  { id: 'california-rights', label: 'California Privacy Rights' },
  { id: 'privacy-request', label: 'How to Submit a Privacy Request' },
  { id: 'cookies', label: 'Cookies & Tracking' },
  { id: 'children', label: 'Children\'s Privacy' },
  { id: 'changes', label: 'Changes to This Policy' },
  { id: 'contact', label: 'Contact Information' },
];

export default function PrivacyPolicy() {
  const [activeSection, setActiveSection] = useState('introduction');

  return (
    <div className="flex min-h-screen">
      <nav className="hidden lg:block w-56 flex-shrink-0 border-r border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 sticky top-0 h-screen overflow-y-auto scrollbar-thin">
        <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">On This Page</h2>
        <ul className="space-y-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={() => setActiveSection(s.id)}
                className={`block text-xs py-1 px-2 rounded transition-colors ${
                  activeSection === s.id
                    ? 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 font-medium'
                    : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="flex-1 max-w-3xl mx-auto px-6 py-10 lg:px-12">
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Privacy Policy</h1>
        {/* COUNSEL-REVIEW: the date is the drafting date of these factual corrections (K14), not a publication date. NEEDS-OWNER: set the effective date at publication. */}
        <p className="text-sm text-surface-500">Last updated: September 30, 2026</p>

        <LegalSection id="introduction" title="1. Introduction" onScroll={setActiveSection}>
          <p>Developer312 ("we," "us," or "our") operates the Eco-Auditor platform, a carbon accounting and emissions management service. This Privacy Policy describes how we collect, use, disclose, and protect information when you use our service.</p>
          <p>By accessing or using Eco-Auditor, you agree to the collection and use of information in accordance with this policy. If you do not agree with the terms of this policy, please do not access the service.</p>
          <p>This policy applies to all users of Eco-Auditor, including account holders, team members invited by account holders, and visitors to our website.</p>
        </LegalSection>

        <LegalSection id="who-we-are" title="2. Who We Are" onScroll={setActiveSection}>
          <p>Developer312 is a subsidiary of NIGHT LITE USA LLC. We provide the Eco-Auditor platform from the United States.</p>
          <p>Contact information:</p>
          <ul>
            <li>Email: <a href={`mailto:${contactDetails.email}`} className="text-accent-text hover:underline">{contactDetails.email}</a></li>
            <li>Phone: <a href={contactDetails.phoneHref} className="text-accent-text hover:underline">{contactDetails.phone}</a></li>
          </ul>
        </LegalSection>

        <LegalSection id="info-collected" title="3. Information We Collect" onScroll={setActiveSection}>
          <p>We collect information in several categories to provide and improve our service:</p>
        </LegalSection>

        <LegalSection id="info-provided" title="4. Information You Provide Directly" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: F-A-20 (D-13) - this inventory now lists what the product holds: sign-up fields (Signup.tsx), onboarding and facility fields, Stripe identifiers (public.users and the companies billing columns), imported activity rows (emission_entries) and the import history kept for each import (public.csv_import_events: the file name the browser reported, a hash of the file, rows, warnings and undo status; VF-5 of the final web verification found the file name and hash missing, see the Imported activity data item), demo/contact/chat requests (public.leads). Removed: document upload, configuration choices and "role", none of which exist. NEEDS-OWNER: confirm no other personal data is collected (for example in the support mailbox). */}
          {/* COUNSEL-REVIEW: K5 (F-E-08, F-B-17) - two additions, both stored by migrations/20260930121000_company-onboarding.sql and written by server code: (1) the reporting basis, companies.consolidation_approach and companies.base_year (set in onboarding and Settings, printed in reports by report-generator.cjs); (2) the edit record, public.entry_history (written by PATCH /api/entries/:id in server-entry-routes.cjs: changed_by is the editor's auth user id, changed_at, old_values, new_values). The record is deleted with its entry: entry_id is ON DELETE CASCADE, so the entry DELETE in delete-data, per-entry delete and CSV import undo take it too. tests/legal-evidence-coupling.test.tsx ties each word here to that migration. NEEDS-OWNER: GET /api/account/export does not include entry_history (it does include updated_at); say whether the record should be exportable. */}
          <p>When you create an account or use our service, you may provide:</p>
          <ul>
            <li><strong>Account details:</strong> Email address, password, and, optionally, your name</li>
            <li><strong>Company information:</strong> Organization name, industry, and facilities (name, type, and city), and your reporting basis (the consolidation approach and base year you choose), which also appears in the reports you generate</li>
            <li><strong>Billing information:</strong> Card and billing details are entered directly with Stripe and are not stored by us; we store your Stripe customer and subscription identifiers and your plan and subscription status</li>
            {/* COUNSEL-REVIEW: VF-5 (post-web) - this item said only that we keep a count of the rows in each import. Each import also keeps what migrations/20260930120000_csv-import-batches.sql adds to public.csv_import_events next to row_count and created_at: original_filename (the name the browser reported, display only; it can hold a person's name), file_sha256 (a SHA-256 hash of the file's normalised text, used to catch the same file imported twice), warning_count, status and undone_at. The sentence is rendered from src/content/data-facts.ts, and tests/legal-evidence-coupling.test.tsx fails if the migration adds a column the sentence does not name. The file itself is not stored (only the rows, as entries). NEEDS-OWNER: confirm the file name needs no separate lawful basis or retention limit: nothing deletes the import history, which stays until full account deletion (Section 9). */}
            <li><strong>Imported activity data:</strong> Activity rows from CSV files you import, with their scope, category, source, amount, unit, date, and any notes you add. We do not store the imported file itself. We do keep an import history: for each import, {dataFacts.importHistory.keeps}</li>
            <li><strong>Edit record:</strong> When you change an emissions entry, we keep a record of the change: the account ID of the person who made it, the time, and the previous and new values. The record is deleted together with the entry, including when you use “Delete my audit data”</li>
            <li><strong>Demo, contact, and chat requests:</strong> Name, email address, company, message, and any preferred date and time you submit through the demo, contact, or chat forms</li>
            <li><strong>Support communications:</strong> Messages, attachments, and correspondence submitted through our support channels</li>
          </ul>
          <p>We process this information to deliver the service you requested, maintain your account, and communicate with you about our platform.</p>
        </LegalSection>

        <LegalSection id="info-automatic" title="5. Information Collected Automatically" onScroll={setActiveSection}>
          <p>When you interact with our service, we may automatically collect:</p>
          <ul>
            <li><strong>Usage and log data:</strong> Pages visited, features used, click patterns, session duration, and interaction timestamps</li>
            <li><strong>Device and connection data:</strong> Browser type, operating system, IP address, screen resolution, and referring URL</li>
            <li><strong>Performance data:</strong> Load times, error reports, and system performance metrics</li>
            {/* COUNSEL-REVIEW: F-X1-02 (sweep-2b decided_at) - the record holds two times, both in public.consent_records (migrations/20260930140000_consent-decided-at.sql, written by POST /api/consent-audit in server.cjs): created_at is the server's receipt time and the only time the server vouches for; decided_at is the time of the choice as reported by the browser, kept only when it lies between 30 days ago and 5 minutes ahead (sanitizeConsentDecidedAt in server-security.cjs), otherwise NULL. A malicious browser can therefore backdate its own record by at most 30 days. tests/legal-evidence-coupling.test.tsx holds the sentence to the column. VF-7 (post-web): a record is also written without any choice. When the browser sends a Global Privacy Control or Do Not Track signal and no choice is stored (or the signal contradicts a stored Accept), src/lib/consent-context.tsx (resolveInitialConsent and the mount effect) declines the non-essential categories without showing the banner, stores that state and posts a record with method privacy_signal (accepted by the server, CONSENT_METHODS in server.cjs); for such a record decided_at is the time the browser applied the signal. The first clause below names that case, and the test fails if the code stops writing it. */}
            <li><strong>Consent records:</strong> When you make a choice in the cookie banner or cookie preferences, or when your browser sends a Global Privacy Control or Do Not Track signal and we apply it without asking you, we store a record of it on our servers: the categories you accepted or declined (or that we declined for you because of the signal), the version of this policy, how the choice was made (for example Accept All, Reject, or a browser signal applied automatically), whether a Global Privacy Control or Do Not Track signal was present, a random visitor ID stored in your browser, your browser's user-agent string, a keyed hash of your IP address (not the address itself), and two times: the time our servers received the record and, when your browser reports it, the time you made the choice (for a browser signal, the time it was applied)</li>
            {/* COUNSEL-REVIEW: F-X1-02 (K10 follow-up; VF-6 post-web) - names the browser-side outbox: src/lib/consent-audit.ts keeps a record that has not reached POST /api/consent-audit in localStorage under OUTBOX_KEY (eco_consent_outbox), retries it (up to 4 requests per delivery run, honouring Retry-After, and again on the next page load) and removes it once the server accepts it or refuses it with 400, 413, 415 or 422 (PERMANENT_REJECTIONS: dropped, never retried). At most MAX_QUEUED (25) records wait: queueing another drops the oldest, and a record that cannot be written to storage (blocked storage) is retried only while the page stays open. The sentence used to say the browser retries until our servers accept it, which left both drops out. tests/legal-evidence-coupling.test.tsx reads the key and the cap from that file. A queued record keeps the time of the choice (decided_at, see the comment above) and gets the server's receipt time on delivery. NEEDS-OWNER: confirm a record dropped for either reason (so no server-side proof of that choice exists) is acceptable given the proof-of-consent purpose in Section 9. */}
            <li><strong>Consent record queue:</strong> If a consent record cannot be delivered to our servers right away, your browser keeps it in its local storage (under the name eco_consent_outbox) and retries until our servers accept or refuse it; the copy in your browser is removed once the record is accepted or refused. At most 25 records wait there; if more arrive, the oldest is dropped. A record our servers refuse as invalid is dropped, not retried</li>
            {/* COUNSEL-REVIEW: F-G-08 / F-F-08 (obs-a) - names the automatic error report sent by src/lib/client-error-report.ts to POST /api/client-error: the error message, its stack (technical stack trace), the page path without query string or fragment; credentials: 'omit' (no cookies); the server (server-observability.cjs createClientErrorHandler) logs it with the build sha and reads no IP address, user agent or cookie. Counsel: an error message can in principle contain text a user typed; the server scrubs only e-mail addresses, query strings and JWT-shaped tokens. tests/legal-evidence-coupling.test.tsx holds each clause of the sentence to that code. */}
            <li><strong>Technical error reports:</strong> If a page fails, your browser sends us a technical error report (the error message, a technical stack trace and the page address without its parameters). It carries no cookies and is not used to identify you</li>
          </ul>
          <p>We collect this information to ensure platform stability, diagnose issues, and improve user experience. We do not sell this data.</p>
        </LegalSection>

        <LegalSection id="info-third-parties" title="6. Information from Integrations and Third Parties" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: F-A-20 (D-13) - the accounting, shipping and cloud-provider integrations described here do not exist in the product (Suppliers, Ledger and integrations are not built); the section now lists the only third-party inflows in the code: OAuth sign-in through InsForge (socialAuth.ts) and Stripe subscription events (/api/webhook). NEEDS-OWNER: restore integration wording only when an integration ships. */}
          <p>Eco-Auditor does not currently connect to accounting, shipping, or cloud-service accounts, so we do not receive data from them. The information we receive from third parties is limited to:</p>
          <ul>
            <li>Sign-in details from Google, Apple, or Microsoft (the “Continue with work account” option) if you choose to sign in that way: the account details you authorize that provider to share, typically your name and email address</li>
            <li>Subscription and payment status from Stripe, such as your plan, subscription status, and billing period</li>
          </ul>
        </LegalSection>

        <LegalSection id="how-we-use" title="7. How We Use Information" onScroll={setActiveSection}>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, operate, and maintain the Eco-Auditor platform</li>
            <li>Process imported activity data into emissions records, estimates, and reports</li>
            <li>Respond to demo, contact, and chat requests</li>
            <li>Communicate with you about your account, billing, support requests, and product updates</li>
            <li>Improve our service, develop new features, and conduct internal analytics</li>
            <li>Detect, prevent, and address technical issues, security threats, and fraud</li>
            <li>Comply with applicable legal obligations</li>
          </ul>
          <p>Where we process personal data of individuals in the European Economic Area or the United Kingdom, we rely on the following legal bases:</p>
          <ul>
            <li><strong>Contract performance:</strong> Processing necessary to deliver the service you subscribed to</li>
            <li><strong>Legitimate interests:</strong> Improving our service, preventing fraud, and ensuring security, where those interests are not overridden by your rights</li>
            <li><strong>Consent:</strong> Where you have provided explicit consent for specific processing activities, such as optional marketing communications</li>
            <li><strong>Legal obligation:</strong> Processing required to comply with applicable law</li>
          </ul>
        </LegalSection>

        <LegalSection id="how-we-share" title="8. How We Share Information" onScroll={setActiveSection}>
          <p>We do not sell your personal data. We may share information in the following circumstances:</p>

          {/* F-C-21: a section title is an h2, so the sub-headings inside a section are h3 (they were h4, which skipped a level). */}
          <h3>Service Providers and Subprocessors</h3>
          {/* COUNSEL-REVIEW: F-A-13 - names the providers evidenced in the repo (same five as DPA Annex III; see the comment there for the evidence) instead of generic categories, and adds the sign-in providers. The generic analytics, communications and support categories had no evidence and were removed. NEEDS-OWNER: confirm regions and any mailbox or ticketing tool that processes customer data; add them here and in Annex III. */}
          {/* COUNSEL-REVIEW: F-F-06 - the Google Fonts clause was deleted from the Google LLC entry (it read "and Google Fonts, which loads web fonts and receives your IP address and browser details when a page loads"). The site's fonts are now served from our own domain (public/fonts, @font-face in src/index.css) and the Content-Security-Policy allows no Google font host, so Google no longer receives that data for them. tests/legal-evidence-coupling.test.tsx keeps this two-way: Google Fonts may be named here only while the code loads fonts from Google. Same change in DPA Annex III. */}
          {/* COUNSEL-REVIEW: VF-15 (post-web) - the sentence below that says the providers are bound by contract to process data only as instructed and to keep appropriate security measures has no evidence in the repo: no data processing agreement, order form or terms acceptance is stored or referenced, and only the provider list itself is evidenced (see the two markers above). It was left as drafted because deleting or softening it is counsel's call. NEEDS-OWNER: confirm each provider's agreement says this, or remove the sentence. */}
          <p>We engage third-party service providers who process data on our behalf to deliver our service. These providers are contractually obligated to process data only as instructed and to maintain appropriate security measures. The providers we currently use are:</p>
          <ul>
            <li><strong>Railway Corporation:</strong> Application hosting</li>
            <li><strong>InsForge, Inc.:</strong> Authentication (including sign-up and password-reset emails) and the PostgreSQL database that holds account and workspace data</li>
            <li><strong>Cloudflare, Inc.:</strong> DNS, content delivery, and TLS for ecoauditor.io; site traffic passes through Cloudflare</li>
            <li><strong>Stripe, Inc.:</strong> Payment processing and subscription billing</li>
            <li><strong>Google LLC:</strong> Google Tag Manager and analytics, loaded only if you accept analytics cookies</li>
            {/* COUNSEL-REVIEW: D-3 (F-A-07 notifier) - server-notify.cjs, wired in server.cjs (announceLead, called by writeLead after a lead is stored), posts a Slack-compatible message with the lead's type, source, name, email, company, preferred date and time and message to the URL in LEAD_NOTIFY_WEBHOOK_URL. The provider is not named because nothing in the repo evidences which one the operator will use, and the wording is "may receive" because nothing is posted while that variable is unset. NEEDS-OWNER: (1) set LEAD_NOTIFY_WEBHOOK_URL only after this text is live; (2) name the provider and its region here and in DPA Annex III once chosen. Same wording in the DPA Annex III note; tests/legal-evidence-coupling.test.tsx requires it while the notifier exists. */}
            <li><strong>Team messaging workspace:</strong> The workspace our team uses to handle requests may receive a notification of each new demo, contact, or chat request, containing the details submitted (name, email address, company, message, and any preferred date and time)</li>
          </ul>
          <p>If you choose to sign in with Google, Apple, or a work account, that provider also receives your sign-in request; the work-account option is served by a Microsoft Entra External ID tenant hosted by Microsoft Corporation. The same list of providers appears in Annex III of our Data Processing Addendum. We will notify customers of material changes to our subprocessors.</p>

          <h3>Compliance and Legal Requirements</h3>
          <p>We may disclose information when required by law, regulation, legal process, or governmental request, or when we believe in good faith that disclosure is necessary to protect our rights, your safety, or the safety of others.</p>
        </LegalSection>

        <LegalSection id="data-retention" title="9. Data Retention" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: F-A-20 / F-D-06 - states that nothing is deleted automatically, what "Delete my audit data" leaves behind, and why consent records are kept (proof of consent, GDPR Art. 7(1)). Deletion behaviour is unchanged; purging consent records on delete would destroy that proof. The DELETE statements that run only when a customer asks are the two in delete-data (server.cjs), the company-scoped per-entry DELETE /api/entries/:id (server-entry-routes.cjs), the facility DELETE (server-company-routes.cjs) and the CSV import undo (server-csv-import-store.cjs). NEEDS-OWNER: no retention period is set for demo/contact requests or consent records; choose one and build the purge before stating it. */}
          {/* COUNSEL-REVIEW: VF-2 (post-web) - the "Audit data" item now says generated reports are not part of the deletion and that a stored report keeps a copy of the entries it covers; it used to list "generated-report records" among the unaffected items without saying they hold the entries. Evidence: the delete-data handler (server.cjs) deletes only from emission_entries and facilities and names no reports column; migrations/20260930110000_report-snapshots.sql stores a snapshot (JSONB) and the PDF (BYTEA) of every report, and report-snapshot.cjs keeps up to 5,000 entry lines in the snapshot (MAX_SNAPSHOT_ENTRY_LINES). Reports made before that migration (legacy rows) hold no copy, so the sentence describes reports as they are generated now. The sentence is rendered from src/content/data-facts.ts (also in Settings, Security, the DPA and the Terms), and tests/legal-evidence-coupling.test.tsx fails if the handler starts touching reports while the pages still say it does not. OWNER DECISION: should "Delete my audit data" also delete draft report snapshots and PDFs? The freeze trigger blocks UPDATE of a signed-off report, not DELETE, so the code could. Until the owner decides, the pages disclose the copy instead. */}
          {/* COUNSEL-REVIEW: K3 follow-up (VERIFY-W2A-DATA F5, F-A-20 / F-D-06) - "Nothing is deleted automatically" stopped being strictly true when migrations/20260930110000_report-snapshots.sql added the AFTER INSERT trigger reports_prune_drafts: storing a new frozen draft deletes the same company's older unsigned drafts beyond the newest 25 (MAX_DRAFT_REPORTS in src/lib/reports/report-limits.cjs); signed-off (final) reports and legacy rows without a stored PDF are never deleted by it, and a pruned draft cannot be recovered. The same exception is worded identically in Security (Data export and deletion), the Terms (section 9) and the DPA (section 11); tests/legal-evidence-coupling.test.tsx fails if a migration deletes automatically and any of them omits it, or if they carry it while the trigger is gone. OWNER DECISION: is a 25-draft bound acceptable, given pruned drafts are unrecoverable? */}
          <p>We retain your information for as long as your account is active or as needed to provide our services. Nothing is deleted automatically, with one exception: we keep only the 25 most recent unsigned draft reports per workspace and delete older drafts when a new report is generated; signed-off reports are not deleted this way. Apart from that, we do not currently delete accounts, workspace data, demo or contact requests, or consent records on a schedule, including when a subscription ends. Data retention and deletion work as follows:</p>
          <ul>
            {/* COUNSEL-REVIEW: VF-4 (post-web) - this item listed the company profile, facilities and eight entry fields. The export (GET /api/account/export in server.cjs) holds more and less than that: company name, industry, reporting basis and base year, facilities, every entry column including factor, CO2e, activity date and notes (up to the newest 10,000 entries, with a note in the file when it caps), the details of each report (not the PDF or its snapshot) and the CSV import log, but not the edit records (entry_history). The sentences are rendered from src/content/data-facts.ts, and tests/export-claim-coupling.test.ts fails when a query changes without it. NEEDS-OWNER: decide whether to widen the export to the edit records (which hold the editor's account ID) so that the last sentence can go; until then it is the honest state. */}
            <li><strong>Export:</strong> You can export your workspace data at any time from Settings as a machine-readable JSON download of your {dataFacts.export.contents}. {dataFacts.export.limitNote}. {dataFacts.export.leavesOutNote}</li>
            <li><strong>Audit data:</strong> You can delete your emissions entries and facilities at any time from Settings (“Delete my audit data”); deletion takes effect immediately. This control removes only those two items (together with the edit records of the entries it removes): your {dataFacts.deleteAuditData.leaves} are not affected. {dataFacts.deleteAuditData.reports}. Reports remain subject to the draft limit described at the start of this section</li>
            <li><strong>Account record:</strong> Your account record is retained until you request full account deletion via support, including after a subscription ends</li>
            <li><strong>Account deletion:</strong> Full account deletion requests submitted via support are processed within 30 days, subject to retention required by applicable law</li>
            <li><strong>Demo, contact, and chat requests:</strong> We keep the details you submit so we can respond. They are not linked to an account and are not deleted automatically; you can ask us to delete yours (see Section 14)</li>
            <li><strong>Consent records:</strong> We keep records of your cookie choices as proof of consent, which data protection law requires us to be able to demonstrate. They are keyed to a random ID stored in your browser rather than to your name or email address, they are not linked to your account, and they are not removed when you use “Delete my audit data.” We keep them for as long as needed to evidence your choices</li>
            <li><strong>Backups:</strong> Deleted data may remain in database backups taken through our database provider until those backups expire or are deleted</li>
            <li>We may retain anonymized, aggregated usage data indefinitely for service improvement</li>
            <li>Some data may be retained longer where required by law or for legitimate business purposes such as fraud prevention</li>
          </ul>
        </LegalSection>

        <LegalSection id="data-security" title="10. Data Security" onScroll={setActiveSection}>
          <p>We implement appropriate technical and organizational measures to protect your information, including:</p>
          <ul>
            {/* COUNSEL-REVIEW: F-A-06 - same evidence standard as DPA Annex II: encryption at rest attributed to the database provider, security reviews described as internal plus automated dependency scanning (no penetration test exists), incident response removed (alerting and on-call ownership are not evidenced, LAUNCH_AUDIT OPS-001). VF-14 / VF-15 (post-web): three lines below are not fully evidenced. (1) The TLS 1.2+ line: the minimum version is a Cloudflare zone setting that no file in the repo shows; src/content/trust-facts.ts keeps the note, and the owner must check Cloudflare, SSL/TLS, Edge Certificates, Minimum TLS Version. (2) The least-privilege line: the browser roles (anon, authenticated) keep table write grants until docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql is applied, so least privilege is the aim, not yet the state. (3) The employee confidentiality line has no evidence in the repo. NEEDS-OWNER: confirm each of these or remove it: the TLS line once the Cloudflare setting is checked, the least-privilege line once the REVOKE is applied. */}
            <li>Encryption of data in transit using TLS 1.2+</li>
            <li>Encryption of data at rest by our database provider (InsForge)</li>
            <li>Role-based access controls and least-privilege principles</li>
            <li>Periodic internal security reviews and automated dependency vulnerability scanning</li>
            <li>Employee confidentiality obligations</li>
          </ul>
          <p>While we strive to protect your information, no method of transmission over the internet or electronic storage is completely secure. We cannot guarantee absolute security.</p>
        </LegalSection>

        <LegalSection id="international" title="11. International Data Handling" onScroll={setActiveSection}>
          <p>Eco-Auditor is operated from the United States. If you are accessing our service from the European Economic Area, the United Kingdom, or other regions with data protection laws, please be aware that your information may be transferred to and processed in the United States.</p>
          <p>Where required, we implement appropriate safeguards for international transfers, including Standard Contractual Clauses where applicable. EU-facing customers can request a Data Processing Addendum from our legal page.</p>
        </LegalSection>

        <LegalSection id="privacy-rights" title="12. Your Privacy Choices and Rights" onScroll={setActiveSection}>
          <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
            <li><strong>Correction:</strong> Request correction of inaccurate or incomplete personal data</li>
            {/* COUNSEL-REVIEW: VF-2 / VF-4 (post-web) - two short sentences in this list now follow the corrected Section 9: the Deletion item points to the reports disclosure there (generated reports are not part of "Delete my audit data"), and the Portability item renders the same description of the export as Section 9 instead of its own shorter list. Evidence and asks: see the markers in Section 9. */}
            <li><strong>Deletion:</strong> Delete your audit data (emissions entries and facilities) yourself from Settings at any time (generated reports are not part of that deletion, see Section 9); request full account deletion via support, and we will process it within 30 days, subject to lawful retention requirements</li>
            <li><strong>Portability:</strong> Export your data yourself as a machine-readable JSON download from Settings at any time; it holds your {dataFacts.export.contents}</li>
            <li><strong>Restriction:</strong> Request restriction of processing in certain circumstances</li>
            <li><strong>Objection:</strong> Object to processing based on legitimate interests or for direct marketing</li>
            <li><strong>Withdrawal of consent:</strong> Withdraw consent you have previously provided, without affecting the lawfulness of processing based on consent before its withdrawal</li>
          </ul>
          <p>To exercise any of these rights, please contact us using the information in the Contact section below. We will respond within the timeframe required by applicable law.</p>
        </LegalSection>

        <LegalSection id="california-rights" title="13. California Privacy Rights" onScroll={setActiveSection}>
          <p>If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA) as amended by the CPRA:</p>
          <ul>
            <li><strong>Right to know:</strong> You can request information about the categories of personal information we have collected, the purposes, and the categories of third parties with whom we share it</li>
            <li><strong>Right to delete:</strong> You can request deletion of personal information we have collected, subject to certain exceptions</li>
            <li><strong>Right to correct:</strong> You can request correction of inaccurate personal information</li>
            <li><strong>Right to opt out of sale or sharing:</strong> We do not sell personal information. Marketing cookies that may involve sharing for cross-context behavioral advertising are used only with your consent, and you can opt out at any time through the cookie preferences settings; we also honor Global Privacy Control signals</li>
            <li><strong>Right to limit use of sensitive personal information:</strong> We do not collect or use sensitive personal information beyond what is necessary to provide our service</li>
          </ul>
          <p>We are not a data broker and do not sell personal information. Our service is directed at businesses, and the personal information we process is primarily business-related rather than consumer-oriented.</p>
          <p>Authorized agents may submit requests on your behalf, subject to verification.</p>
        </LegalSection>

        <LegalSection id="privacy-request" title="14. How to Submit a Privacy Request" onScroll={setActiveSection}>
          <p>To submit a privacy request, exercise your rights, or ask questions about this policy, you may contact us through:</p>
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4 my-3">
            <p className="font-medium text-surface-800 dark:text-surface-200">Developer312 Privacy Team</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">Email: <a href={`mailto:${contactDetails.email}`} className="text-accent-text hover:underline">{contactDetails.email}</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href={contactDetails.phoneHref} className="text-accent-text hover:underline">{contactDetails.phone}</a></p>
          </div>
          <p>We will verify your identity before processing your request and respond within the timeframe required by applicable law, typically within 30 days. If more time is needed, we will notify you of the reason and the expected timeline.</p>
        </LegalSection>

        <LegalSection id="cookies" title="15. Cookies and Tracking Technologies" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: F-F-16 - wording now matches behaviour: the theme choice is written to localStorage on first paint whatever the consent state (useTheme.tsx), nothing reads the Preferences or Marketing choices today, and withdrawing consent stops GTM loading on later page loads but does not delete cookies already set (consent-context.tsx, gtm.ts). The GPC/DNT sentence is unchanged; F-F-05 owns that promise. NEEDS-OWNER: if the consent work gates the theme write on consent, restore "set only if you consent" for preferences (tests/legal-evidence-coupling.test.tsx fails until the wording and the behaviour agree). */}
          <p>We use cookies and similar tracking technologies to operate our service, maintain session state, and analyze usage patterns. Categories we use include:</p>
          <ul>
            <li><strong>Essential storage:</strong> Required for authentication, security, and basic service functionality, including remembering your cookie choices (a record of a choice that has not yet reached our servers waits in your browser’s local storage, see Section 5)</li>
            <li><strong>Analytics cookies:</strong> Help us understand how users interact with our service so we can improve it</li>
            <li><strong>Preference storage:</strong> Your light or dark theme choice is saved in your browser's local storage on your device, whether or not you accept preference cookies, and is not sent to us</li>
            <li><strong>Marketing cookies:</strong> Used only with your consent to support marketing activities such as personalized advertising; these are off by default</li>
          </ul>
          {/* COUNSEL-REVIEW: F-F-05 / F-F-16 (K10 follow-up) - adds what src/lib/consent-mode.ts does on a change of choice: syncConsentMode pushes a Google Consent Mode "consent update" (analytics -> analytics_storage, marketing -> ad_storage, ad_user_data, ad_personalization) and sets ga-disable for the GA4 ids the page knows, so Google's tags already running are told the storage is denied without a page load. UNVERIFIED against the real GTM container (it could not be loaded): it holds for Google's own tags; a custom or third-party tag that ignores Consent Mode is not covered. The "does not automatically delete cookies" sentence is unchanged and still true (no code assigns document.cookie). tests/legal-evidence-coupling.test.tsx requires "Google Consent Mode" here while consent-mode.ts pushes that update. */}
          <p>Analytics and marketing cookies are set only if you consent to them. You can grant or withdraw consent at any time through the cookie preferences settings on our site or manage cookies through your browser settings. Withdrawing analytics consent stops analytics from loading on later page loads, and it also tells Google’s tags that are already running on the page (through Google Consent Mode) that the storage you withdrew consent for is denied, without waiting for the next page load; it does not automatically delete cookies that were already set, which you can remove in your browser settings. We also honor Global Privacy Control (GPC) and Do Not Track browser signals. Disabling essential cookies may affect service functionality.</p>
        </LegalSection>

        <LegalSection id="children" title="16. Children's Privacy" onScroll={setActiveSection}>
          <p>Our service is intended for business use and is not directed at individuals under the age of 16. We do not knowingly collect personal information from children. If we learn that we have collected personal data from a child under 16, we will take steps to delete it promptly. If you believe we have inadvertently collected such information, please contact us.</p>
        </LegalSection>

        <LegalSection id="changes" title="17. Changes to This Policy" onScroll={setActiveSection}>
          <p>We may update this Privacy Policy from time to time to reflect changes in our practices, features, vendors, or legal requirements. When we make material changes, we will:</p>
          <ul>
            <li>Update the "Last updated" date at the top of this page</li>
            <li>Provide notice through our service or by email for significant changes</li>
            <li>Obtain your consent where required by applicable law</li>
          </ul>
          <p>Continued use of the service after changes become effective constitutes acceptance of the updated policy.</p>
        </LegalSection>

        <LegalSection id="contact" title="18. Contact Information" onScroll={setActiveSection}>
          <p>If you have any questions about this Privacy Policy or our data practices, please contact:</p>
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4 my-3">
            <p className="font-medium text-surface-800 dark:text-surface-200">Developer312</p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">Email: <a href={`mailto:${contactDetails.email}`} className="text-accent-text hover:underline">{contactDetails.email}</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href={contactDetails.phoneHref} className="text-accent-text hover:underline">{contactDetails.phone}</a></p>
          </div>
        </LegalSection>
      </article>
    </div>
  );
}

function LegalSection({ id, title, onScroll, children }: { id: string; title: string; onScroll: (id: string) => void; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-6" onMouseEnter={() => onScroll(id)}>
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">{title}</h2>
      <div className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_h3]:font-semibold [&_h3]:text-surface-800 [&_h3]:dark:text-surface-200 [&_h3]:mt-4 [&_h3]:mb-2 [&_a]:text-accent-text [&_a]:hover:underline [&_p]:text-surface-600 [&_p]:dark:text-surface-400">
        {children}
      </div>
    </section>
  );
}