import { useState } from 'react';
import { insforge, isInsForgeConfigured } from '../lib/insforge';

export default function ContactUs() {
  const [form, setForm] = useState({ name: '', company: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    if (!isInsForgeConfigured) {
      setSubmitError('Form submission is not available — backend not configured.');
      setSubmitting(false);
      return;
    }

    try {
      await insforge.from('contact_submissions').insert([{ ...form, created_at: new Date().toISOString() }]);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to send message. Please try again or email us directly.');
    } finally {
      setSubmitting(false);
    }
  };

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
            <a href="mailto:hello@developer312.com" className="text-sm text-accent hover:underline">hello@developer312.com</a>
            <p className="text-2xs text-surface-500 mt-0.5">For all inquiries</p>
          </div>
        </div>
        <div className="card flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Phone</h3>
            <a href="tel:+15104011225" className="text-sm text-accent hover:underline">(510) 401-1225</a>
            <p className="text-2xs text-surface-500 mt-0.5">Mon–Fri, 9am–5pm PT</p>
          </div>
        </div>
        <div className="card flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 7.5h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Company</h3>
            <p className="text-sm text-surface-600 dark:text-surface-400">Developer312</p>
            <p className="text-2xs text-surface-500">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
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
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-surface-500 mb-1">Full name</label>
                    <input className="input" placeholder="Jane Smith" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="block text-xs text-surface-500 mb-1">Company</label>
                    <input className="input" placeholder="Acme Corp" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Email</label>
                  <input type="email" className="input" placeholder="jane@acme.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Subject</label>
                  <select className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required>
                    <option value="">Select a topic</option>
                    <option value="sales">Sales inquiry</option>
                    <option value="billing">Billing support</option>
                    <option value="product">Product support</option>
                    <option value="legal">Legal / privacy request</option>
                    <option value="dpa">Request DPA / privacy documentation</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-surface-500 mb-1">Message</label>
                  <textarea className="input" rows={4} placeholder="How can we help?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
                </div>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Sending...' : 'Send message'}</button>
                {submitError && <p className="text-xs text-risk-high mt-2">{submitError}</p>}
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
                  <span className="text-base">{cat.icon}</span>
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

          <div className="p-4 rounded-lg border border-surface-200 dark:border-surface-700">
            <p className="text-2xs text-surface-500">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
            <p className="text-2xs text-surface-400 mt-1">© {new Date().getFullYear()} Developer312. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
}