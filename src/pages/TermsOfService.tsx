import { useState } from 'react';
import { contactDetails } from '@/content/trust-facts';
import { dataFacts } from '@/content/data-facts';

const SECTIONS = [
  { id: 'acceptance', label: 'Acceptance of Terms' },
  { id: 'company', label: 'Company Identity' },
  { id: 'eligibility', label: 'Eligibility & Business Use' },
  { id: 'accounts', label: 'Accounts & Credentials' },
  { id: 'permitted-use', label: 'Permitted Use' },
  { id: 'prohibited-use', label: 'Prohibited Use' },
  { id: 'subscription', label: 'Subscription Terms' },
  { id: 'billing', label: 'Billing, Renewals & Plan Changes' },
  { id: 'trials-termination', label: 'Trials, Cancellation & Termination' },
  { id: 'ip', label: 'Intellectual Property' },
  { id: 'customer-data', label: 'Customer Data & Content' },
  { id: 'third-party', label: 'Third-Party Services & Integrations' },
  { id: 'availability', label: 'Service Availability' },
  { id: 'disclaimer', label: 'Disclaimer & Important Notices' },
  { id: 'warranties', label: 'Disclaimer of Warranties' },
  { id: 'liability', label: 'Limitation of Liability' },
  { id: 'indemnification', label: 'Indemnification' },
  { id: 'compliance', label: 'Compliance Responsibilities' },
  { id: 'governing-law', label: 'Governing Law & Disputes' },
  { id: 'changes', label: 'Changes to Terms' },
  { id: 'contact', label: 'Contact Information' },
];

