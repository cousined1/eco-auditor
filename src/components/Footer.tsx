import { Link } from 'react-router-dom';
import { useConsent } from '../lib/consent-context';
import { contactDetails } from '../content/trust-facts';
import BrandMark from './BrandMark';

export default function Footer() {
  const year = new Date().getFullYear();
  const { resetConsent } = useConsent();

  return (
    <footer aria-label="Site footer" className="border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BrandMark className="w-6 h-6" />
              <span className="text-sm font-semibold text-surface-900 dark:text-white">Eco-Auditor</span>
            </div>
            <p className="text-xs text-surface-500 leading-relaxed">Carbon accounting for companies that need reviewable emissions data, not enterprise software.</p>
          </div>

          {/* Product nav */}
          <nav aria-label="Product links">
            <h3 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Product</h3>
            <ul className="space-y-1.5">
              <li><Link to="/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Home</Link></li>
              <li><Link to="/pricing/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Pricing</Link></li>
              <li><Link to="/methodology/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Methodology</Link></li>
              <li><Link to="/blog/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Blog</Link></li>
              <li><Link to="/sample-report/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Sample Report</Link></li>
            </ul>
          </nav>

          {/* Trust & Legal nav */}
          <nav aria-label="Trust and legal links">
            <h3 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Trust</h3>
            <ul className="space-y-1.5">
              <li><Link to="/security/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Security & Trust</Link></li>
              <li><Link to="/privacy/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Terms of Service</Link></li>
              <li><Link to="/dpa/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Data Processing Addendum</Link></li>
            </ul>
          </nav>

          {/* Contact nav */}
          <nav aria-label="Contact links">
            <h3 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Contact</h3>
            <ul className="space-y-1.5">
              <li><Link to="/contact/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Contact Us</Link></li>
              <li><a href={`mailto:${contactDetails.email}`} aria-label={`Email Eco-Auditor support at ${contactDetails.email}`} className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">{contactDetails.email}</a></li>
              <li><a href={`mailto:${contactDetails.email}?subject=Security%20report`} aria-label="Report a security issue by email" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Report a security issue</a></li>
              <li><a href={`mailto:${contactDetails.email}?subject=Privacy%20and%20DPA%20request`} aria-label="Email a privacy or DPA request" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Privacy &amp; DPA requests</a></li>
              <li><a href={contactDetails.phoneHref} aria-label={`Call us at ${contactDetails.phone}`} className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">{contactDetails.phone}</a></li>
            </ul>
          </nav>
        </div>

        <div className="mt-6 pt-6 border-t border-surface-200 dark:border-surface-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-2xs text-surface-600 dark:text-surface-400">© {year} Eco-Auditor, a product operated by {contactDetails.operator}. All rights reserved.</p>
          <button
            type="button"
            onClick={resetConsent}
            className="text-2xs text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200 transition-colors underline-offset-2 hover:underline"
          >
            Cookie preferences
          </button>
        </div>

        {/* F-C-18: the "Eco-Auditor suite: ProvenanceOS, Sim2Real" row is gone. Nothing in this repo
            shows those two sites are part of Eco-Auditor (public/humans.txt lists them as a "suite"
            with no description), and a procurement reviewer reads unrelated "suite" links in a
            compliance vendor's footer as a red flag. OWNER DECISION: whether they return, described
            accurately, on an "About the operator" page; the domain spelling differs between this
            row's old link (sim-2-real.com) and public/humans.txt (sim2real.com). */}
      </div>
    </footer>
  );
}
