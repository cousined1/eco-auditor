import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { submitLead } from '../lib/leads';

type TopicValue = 'sales' | 'billing' | 'product' | 'legal' | 'dpa' | 'security' | 'support' | 'other';

const TOPIC_BY_QUERY: Record<string, TopicValue> = {
  sales: 'sales',
  billing: 'billing',
  product: 'product',
  legal: 'legal',
  privacy: 'legal',
  dpa: 'dpa',
  security: 'security',
  support: 'support',
  other: 'other',
};

export default function ContactUs() {
  const [searchParams] = useSearchParams();
  const initialSubject = TOPIC_BY_QUERY[searchParams.get('topic') ?? ''] ?? '';
  const [form, setForm] = useState({ name: '', company: '', email: '', subject: initialSubject, message: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Your name is required.';
    if (!form.email.trim()) errors.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
    if (!form.subject) errors.subject = 'Select a topic.';
    if (!form.message.trim()) errors.message = 'Tell us what you need.';
    // Mirror the leads table CHECK constraints (name<=120, company<=160,
    // message<=1000). Without these the DB rejected the row and the raw
    // constraint-violation text was shown to the prospect, losing the lead.
    else if (form.message.length > 1000) errors.message = 'Please keep your message under 1,000 characters.';
    if (form.name.length > 120) errors.name = 'Please keep your name under 120 characters.';
    if (form.company.length > 160) errors.company = 'Please keep the company name under 160 characters.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);

    try {
      await submitLead({
        type: form.subject,
        name: form.name,
        email: form.email,
        company: form.company,
        message: form.message,
        source: 'contact',
      });
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We couldn’t send your message right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const mailtoHref = `mailto:hello@developer312.com?subject=${encodeURIComponent(form.subject || 'Contact request')}&body=${encodeURIComponent(form.message)}`;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Contact Us</h1>
        <p className="text-sm text-surface-500 mt-1 max-w-xl">
          Have a question about Eco-Auditor, need help with your account, or want to discuss how we can support your carbon accounting workflow? We typically respond within 1–2 business days.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Email</h3>
            <a href="mailto:hello@developer312.com" className="text-sm text-accent-text hover:underline">hello@developer312.com</a>
            <p className="text-2xs text-surface-500 mt-0.5">For all inquiries</p>
          </div>
        </div>
        <div className="card flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Phone</h3>
            <a href="tel:+15105910163" className="text-sm text-accent-text hover:underline">(510) 591-0163</a>
            <p className="text-2xs text-surface-500 mt-0.5">Mon–Fri, 9am–5pm PT</p>
          </div>
        </div>
        <div className="card flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 7.5h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Company</h3>
            <p className="text-sm text-surface-600 dark:text-surface-400">Night Lite USA LLC</p>
            <p className="text-sm text-surface-600 dark:text-surface-400">Eco-Auditor (Developer312, a brand / dba)</p>
            <p className="text-sm text-surface-600 dark:text-surface-400">25200 Carlos Bee Blvd, Hayward, CA 94542</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <div className="card">
            <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-4">Send us a message</h2>
            {submitted ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Message sent</h3>
                <p className="text-xs text-surface-500 mt-1">We typically respond within 1–2 business days.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {Object.keys(fieldErrors).length > 0 && (
                  <div role="alert" aria-live="polite" className="rounded-lg border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-sm text-risk-high" tabIndex={-1}>
                    <p className="font-semibold mb-1">Please fix the following:</p>
                    <ul className="list-disc pl-5 text-xs">
                      {Object.entries(fieldErrors).map(([field, msg]) => (
                        <li key={field}><a href={`#contact-${field}`} className="underline">{msg}</a></li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="contact-name" className="block text-xs text-surface-500 mb-1">Full name *</label>
                    <input
                      id="contact-name"
                      className="input"
                      maxLength={120}
                      placeholder="Jane Smith"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      aria-invalid={!!fieldErrors.name}
                      aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
                    />
                    {fieldErrors.name && <p id="contact-name-error" className="text-xs text-risk-high mt-1">{fieldErrors.name}</p>}
                  </div>
                  <div>
                    <label htmlFor="contact-company" className="block text-xs text-surface-500 mb-1">Company</label>
                    <input
                      id="contact-company"
                      className="input"
                      maxLength={160}
                      placeholder="Acme Corp"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-email" className="block text-xs text-surface-500 mb-1">Email *</label>
                  <input
                    id="contact-email"
                    type="email"
                    className="input"
                    placeholder="jane@acme.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
                  />
                  {fieldErrors.email && <p id="contact-email-error" className="text-xs text-risk-high mt-1">{fieldErrors.email}</p>}
                </div>
                <div>
                  <label htmlFor="contact-subject" className="block text-xs text-surface-500 mb-1">Subject *</label>
                  <select
                    id="contact-subject"
                    className="input"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    aria-invalid={!!fieldErrors.subject}
                    aria-describedby={fieldErrors.subject ? 'contact-subject-error' : undefined}
                  >
                    <option value="">Select a topic</option>
                    <option value="sales">Sales inquiry</option>
                    <option value="billing">Billing support</option>
                    <option value="product">Product support</option>
                    <option value="legal">Legal / privacy request</option>
                    <option value="dpa">Request DPA / privacy documentation</option>
                    <option value="security">Security report / security materials request</option>
                    <option value="support">General support</option>
                    <option value="other">Other</option>
                  </select>
                  {fieldErrors.subject && <p id="contact-subject-error" className="text-xs text-risk-high mt-1">{fieldErrors.subject}</p>}
                </div>
                <div>
                  <label htmlFor="contact-message" className="block text-xs text-surface-500 mb-1">Message *</label>
                  <textarea
                    id="contact-message"
                    className="input"
                    rows={4}
                    maxLength={1000}
                    placeholder="How can we help?"
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    aria-invalid={!!fieldErrors.message}
                    aria-describedby={fieldErrors.message ? 'contact-message-error' : undefined}
                  />
                  {fieldErrors.message && <p id="contact-message-error" className="text-xs text-risk-high mt-1">{fieldErrors.message}</p>}
                </div>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Sending...' : 'Send message'}</button>
                {submitError && (
                  <p className="text-xs text-risk-high mt-2">
                    {submitError} You can still reach us — email{' '}
                    <a href={mailtoHref} className="text-accent-text hover:underline">hello@developer312.com</a>{' '}
                    and we&apos;ll get back to you within 1–2 business days.
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-3">How can we help?</h3>
            <div className="space-y-2">
              {[
                { label: 'Sales inquiries', desc: 'Pricing, demos, and plan selection', icon: '💼' },
                { label: 'Billing support', desc: 'Invoices, plan changes, cancellations', icon: '💳' },
                { label: 'Product support', desc: 'Technical issues, feature questions', icon: '🛠️' },
                { label: 'Legal / privacy requests', desc: 'DPA requests, privacy inquiries', icon: '📋' },
              ].map((cat) => (
                <div key={cat.label} className="flex items-start gap-3 p-2.5 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <span className="text-base" aria-hidden="true">{cat.icon}</span>
                  <div>
                    <div className="text-xs font-medium text-surface-800 dark:text-surface-200">{cat.label}</div>
                    <div className="text-2xs text-surface-500">{cat.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Request DPA</h3>
            <p className="text-xs text-surface-500 mb-3">EU-facing customers can request a Data Processing Addendum for GDPR compliance.</p>
            <button onClick={() => setForm({ ...form, subject: 'dpa' })} className="btn-secondary text-xs w-full">Request DPA / privacy documentation</button>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">Direct help</h3>
            <ul className="space-y-1.5 text-xs">
              <li><a href="mailto:hello@developer312.com" className="text-accent-text hover:underline">General help</a> <span className="text-surface-600 dark:text-surface-400">— hello@developer312.com</span></li>
              <li><a href="mailto:hello@developer312.com?subject=Security%20report" className="text-accent-text hover:underline">Security reports</a> <span className="text-surface-600 dark:text-surface-400">— routed to the security team</span></li>
              <li><a href="mailto:hello@developer312.com?subject=Privacy%20and%20DPA%20request" className="text-accent-text hover:underline">Privacy &amp; DPA requests</a> <span className="text-surface-600 dark:text-surface-400">— routed to the privacy team</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