export default function TermsOfService() {
  const [activeSection, setActiveSection] = useState('acceptance');

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
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Terms of Service</h1>
        {/* COUNSEL-REVIEW: the date is the drafting date of these factual corrections (K14), not a publication date. NEEDS-OWNER: set the effective date at publication. */}
        <p className="text-sm text-surface-500">Last updated: September 30, 2026</p>

        <Sec id="acceptance" title="1. Acceptance of Terms" onScroll={setActiveSection}>
          <p>By accessing or using the Eco-Auditor platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you are using the Service on behalf of an organization, you represent that you have the authority to bind that organization to these Terms.</p>
          <p>If you do not agree to these Terms, you may not access or use the Service.</p>
        </Sec>

        <Sec id="company" title="2. Company Identity" onScroll={setActiveSection}>
          <p>The Eco-Auditor platform is operated by Developer312. Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
          <p>Contact: <a href={`mailto:${contactDetails.email}`} className="text-accent-text hover:underline">{contactDetails.email}</a> | <a href={contactDetails.phoneHref} className="text-accent-text hover:underline">{contactDetails.phone}</a></p>
        </Sec>

        <Sec id="eligibility" title="3. Eligibility and Business Use" onScroll={setActiveSection}>
          <p>The Service is intended for business and professional use. By using the Service, you represent that you are at least 18 years of age and have the legal capacity to enter into these Terms.</p>
          {/* COUNSEL-REVIEW: VF-9 (post-web) - "audit-readiness purposes" is replaced by "reporting-preparation purposes". The product offers no audit trail and the claims register withdrew "audit-ready" (claims.ts, audit-ready): the Service produces a PDF emissions summary and a JSON export, and assurance is performed by an independent provider. tests/legal-evidence-coupling.test.tsx fails if a legal page names audit readiness again. NEEDS-OWNER: confirm the new wording describes the intended use. */}
          <p>The Service is designed for organizations seeking to track, estimate, organize, and report emissions data for internal workflow and reporting-preparation purposes. It is not a substitute for professional environmental, legal, accounting, or tax advice.</p>
        </Sec>

        <Sec id="accounts" title="4. Accounts and Credentials" onScroll={setActiveSection}>
          <p>To use the Service, you must create an account and provide accurate, current information. You are responsible for:</p>
          <ul>
            <li>Maintaining the confidentiality of your account credentials</li>
            <li>All activities that occur under your account</li>
            <li>Notifying us promptly of any unauthorized use or security breach</li>
          </ul>
          <p>We reserve the right to suspend or terminate accounts that violate these Terms.</p>
        </Sec>

        <Sec id="permitted-use" title="5. Permitted Use" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: VF-9 (post-web) - this list named features the product does not have: uploading documents and integrating data sources (no document is stored; data comes in by CSV import), audit trails (none; an audit trail is on the roadmap), AI-assisted tools (the AI Carbon Assistant is not built) and supplier communications (the Supplier request hub is not built). It now lists what exists, as the claims register words it: a calculator, CSV import, a PDF emissions summary and a JSON download of your data, and the paragraph below says plainly what is not offered. That paragraph is the only sentence on a legal page allowed to name those features, by a short allowlist in tests/legal-evidence-coupling.test.tsx. "For external disclosure" is kept as the customer's own use of a report; Sections 14 and 18 say the Service does not ensure compliance or acceptance. NEEDS-OWNER: confirm the list and the "not yet available" statement; counsel may prefer to say nothing about planned features. */}
          <p>You may use the Service to:</p>
          <ul>
            <li>Track, organize, and estimate emissions data across Scope 1, 2, and 3 categories</li>
            <li>Import activity data from CSV files for emissions processing</li>
            <li>Generate reports as PDF emissions summaries for internal review and external disclosure, and export your data as JSON</li>
          </ul>
          <p>The Service does not currently offer document upload, an audit trail, an AI assistant or supplier requests; the last three are on our product roadmap and are not yet available.</p>
        </Sec>

        <Sec id="prohibited-use" title="6. Prohibited Use" onScroll={setActiveSection}>
          <p>You may not:</p>
          <ul>
            <li>Use the Service for any unlawful purpose or in violation of any applicable regulation</li>
            <li>Attempt to reverse-engineer, decompile, or extract the Service's source code or proprietary algorithms</li>
            <li>Share account credentials with unauthorized individuals</li>
            <li>Use the Service to generate or distribute content that is defamatory, infringing, or harmful</li>
            <li>Interfere with or disrupt the Service's infrastructure or other users' access</li>
            <li>Resell, sublicense, or redistribute the Service without prior written consent</li>
          </ul>
        </Sec>

        <Sec id="subscription" title="7. Subscription Terms" onScroll={setActiveSection}>
          <p>Access to the Service is provided through paid subscriptions. Subscription plans, pricing, and feature availability are described on our pricing page and may be updated from time to time.</p>
          <p>By selecting a subscription plan, you agree to pay the applicable fees for the billing period you have selected (monthly or annual). Plan-specific features and usage limits are defined at the time of subscription.</p>
        </Sec>

        <Sec id="billing" title="8. Billing, Renewals, and Plan Changes" onScroll={setActiveSection}>
          <ul>
            <li><strong>Billing cycle:</strong> Subscriptions are billed in advance on a monthly or annual basis, depending on your selected plan</li>
            <li><strong>Auto-renewal:</strong> Subscriptions renew automatically at the end of each billing period unless canceled before the renewal date</li>
            {/* COUNSEL-REVIEW: VF-3 (post-web) - this item said downgrades take effect at the end of the current billing period. They do not: PATCH /api/subscription (server.cjs) swaps the price at once for every plan change with proration_behavior create_prorations, and Settings offers every plan, downgrades included; there is no end-of-period schedule. Stripe puts the prorated charge or credit on the next invoice and does not refund a credit (Stripe documentation, "Prorations"). The item now says what the handler does, and tests/legal-evidence-coupling.test.tsx reads the handler: if a downgrade is ever scheduled for the end of the period, or prorations are invoiced at once, it fails until this item is rewritten. OWNER DECISION: keep the behaviour and this wording, or change the code to schedule downgrades (a Stripe subscription schedule, or proration_behavior none at renewal) and restore the old sentence. NEEDS-OWNER: counsel to confirm that "take effect immediately" and the invoice timing are acceptable to publish. */}
            <li><strong>Plan changes:</strong> Upgrades and downgrades take effect immediately. The difference in price for the rest of the current billing period is prorated: an upgrade adds a prorated charge and a downgrade gives a prorated credit, which appear on your next invoice</li>
            <li><strong>Annual discounts:</strong> Annual subscriptions are offered at a discounted rate compared to monthly billing. The annual rate represents an approximate 17% savings over the equivalent monthly cost</li>
            <li><strong>Taxes:</strong> Applicable taxes may be added to your invoice based on your billing location</li>
          </ul>
        </Sec>

        <Sec id="trials-termination" title="9. Trials, Cancellation, Suspension, and Termination" onScroll={setActiveSection}>
          <ul>
            {/*
              Rewritten to match actual behaviour. The previous text said "No
              payment method is required to start a trial" and "no automatic
              charge occurs" for ALL trials — but a trial started from the
              pricing page creates a Stripe Checkout subscription with
              trial_period_days: 14, which collects a card and auto-converts at
              trial end. Publishing terms that deny an auto-converting trial is
              negative-option / state auto-renewal exposure.
              *** HAVE COUNSEL REVIEW THIS WORDING BEFORE PUBLISHING. ***
              See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-6).
            */}
            {/* COUNSEL-REVIEW: F-B-18 (K16 follow-up; VF-13 post-web) - the last sentence of this item states the rule checkoutTrialDecision in server-billing.cjs applies to POST /api/checkout: no trial is attached when the company's card-free trial has run out, when its own record shows a subscription, or when Stripe lists a past subscription for the customer. It used to say that "a free trial" is offered once per company, which was not literally true: a company still inside its card-free trial is trialEligible (billingStateFromCompany: not ever subscribed and the trial not run out), so it can also start a card-backed trial at checkout (up to 14 + 14 days, K16 decision D-K16-1). The sentence now speaks of the trial started at checkout, which is offered once per company, and says when it is not offered; it still does not mention that a company within its free trial may start one, which the owner can state or remove by tightening the code (no checkout trial while trialActive). tests/legal-evidence-coupling.test.tsx runs that function and requires this sentence while it refuses a second checkout trial. NEEDS-OWNER: decide D-K16-1: tighten checkoutTrialDecision, or keep the code and, if counsel wants it said, add that a company within its free trial may also start one trial at checkout. */}
            <li><strong>Free trials:</strong> We may offer 14-day free trials on eligible monthly plans. There are two ways to start one. <em>If you sign up directly without selecting a plan</em>, no payment method is required; if you do not select a paid plan before the trial ends, access to the workspace is paused until you do, and no charge occurs. <em>If you start a trial by selecting a plan</em>, you will be asked for a payment method at checkout, and unless you cancel before the trial ends the selected subscription begins automatically at the end of the trial period and you authorize the charge at that time. You may cancel at any point during the trial from your account settings. A trial started at checkout is offered once per company: it is not offered if your company's free trial has already ended or if your company has already had a subscription, and billing then begins when you subscribe</li>
            <li><strong>Cancellation:</strong> You may cancel your subscription at any time through your account settings or by contacting us. Cancellation prevents future charges but does not result in a refund for the current billing period</li>
            <li><strong>Suspension:</strong> We may suspend access to the Service for overdue payments, Terms violations, or suspected fraudulent activity</li>
            <li><strong>Termination:</strong> We may terminate your account for material breach of these Terms with notice. Upon termination, your right to access the Service ceases immediately</li>
            {/*
              COUNSEL-REVIEW: F-A-20 (D-10) / F-D-06 - the previous text listed in-account controls that termination removes and said nothing about what happens to data afterwards. It now says plainly that cancelling or terminating deletes nothing and that nothing is deleted automatically. No post-termination period is stated: none exists (the DPA no longer refers to one).
              NEEDS-OWNER: decide whether to commit to automatic deletion after termination (needs a job or runbook) and the period, and whether a departing customer can request an export after access ends.
              COUNSEL-REVIEW: VF-2 (post-web) - the sentence about deleting audit data now adds, from src/content/data-facts.ts, that generated reports are not part of that deletion and that a stored report keeps a copy of the entries it covers (the delete-data handler touches no reports column; migrations/20260930110000_report-snapshots.sql stores the snapshot and PDF). Same sentence as Settings, Security, Privacy Section 9 and the DPA; tests/legal-evidence-coupling.test.tsx ties it to the handler. OWNER DECISION: whether "Delete my audit data" should also delete draft reports (see the Privacy Policy marker in Section 9).
              COUNSEL-REVIEW: K3 follow-up (VERIFY-W2A-DATA F5) - the one automatic deletion is the trigger reports_prune_drafts (migrations/20260930110000_report-snapshots.sql): storing a new frozen draft report deletes the same company's older unsigned drafts beyond the newest 25 (MAX_DRAFT_REPORTS in src/lib/reports/report-limits.cjs); signed-off reports are never deleted by it and a pruned draft cannot be recovered. Same sentence as Privacy Section 9, Security (Data export and deletion) and DPA Section 11. OWNER DECISION: is a 25-draft bound acceptable?
            */}
            <li><strong>Data after termination:</strong> Cancelling your subscription or terminating your account does not delete your data, and nothing is deleted automatically, with one exception: we keep only the 25 most recent unsigned draft reports per workspace and delete older drafts when a new report is generated; signed-off reports are not deleted this way. While you have access to the Service you can export your data at any time from Settings as a machine-readable JSON download, and you can delete your audit data (emissions entries and facilities) at any time from Settings; deletion takes effect immediately. {dataFacts.deleteAuditData.reports}. Your account record is retained until you ask for it to be deleted; full account deletion is available via support, and such requests are processed within 30 days unless otherwise required by law. The Privacy Policy and the Data Processing Addendum describe what is kept</li>
          </ul>
        </Sec>

        <Sec id="ip" title="10. Intellectual Property" onScroll={setActiveSection}>
          <p>The Service, including its software, interface, design, documentation, and underlying technology, is owned by Developer312 and its licensors and is protected by intellectual property laws. These Terms do not grant you any ownership interest in the Service.</p>
          <p>Our name, logo, and product names are trademarks of Developer312 or NIGHT LITE USA LLC. You may not use these marks without our prior written permission.</p>
        </Sec>

        <Sec id="customer-data" title="11. Customer Data and Content" onScroll={setActiveSection}>
          <p>You retain ownership of the data and content you upload to the Service, including emissions data, documents, reports, and configuration settings.</p>
          {/* COUNSEL-REVIEW: VF-9 (post-web) - "organizing audit trails" is replaced by "organizing emissions data": the product has no audit trail (claims.ts, audit-ready; an audit trail is on the roadmap). The limit of the licence, processing solely to provide the Service, is unchanged. NEEDS-OWNER: confirm the wording. */}
          <p>You grant Developer312 a limited, non-exclusive license to process your data solely for the purpose of providing the Service, including generating emissions estimates, organizing emissions data, and producing reports.</p>
          <p>You are responsible for ensuring that any data you upload complies with applicable laws and does not infringe the rights of third parties.</p>
        </Sec>

        <Sec id="third-party" title="12. Third-Party Services and Integrations" onScroll={setActiveSection}>
          <p>The Service may offer integrations with third-party platforms such as accounting systems, shipping providers, and cloud services. Your use of these integrations is governed by the third party's terms and privacy policy in addition to these Terms.</p>
          <p>We do not warrant the availability, accuracy, or security of third-party services. We are not liable for any loss or damage arising from your use of third-party integrations.</p>
        </Sec>

        <Sec id="availability" title="13. Service Availability" onScroll={setActiveSection}>
          <p>We strive to provide reliable service but do not guarantee uninterrupted or error-free access. Scheduled maintenance, unforeseen outages, and force majeure events may affect availability.</p>
          <p>We will make reasonable efforts to provide advance notice of planned maintenance windows.</p>
        </Sec>

        <Sec id="disclaimer" title="14. Disclaimer and Important Notices" onScroll={setActiveSection}>
          {/* COUNSEL-REVIEW: VF-9 (post-web) - "audit readiness" is removed from the list of what the platform is for: the claims register withdrew "audit-ready" (claims.ts, audit-ready), the product has no audit trail, and llms.txt says it is not an assurance or audit tool. The other four purposes are unchanged. NEEDS-OWNER: confirm the wording. */}
          <p><strong>Eco-Auditor is a software platform for workflow support, data organization, estimation assistance, and reporting preparation.</strong></p>
          <p>The Service does not provide legal advice, accounting advice, tax advice, environmental consulting advice, or regulatory certification. Customers remain responsible for reviewing classifications, assumptions, calculations, filings, and reports before use or submission.</p>
          <p>AI-generated content, emissions estimates, and automated categorizations provided by the Service may be incomplete, require human validation, and should not be relied upon as final or verified outputs without appropriate review.</p>
          <p>Use of the platform does not guarantee compliance with any specific regulation, does not guarantee audit outcomes or report acceptance, and does not guarantee the avoidance of fines, penalties, or adverse legal consequences. The Service is not a substitute for professional environmental, legal, or financial advice.</p>
        </Sec>

        <Sec id="warranties" title="15. Disclaimer of Warranties" onScroll={setActiveSection}>
          <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE.</p>
          <p>TO THE FULLEST EXTENT PERMITTED BY LAW, DEVELOPER312 DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.</p>
          <p>WE DO NOT WARRANT THAT:</p>
          <ul>
            <li>The Service will be uninterrupted, timely, secure, or error-free</li>
            <li>The results, estimates, or outputs from the Service will be accurate, reliable, or complete</li>
            <li>The Service will meet your specific requirements or be suitable for any particular legal, regulatory, or business purpose</li>
            <li>Any errors or defects in the Service will be corrected</li>
          </ul>
        </Sec>

        <Sec id="liability" title="16. Limitation of Liability" onScroll={setActiveSection}>
          <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL DEVELOPER312, ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, BUSINESS OPPORTUNITIES, OR REPUTATION, ARISING OUT OF OR IN CONNECTION WITH THE SERVICE OR THESE TERMS.</p>
          <p>DEVELOPER312'S TOTAL CUMULATIVE LIABILITY FOR ANY CLAIMS ARISING FROM OR RELATED TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE TOTAL FEES PAID BY YOU TO DEVELOPER312 IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) $5,000.</p>
          <p>Some jurisdictions do not allow the exclusion or limitation of certain warranties or liabilities, so some of the above limitations may not apply to you.</p>
        </Sec>

        <Sec id="indemnification" title="17. Indemnification" onScroll={setActiveSection}>
          <p>You agree to indemnify, defend, and hold harmless Developer312, its affiliates, and their respective officers, directors, employees, and agents from and against any claims, damages, losses, and expenses (including reasonable attorneys' fees) arising out of or in connection with:</p>
          <ul>
            <li>Your use of the Service in violation of these Terms</li>
            <li>Your violation of applicable laws or regulations</li>
            <li>Data or content you upload that infringes the rights of third parties</li>
            <li>Your reliance on Service outputs, including emissions estimates or reports, for compliance or regulatory purposes</li>
          </ul>
        </Sec>

        <Sec id="compliance" title="18. Compliance Responsibilities" onScroll={setActiveSection}>
          <p>You are solely responsible for determining the applicability of any environmental, regulatory, or reporting requirements to your business. The Service provides tools to help organize and calculate emissions data, but you must independently verify all outputs, assumptions, and methodologies before relying on them for any filing, disclosure, or regulatory submission.</p>
          <p>Developer312 does not represent that the Service satisfies the requirements of any specific regulation, standard, or framework, including but not limited to California SB 253, California SB 261, EU CBAM, or GHG Protocol.</p>
        </Sec>

        <Sec id="governing-law" title="19. Governing Law and Dispute Resolution" onScroll={setActiveSection}>
          <p>These Terms shall be governed by and construed in accordance with the laws of the State of California, without regard to its conflict-of-law provisions.</p>
          <p>Any disputes arising out of or in connection with these Terms shall be resolved through binding arbitration in the State of California, excluding jury trial.</p>
        </Sec>

        <Sec id="changes" title="20. Changes to Terms" onScroll={setActiveSection}>
          <p>We may update these Terms from time to time. We will provide notice of material changes by updating the "Last updated" date and, where appropriate, by sending email notification or displaying a notice within the Service.</p>
          <p>Continued use of the Service after changes become effective constitutes acceptance of the revised Terms. If you do not agree with the changes, you may cancel your subscription as described in these Terms.</p>
        </Sec>

        <Sec id="contact" title="21. Contact Information" onScroll={setActiveSection}>
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4 my-3">
            <p className="font-medium text-surface-800 dark:text-surface-200">Developer312</p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">Email: <a href={`mailto:${contactDetails.email}`} className="text-accent-text hover:underline">{contactDetails.email}</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href={contactDetails.phoneHref} className="text-accent-text hover:underline">{contactDetails.phone}</a></p>
          </div>
        </Sec>
      </article>
    </div>
  );
}

function Sec({ id, title, onScroll, children }: { id: string; title: string; onScroll: (id: string) => void; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-6" onMouseEnter={() => onScroll(id)}>
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">{title}</h2>
      <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-accent-text [&_a]:hover:underline [&_p]:text-surface-600 [&_p]:dark:text-surface-400 [&_strong]:text-surface-800 [&_strong]:dark:text-surface-200">
        {children}
      </div>
    </section>
  );
}