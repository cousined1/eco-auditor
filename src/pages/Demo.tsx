import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { submitLead } from '../lib/leads';

const DEMO_GOALS = [
  { id: 'customer-rfp', label: 'Customer or RFP emissions-data request' },
  { id: 'scope-1-2-baseline', label: 'Scope 1 and 2 baseline' },
  { id: 'supplier-scope-3', label: 'Supplier / Scope 3 data collection' },
  { id: 'sb253-readiness', label: 'California SB 253 readiness' },
  { id: 'internal-tracking', label: 'Internal emissions tracking' },
  { id: 'consultant-workflow', label: 'Consultant / accounting workflow' },
] as const;

const AGENDA = [
  { time: '0:00', item: 'Your reporting objective and current workflow' },
  { time: '0:05', item: 'Live tour: CSV intake, factor application, data-quality scoring' },
  { time: '0:15', item: 'Sample report walkthrough and evidence index' },
  { time: '0:22', item: 'Plan fit, pricing, and next steps' },
  { time: '0:28', item: 'Your questions' },
];

export default function Demo() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    goal: '' as string,
    facilityCount: '',
    reportingDeadline: '',
    message: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    document.title = 'Book a Demo — Eco-Auditor | 30-Minute Carbon Accounting Walkthrough';
    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = 'Book a 25–30 minute Eco-Auditor demo. Tell us your goal — Scope 1/2 baseline, Scope 3 supplier collection, SB 253 readiness, or customer carbon-data requests.';
    return () => {
      document.title = 'Eco-Auditor — GHG Carbon Accounting for SMBs';
      if (desc) desc.content = 'Eco-Auditor gives small and mid-size businesses reviewable GHG emissions data. Import activity data by CSV, connect integrations (roadmap), and generate Scope 1-3 reports aligned with the GHG Protocol.';
    };
  }, []);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Your name is required.';
    if (!form.email.trim()) errors.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
    if (!form.company.trim()) errors.company = 'Company is required.';
    if (!form.goal) errors.goal = 'Select what you want to get out of the demo.';
    // The leads table caps message at 1000 chars, and `details` below prepends
    // goal/facilities/deadline to the message -- so the effective budget for
    // free text is smaller than the column. Cap at 800 to leave room, and
    // mirror the name/company caps too. Previously an over-long message hit
    // the DB CHECK and the raw constraint error was shown to the prospect.
    if (form.message.length > 800) errors.message = 'Please keep your notes under 800 characters.';
    if (form.name.length > 120) errors.name = 'Please keep your name under 120 characters.';
    if (form.company.length > 160) errors.company = 'Please keep the company name under 160 characters.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);
    const details = [
      form.goal ? `Goal: ${form.goal}` : '',
      form.facilityCount ? `Facilities: ${form.facilityCount}` : '',
      form.reportingDeadline ? `Deadline: ${form.reportingDeadline}` : '',
      form.message,
    ].filter(Boolean).join('\n').slice(0, 1000); // hard stop at the column limit

    try {
      await submitLead({
        type: 'demo',
        name: form.name,
        email: form.email,
        company: form.company,
        message: details,
        source: 'demo',
      });
      setSubmitted(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'We couldn’t send your request right now.';
      setSubmitError(`${message} You can also email hello@developer312.com.`);
    } finally {
      setSubmitting(false);
    }
  }

  const mailtoHref = `mailto:hello@developer312.com?subject=${encodeURIComponent('Eco-Auditor Demo Request')}&body=${encodeURIComponent(`${form.name}\n${form.email}\n${form.company}\nGoal: ${form.goal}\nFacilities: ${form.facilityCount}\nDeadline: ${form.reportingDeadline}\n\n${form.message}`)}`;

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Header variant="marketing" />
      <main id="main-content" tabIndex={-1}>

      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/60 via-surface-50 to-surface-50 dark:from-brand-950/30 dark:via-surface-950 dark:to-surface-950">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            25–30 minutes · No slides-for-slides-sake
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 dark:text-white leading-tight tracking-tight">
            Book a demo
          </h1>
          <p className="mt-6 text-lg text-surface-600 dark:text-surface-400 max-w-2xl mx-auto leading-relaxed">
            A focused walkthrough of Eco-Auditor against your reporting objective. Tell us what you need and we’ll show you the path — not a generic pitch.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm text-surface-500">
            <Link to="/sample-report" className="text-accent-text hover:underline">View the sample report first</Link>
            <span className="hidden sm:inline text-surface-300">·</span>
            <Link to="/methodology" className="text-accent-text hover:underline">Read the methodology</Link>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Agenda */}
          <div className="card">
            <h2 className="text-lg font-bold text-surface-900 dark:text-white mb-4">What we cover</h2>
            <ol className="space-y-3">
              {AGENDA.map((step) => (
                <li key={step.time} className="flex items-start gap-3">
                  <span className="text-xs font-mono text-brand-600 dark:text-brand-400 flex-shrink-0 w-10 pt-0.5">{step.time}</span>
                  <span className="text-sm text-surface-700 dark:text-surface-300">{step.item}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 pt-6 border-t border-surface-200 dark:border-surface-700">
              <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">What happens after you submit</h3>
              <p className="text-xs text-surface-500">We typically respond within one business day with a calendar link or a direct time proposal. You won’t be added to a marketing list.</p>
            </div>
          </div>

          {/* Form */}
          <div className="card">
            {submitted ? (
              <div className="text-center py-10">
                <div className="w-12 h-12 mx-auto rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Request received</h2>
                <p className="text-sm text-surface-500 mt-2 max-w-sm mx-auto">
                  Thanks{form.name ? `, ${form.name.split(' ')[0]}` : ''}. We’ll reply within one business day with a calendar link. Your reference context: <strong className="text-surface-700 dark:text-surface-300">{DEMO_GOALS.find((g) => g.id === form.goal)?.label ?? 'demo request'}</strong>.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
                  <Link to="/sample-report" className="btn-secondary text-sm">View sample report</Link>
                  <Link to="/signup" className="btn-primary text-sm">Start free trial instead</Link>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold text-surface-900 dark:text-white mb-1">Tell us about your goal</h2>
                <p className="text-xs text-surface-500 mb-5">All fields marked with * are required.</p>
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="demo-name" className="block text-xs text-surface-500 mb-1">Full name *</label>
                      <input
                        id="demo-name"
                        className="input"
                        placeholder="Jane Smith"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        aria-invalid={!!fieldErrors.name}
                        aria-describedby={fieldErrors.name ? 'demo-name-error' : undefined}
                      />
                      {fieldErrors.name && <p id="demo-name-error" className="text-xs text-risk-high mt-1">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="demo-email" className="block text-xs text-surface-500 mb-1">Work email *</label>
                      <input
                        id="demo-email"
                        type="email"
                        className="input"
                        placeholder="jane@acme.com"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        aria-invalid={!!fieldErrors.email}
                        aria-describedby={fieldErrors.email ? 'demo-email-error' : undefined}
                      />
                      {fieldErrors.email && <p id="demo-email-error" className="text-xs text-risk-high mt-1">{fieldErrors.email}</p>}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="demo-company" className="block text-xs text-surface-500 mb-1">Company *</label>
                    <input
                      id="demo-company"
                      className="input"
                      placeholder="Acme Corp"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      aria-invalid={!!fieldErrors.company}
                      aria-describedby={fieldErrors.company ? 'demo-company-error' : undefined}
                    />
                    {fieldErrors.company && <p id="demo-company-error" className="text-xs text-risk-high mt-1">{fieldErrors.company}</p>}
                  </div>
                  <fieldset>
                    <legend className="block text-xs text-surface-500 mb-2">What do you want out of the demo? *</legend>
                    <div className="space-y-2">
                      {DEMO_GOALS.map((g) => (
                        <label key={g.id} className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
                          <input
                            type="radio"
                            name="demo-goal"
                            value={g.id}
                            checked={form.goal === g.id}
                            onChange={() => setForm({ ...form, goal: g.id })}
                            className="mt-0.5"
                          />
                          {g.label}
                        </label>
                      ))}
                    </div>
                    {fieldErrors.goal && <p className="text-xs text-risk-high mt-1">{fieldErrors.goal}</p>}
                  </fieldset>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="demo-facilities" className="block text-xs text-surface-500 mb-1">Facility count (optional)</label>
                      <input
                        id="demo-facilities"
                        className="input"
                        placeholder="e.g. 3"
                        value={form.facilityCount}
                        onChange={(e) => setForm({ ...form, facilityCount: e.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor="demo-deadline" className="block text-xs text-surface-500 mb-1">Reporting deadline (optional)</label>
                      <input
                        id="demo-deadline"
                        className="input"
                        placeholder="e.g. Q4 2026"
                        value={form.reportingDeadline}
                        onChange={(e) => setForm({ ...form, reportingDeadline: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="demo-message" className="block text-xs text-surface-500 mb-1">Anything else? (optional)</label>
                    <textarea
                      id="demo-message"
                      className="input"
                      rows={3}
                      maxLength={800}
                      placeholder="Current tools, blockers, specific frameworks…"
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn-primary w-full" disabled={submitting}>
                    {submitting ? 'Sending…' : 'Request demo'}
                  </button>
                  {submitError && (
                    <p className="text-xs text-risk-high">
                      {submitError} You can also email{' '}
                      <a href={mailtoHref} className="text-accent-text hover:underline">hello@developer312.com</a>.
                    </p>
                  )}
                  <p className="text-2xs text-surface-600 dark:text-surface-400 text-center">
                    By submitting, you agree to our <Link to="/terms" className="text-accent-text hover:underline">Terms</Link> and <Link to="/privacy" className="text-accent-text hover:underline">Privacy Policy</Link>.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </section>

      </main>
      <Footer />
    </div>
  );
}
