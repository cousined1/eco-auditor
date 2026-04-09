import { useState } from 'react';

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
        <div className="mb-8 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            This page is provided as a business draft for review and should be reviewed by qualified legal counsel before publication.
          </p>
        </div>

        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-surface-500">Last updated: [Date to be set upon legal review]</p>

        <LegalSection id="introduction" title="1. Introduction" onScroll={setActiveSection}>
          <p>Developer312 ("we," "us," or "our") operates the Eco-Auditor platform, a carbon accounting and emissions management service. This Privacy Policy describes how we collect, use, disclose, and protect information when you use our service.</p>
          <p>By accessing or using Eco-Auditor, you agree to the collection and use of information in accordance with this policy. If you do not agree with the terms of this policy, please do not access the service.</p>
          <p>This policy applies to all users of Eco-Auditor, including account holders, team members invited by account holders, and visitors to our website.</p>
        </LegalSection>

        <LegalSection id="who-we-are" title="2. Who We Are" onScroll={setActiveSection}>
          <p>Developer312 is a subsidiary of NIGHT LITE USA LLC. We provide the Eco-Auditor platform from the United States.</p>
          <p>Contact information:</p>
          <ul>
            <li>Email: <a href="mailto:hello@developer312.com" className="text-accent hover:underline">hello@developer312.com</a></li>
            <li>Phone: <a href="tel:+15104011225" className="text-accent hover:underline">(510) 401-1225</a></li>
          </ul>
        </LegalSection>

        <LegalSection id="info-collected" title="3. Information We Collect" onScroll={setActiveSection}>
          <p>We collect information in several categories to provide and improve our service:</p>
        </LegalSection>

        <LegalSection id="info-provided" title="4. Information You Provide Directly" onScroll={setActiveSection}>
          <p>When you create an account or use our service, you may provide:</p>
          <ul>
            <li><strong>Account details:</strong> Name, email address, password, company name, and role</li>
            <li><strong>Company information:</strong> Organization name, industry, facility locations, and operational details</li>
            <li><strong>Billing and contact information:</strong> Payment details, billing address, and designated billing contacts</li>
            <li><strong>Support communications:</strong> Messages, attachments, and correspondence submitted through our support channels</li>
            <li><strong>Uploaded documents and data:</strong> Utility bills, invoices, freight records, supplier spreadsheets, and other files you upload for emissions processing</li>
            <li><strong>Configuration choices:</strong> Organizational boundaries, emission factors, methodology selections, and reporting preferences</li>
          </ul>
          <p>We process this information to deliver the service you requested, maintain your account, and communicate with you about our platform.</p>
        </LegalSection>

        <LegalSection id="info-automatic" title="5. Information Collected Automatically" onScroll={setActiveSection}>
          <p>When you interact with our service, we may automatically collect:</p>
          <ul>
            <li><strong>Usage and log data:</strong> Pages visited, features used, click patterns, session duration, and interaction timestamps</li>
            <li><strong>Device and connection data:</strong> Browser type, operating system, IP address, screen resolution, and referring URL</li>
            <li><strong>Performance data:</strong> Load times, error reports, and system performance metrics</li>
          </ul>
          <p>We collect this information to ensure platform stability, diagnose issues, and improve user experience. We do not sell this data.</p>
        </LegalSection>

        <LegalSection id="info-third-parties" title="6. Information from Integrations and Third Parties" onScroll={setActiveSection}>
          <p>When you connect third-party services to Eco-Auditor, we may receive:</p>
          <ul>
            <li>Data from accounting integrations (e.g., QuickBooks, Xero) such as transaction records relevant to emissions calculations</li>
            <li>Data from shipping and logistics providers (e.g., UPS, FedEx) such as shipment records for freight emission estimates</li>
            <li>Data from cloud service providers for Scope 3 ICT emission calculations</li>
          </ul>
          <p>We only access data you explicitly authorize through these integrations, and we process it solely for the purpose of generating emissions estimates within your account.</p>
        </LegalSection>

        <LegalSection id="how-we-use" title="7. How We Use Information" onScroll={setActiveSection}>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, operate, and maintain the Eco-Auditor platform</li>
            <li>Process and organize uploaded documents and data into emissions records, estimates, and reports</li>
            <li>Operate AI-assisted features such as the Carbon Assistant for methodology guidance and classification suggestions</li>
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

          <h4>Service Providers and Subprocessors</h4>
          <p>We engage third-party service providers who process data on our behalf to deliver our service. These providers are contractually obligated to process data only as instructed and to maintain appropriate security measures. Categories include:</p>
          <ul>
            <li><strong>Cloud hosting:</strong> Infrastructure providers that host our application and data</li>
            <li><strong>Payments and billing:</strong> Payment processors such as Stripe, Inc. to handle subscription billing</li>
            <li><strong>Analytics:</strong> Service-level monitoring and aggregated usage analytics</li>
            <li><strong>Communications:</strong> Email delivery and notification services</li>
            <li><strong>Support:</strong> Customer support platforms that process support communications</li>
          </ul>
          <p>Our current subprocessor list is available upon request. We will notify customers of material changes to our subprocessors.</p>

          <h4>Compliance and Legal Requirements</h4>
          <p>We may disclose information when required by law, regulation, legal process, or governmental request, or when we believe in good faith that disclosure is necessary to protect our rights, your safety, or the safety of others.</p>
        </LegalSection>

        <LegalSection id="data-retention" title="9. Data Retention" onScroll={setActiveSection}>
          <p>We retain your information for as long as your account is active or as needed to provide our services. After account termination:</p>
          <ul>
            <li>Account and billing data is retained for up to 90 days to allow reactivation and export</li>
            <li>Emissions records, reports, and audit trails are retained for the period specified in your subscription agreement, after which they are securely deleted unless you request earlier deletion</li>
            <li>We may retain anonymized, aggregated usage data indefinitely for service improvement</li>
            <li>Some data may be retained longer where required by law or for legitimate business purposes such as fraud prevention</li>
          </ul>
        </LegalSection>

        <LegalSection id="data-security" title="10. Data Security" onScroll={setActiveSection}>
          <p>We implement appropriate technical and organizational measures to protect your information, including:</p>
          <ul>
            <li>Encryption of data in transit using TLS 1.2+</li>
            <li>Encryption of data at rest</li>
            <li>Role-based access controls and least-privilege principles</li>
            <li>Regular security assessments and vulnerability management</li>
            <li>Incident response procedures</li>
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
            <li><strong>Deletion:</strong> Request deletion of your personal data, subject to lawful retention requirements</li>
            <li><strong>Portability:</strong> Request transfer of your data in a structured, commonly used format</li>
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
            <li><strong>Right to opt out of sale or sharing:</strong> We do not sell or share personal information for cross-context behavioral advertising purposes</li>
            <li><strong>Right to limit use of sensitive personal information:</strong> We do not collect or use sensitive personal information beyond what is necessary to provide our service</li>
          </ul>
          <p>We are not a data broker and do not sell personal information. Our service is directed at businesses, and the personal information we process is primarily business-related rather than consumer-oriented.</p>
          <p>Authorized agents may submit requests on your behalf, subject to verification.</p>
        </LegalSection>

        <LegalSection id="privacy-request" title="14. How to Submit a Privacy Request" onScroll={setActiveSection}>
          <p>To submit a privacy request, exercise your rights, or ask questions about this policy, you may contact us through:</p>
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-4 my-3">
            <p className="font-medium text-surface-800 dark:text-surface-200">Developer312 Privacy Team</p>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">Email: <a href="mailto:hello@developer312.com" className="text-accent hover:underline">hello@developer312.com</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href="tel:+15104011225" className="text-accent hover:underline">(510) 401-1225</a></p>
          </div>
          <p>We will verify your identity before processing your request and respond within the timeframe required by applicable law, typically within 30 days. If more time is needed, we will notify you of the reason and the expected timeline.</p>
        </LegalSection>

        <LegalSection id="cookies" title="15. Cookies and Tracking Technologies" onScroll={setActiveSection}>
          <p>We use cookies and similar tracking technologies to operate our service, maintain session state, and analyze usage patterns. Categories of cookies we use include:</p>
          <ul>
            <li><strong>Essential cookies:</strong> Required for authentication, security, and basic service functionality</li>
            <li><strong>Analytics cookies:</strong> Help us understand how users interact with our service so we can improve it</li>
            <li><strong>Preference cookies:</strong> Remember your settings such as theme preferences</li>
          </ul>
          <p>We do not use cookies for cross-site tracking or targeted advertising. You can manage cookie preferences through your browser settings. Disabling essential cookies may affect service functionality.</p>
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
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">Email: <a href="mailto:hello@developer312.com" className="text-accent hover:underline">hello@developer312.com</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href="tel:+15104011225" className="text-accent hover:underline">(510) 401-1225</a></p>
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
      <div className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_h4]:font-semibold [&_h4]:text-surface-800 [&_h4]:dark:text-surface-200 [&_h4]:mt-4 [&_h4]:mb-2 [&_a]:text-accent [&_a]:hover:underline [&_p]:text-surface-600 [&_p]:dark:text-surface-400">
        {children}
      </div>
    </section>
  );
}