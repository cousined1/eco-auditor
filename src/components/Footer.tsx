import { Link } from 'react-router-dom';
import { useConsent } from '../lib/consent-context';

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
              {/* TODO(audit): same mark as Header's EcoLogo (src/components/Header.tsx) — export it from a shared module so both stay in sync. */}
              <svg className="w-6 h-6" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect width="28" height="28" rx="7" fill="currentColor" className="text-brand-600" />
                <path d="M8 20V8l6 4 6-4v12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm font-semibold text-surface-900 dark:text-white">Eco-Auditor</span>
            </div>
            <p className="text-xs text-surface-500 leading-relaxed">Carbon accounting for companies that need reviewable emissions data, not enterprise software.</p>
          </div>

          {/* Product nav */}
          <nav aria-label="Product links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Product</h4>
            <ul className="space-y-1.5">
              <li><Link to="/" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Home</Link></li>
              <li><Link to="/pricing" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Pricing</Link></li>
              <li><Link to="/methodology" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Methodology</Link></li>
              <li><Link to="/sample-report" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Sample Report</Link></li>
            </ul>
          </nav>

          {/* Trust & Legal nav */}
          <nav aria-label="Trust and legal links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Trust</h4>
            <ul className="space-y-1.5">
              <li><Link to="/security" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Security & Trust</Link></li>
              <li><Link to="/privacy" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Terms of Service</Link></li>
              <li><Link to="/dpa" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Data Processing Addendum</Link></li>
            </ul>
          </nav>

          {/* Contact nav */}
          <nav aria-label="Contact links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Contact</h4>
            <ul className="space-y-1.5">
              <li><Link to="/contact" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Contact Us</Link></li>
              {/* P1-13: customer-facing Eco-Auditor-domain identities. These route
                  internally to the Developer312 team but present a coherent brand. */}
              <li><a href="mailto:support@ecoauditor.io" aria-label="Email support at support@ecoauditor.io" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">support@ecoauditor.io</a></li>
              <li><a href="mailto:security@ecoauditor.io" aria-label="Email the security team at security@ecoauditor.io" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">security@ecoauditor.io</a></li>
              <li><a href="mailto:privacy@ecoauditor.io" aria-label="Email the privacy team at privacy@ecoauditor.io" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">privacy@ecoauditor.io</a></li>
              <li><a href="tel:+15104011225" aria-label="Call us at (510) 401-1225" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">(510) 401-1225</a></li>
            </ul>
          </nav>
        </div>

        <div className="mt-6 pt-6 border-t border-surface-200 dark:border-surface-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-2xs text-surface-600 dark:text-surface-400">© {year} Eco-Auditor, a product operated by Developer312, a subsidiary of NIGHT LITE USA LLC. All rights reserved.</p>
          <button
            type="button"
            onClick={resetConsent}
            className="text-2xs text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200 transition-colors underline-offset-2 hover:underline"
          >
            Cookie preferences
          </button>
        </div>

        {/* Eco-Auditor Suite Interlinking */}
        <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-800">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-surface-500">
            <span className="font-medium text-surface-600 dark:text-surface-400">Eco-Auditor suite:</span>
            <a href="https://provenance-os.com" target="_blank" rel="noopener noreferrer" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">ProvenanceOS</a>
            <span className="text-surface-300">·</span>
            <a href="https://sim-2-real.com" target="_blank" rel="noopener noreferrer" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Sim2Real</a>
          </div>
        </div>
      </div>
    </footer>
  );
}