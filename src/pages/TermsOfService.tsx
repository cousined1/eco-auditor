import { useState } from 'react';

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
        <div className="mb-8 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300">This page is provided as a business draft for review and should be reviewed by qualified legal counsel before publication.</p>
        </div>

        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Terms of Service</h1>
        <p className="text-sm text-surface-500">Last updated: [Date to be set upon legal review]</p>

        <Sec id="acceptance" title="1. Acceptance of Terms" onScroll={setActiveSection}>
          <p>By accessing or using the Eco-Auditor platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you are using the Service on behalf of an organization, you represent that you have the authority to bind that organization to these Terms.</p>
          <p>If you do not agree to these Terms, you may not access or use the Service.</p>
        </Sec>

        <Sec id="company" title="2. Company Identity" onScroll={setActiveSection}>
          <p>The Eco-Auditor platform is operated by Developer312. Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
          <p>Contact: <a href="mailto:hello@developer312.com" className="text-accent hover:underline">hello@developer312.com</a> | <a href="tel:+15104011225" className="text-accent hover:underline">(510) 401-1225</a></p>
        </Sec>

        <Sec id="eligibility" title="3. Eligibility and Business Use" onScroll={setActiveSection}>
          <p>The Service is intended for business and professional use. By using the Service, you represent that you are at least 18 years of age and have the legal capacity to enter into these Terms.</p>
          <p>The Service is designed for organizations seeking to track, estimate, organize, and report emissions data for internal workflow and audit-readiness purposes. It is not a substitute for professional environmental, legal, accounting, or tax advice.</p>
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
          <p>You may use the Service to:</p>
          <ul>
            <li>Track, organize, and estimate emissions data across Scope 1, 2, and 3 categories</li>
            <li>Upload documents and integrate data sources for emissions processing</li>
            <li>Generate reports and audit trails for internal review and external disclosure</li>
            <li>Use AI-assisted tools for classification suggestions and methodology guidance</li>
            <li>Manage supplier communications and data requests related to emissions</li>
          </ul>
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
            <li><strong>Plan changes:</strong> Upgrades take effect immediately with a prorated charge for the remaining billing period. Downgrades take effect at the end of the current billing period</li>
            <li><strong>Annual discounts:</strong> Annual subscriptions are offered at a discounted rate compared to monthly billing. The annual rate represents an approximate 17% savings over the equivalent monthly cost</li>
            <li><strong>Taxes:</strong> Applicable taxes may be added to your invoice based on your billing location</li>
          </ul>
        </Sec>

        <Sec id="trials-termination" title="9. Trials, Cancellation, Suspension, and Termination" onScroll={setActiveSection}>
          <ul>
            <li><strong>Free trials:</strong> We may offer free trials for eligible plans. Trial periods are limited in duration and features. At the end of a trial, you will be charged for the selected plan unless you cancel before the trial expires</li>
            <li><strong>Cancellation:</strong> You may cancel your subscription at any time through your account settings or by contacting us. Cancellation prevents future charges but does not result in a refund for the current billing period</li>
            <li><strong>Suspension:</strong> We may suspend access to the Service for overdue payments, Terms violations, or suspected fraudulent activity</li>
            <li><strong>Termination:</strong> We may terminate your account for material breach of these Terms with notice. Upon termination, your right to access the Service ceases immediately</li>
            <li><strong>Data after termination:</strong> Your data will be retained for 90 days after termination to allow for export. After that period, data is securely deleted unless otherwise required by law</li>
          </ul>
        </Sec>

        <Sec id="ip" title="10. Intellectual Property" onScroll={setActiveSection}>
          <p>The Service, including its software, interface, design, documentation, and underlying technology, is owned by Developer312 and its licensors and is protected by intellectual property laws. These Terms do not grant you any ownership interest in the Service.</p>
          <p>Our name, logo, and product names are trademarks of Developer312 or NIGHT LITE USA LLC. You may not use these marks without our prior written permission.</p>
        </Sec>

        <Sec id="customer-data" title="11. Customer Data and Content" onScroll={setActiveSection}>
          <p>You retain ownership of the data and content you upload to the Service, including emissions data, documents, reports, and configuration settings.</p>
          <p>You grant Developer312 a limited, non-exclusive license to process your data solely for the purpose of providing the Service, including generating emissions estimates, organizing audit trails, and producing reports.</p>
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
          <p><strong>Eco-Auditor is a software platform for workflow support, data organization, estimation assistance, audit readiness, and reporting preparation.</strong></p>
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
          <p>DEVELOPER312'S TOTAL CUMULATIVE LIABILITY FOR ANY CLAIMS ARISING FROM OR RELATED TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE TOTAL FEES PAID BY YOU TO DEVELOPER312 IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) [AMOUNT TO BE SET UPON LEGAL REVIEW].</p>
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
          <p>These Terms shall be governed by and construed in accordance with the laws of [Jurisdiction to be set upon legal review], without regard to its conflict-of-law provisions.</p>
          <p>Any disputes arising out of or in connection with these Terms shall be resolved through [Dispute resolution mechanism to be set upon legal review — e.g., arbitration, mediation, or courts of specified jurisdiction].</p>
        </Sec>

        <Sec id="changes" title="20. Changes to Terms" onScroll={setActiveSection}>
          <p>We may update these Terms from time to time. We will provide notice of material changes by updating the "Last updated" date and, where appropriate, by sending email notification or displaying a notice within the Service.</p>
          <p>Continued use of the Service after changes become effective constitutes acceptance of the revised Terms. If you do not agree with the changes, you may cancel your subscription as described in these Terms.</p>
        </Sec>

        <Sec id="contact" title="21. Contact Information" onScroll={setActiveSection}>
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4 my-3">
            <p className="font-medium text-surface-800 dark:text-surface-200">Developer312</p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">Email: <a href="mailto:hello@developer312.com" className="text-accent hover:underline">hello@developer312.com</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href="tel:+15104011225" className="text-accent hover:underline">(510) 401-1225</a></p>
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
      <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-accent [&_a]:hover:underline [&_p]:text-surface-600 [&_p]:dark:text-surface-400 [&_strong]:text-surface-800 [&_strong]:dark:text-surface-200">
        {children}
      </div>
    </section>
  );
}