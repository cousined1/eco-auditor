import { useState } from 'react';

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
        <div className="mb-8 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300">This Data Processing Addendum is provided as a business draft for review and should be reviewed by qualified legal counsel before publication or signature.</p>
        </div>

        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Data Processing Addendum</h1>
        <p className="text-sm text-surface-500">Last updated: [Date to be set upon legal review]</p>

        <S id="purpose" title="1. Purpose and Scope" onScroll={setActiveSection}>
          <p>This Data Processing Addendum ("DPA") forms part of the Terms of Service between Developer312 and the Customer and supplements the Terms with respect to the processing of personal data.</p>
          <p>This DPA applies where Developer312 processes personal data on behalf of the Customer in connection with the Eco-Auditor platform. It is intended to support GDPR-aligned controller-to-processor arrangements.</p>
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
          <p>This DPA applies for the duration of the Customer's subscription and a post-termination retention period as specified in the Terms of Service, after which personal data is securely deleted in accordance with Section 12.</p>
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
          <p>Developer312's employees and contractors are bound by confidentiality agreements and receive data protection training appropriate to their role.</p>
        </S>

        <S id="security" title="7. Security of Processing" onScroll={setActiveSection}>
          <p>Developer312 implements appropriate technical and organizational measures to ensure a level of security appropriate to the risk, as detailed in Annex II. These measures include:</p>
          <ul>
            <li>Role-based access controls and least-privilege access</li>
            <li>Encryption of personal data in transit (TLS 1.2+) and at rest</li>
            <li>Authentication and password controls including multi-factor authentication</li>
            <li>Logging, monitoring, and intrusion detection</li>
            <li>Backup and disaster recovery measures</li>
            <li>Environment segregation between production, staging, and development</li>
            <li>Vulnerability management and security patching</li>
            <li>Incident response procedures</li>
            <li>Employee confidentiality obligations and security training</li>
            <li>Secure deletion procedures</li>
          </ul>
        </S>

        <S id="subprocessors" title="8. Use of Subprocessors" onScroll={setActiveSection}>
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
          <p>Upon termination of the service agreement, Developer312 will, at the Customer's choice:</p>
          <ul>
            <li>Return all personal data to the Customer in a structured, commonly used, machine-readable format; or</li>
            <li>Securely delete all personal data and certify such deletion in writing</li>
          </ul>
          <p>This obligation does not apply where retention of personal data is required by applicable law, in which case Developer312 will continue to process such data only for the purpose and duration required by law.</p>
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
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">Email: <a href="mailto:hello@developer312.com" className="text-accent hover:underline">hello@developer312.com</a></p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Phone: <a href="tel:+15104011225" className="text-accent hover:underline">(510) 401-1225</a></p>
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
                  ['Duration', 'For the subscription term and a post-termination retention/deletion period as specified in the Terms of Service'],
                  ['Purpose', 'Providing workflow automation, reporting preparation, audit trails, user account administration, support, security, and related SaaS functionality'],
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
              { category: 'Access Control', measures: ['Role-based access controls with least-privilege principles', 'Multi-factor authentication for administrative access', 'Unique user identification and authentication', 'Regular access reviews and deprovisioning'] },
              { category: 'Data Encryption', measures: ['TLS 1.2+ for all data in transit', 'AES-256 encryption for data at rest', 'Encrypted backups and secure key management'] },
              { category: 'Infrastructure Security', measures: ['Environment segregation (production, staging, development)', 'Network segmentation and firewall controls', 'Vulnerability management and security patching', 'Regular security assessments and penetration testing'] },
              { category: 'Operational Security', measures: ['Logging and monitoring of system access and events', 'Incident response procedures with defined escalation paths', 'Employee confidentiality obligations and security training', 'Secure deletion procedures for data no longer required'] },
              { category: 'Business Continuity', measures: ['Regular backup and recovery procedures', 'Disaster recovery plans with tested restore capabilities', 'Redundant infrastructure components for availability'] },
              { category: 'Subprocessor Management', measures: ['Written data processing agreements with all subprocessors', 'Ongoing review of subprocessor security practices', 'Notification procedures for subprocessor changes'] },
            ].map((group) => (
              <div key={group.category} className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{group.category}</h4>
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
                  { name: 'Cloud hosting provider', purpose: 'Application hosting, data storage, compute', location: 'United States' },
                  { name: 'Stripe, Inc.', purpose: 'Payment processing and billing', location: 'United States' },
                  { name: 'Analytics provider', purpose: 'Service-level monitoring and aggregated usage analytics', location: 'United States' },
                  { name: 'Email/communications provider', purpose: 'Transactional and notification email delivery', location: 'United States' },
                  { name: 'Customer support platform', purpose: 'Support ticket management and communications', location: 'United States' },
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
          <p className="text-xs text-surface-500 mt-3">Developer312 will notify the Customer of changes to this subprocessor list in accordance with Section 8 of this DPA. A current list is available upon request.</p>
        </S>

        <S id="annex-iv" title="Annex IV: International Data Transfers and SCC Information" onScroll={setActiveSection}>
          <p>Where personal data is transferred outside the EEA/UK/Switzerland, the following applies:</p>
          <div className="space-y-4 mt-3">
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">SCC Module Applicability</h4>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">Module Two (Controller to Processor) applies where the Customer acts as Controller. Module Three (Processor to Processor) applies where Developer312 engages subprocessors.</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Transfer Mechanism</h4>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">The European Commission's Standard Contractual Clauses (Decision 2021/914) serve as the primary transfer mechanism. For UK transfers, the UK Addendum to the EU SCCs applies.</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
              <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Supplementary Measures</h4>
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
      <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-accent [&_a]:hover:underline [&_p]:text-surface-600 [&_p]:dark:text-surface-400 [&_strong]:text-surface-800 [&_strong]:dark:text-surface-200">
        {children}
      </div>
    </section>
  );
}