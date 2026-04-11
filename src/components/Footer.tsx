import { Link } from 'react-router-dom';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer aria-label="Site footer" className="border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-brand-600 dark:text-brand-400" />
                <path d="M16 8V24M11 13C13 10 19 10 21 13M11 19C13 16 19 16 21 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-brand-500 dark:text-brand-300" fill="none" />
                <circle cx="16" cy="16" r="3.5" className="fill-accent dark:fill-accent-light" />
              </svg>
              <span className="text-sm font-semibold text-surface-900 dark:text-white">Eco-Auditor</span>
            </div>
            <p className="text-xs text-surface-500 leading-relaxed">Carbon accounting for companies that need audit-ready emissions data, not enterprise software.</p>
          </div>

          {/* Product nav */}
          <nav aria-label="Product links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Product</h4>
            <ul className="space-y-1.5">
              <li><Link to="/app" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Dashboard</Link></li>
              <li><Link to="/app/pricing" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Pricing</Link></li>
              <li><Link to="/app/intake" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Data Intake</Link></li>
              <li><Link to="/app/reports" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Reports</Link></li>
            </ul>
          </nav>

          {/* Legal nav */}
          <nav aria-label="Legal links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Legal</h4>
            <ul className="space-y-1.5">
              <li><Link to="/privacy" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Terms of Service</Link></li>
              <li><Link to="/dpa" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Data Processing Addendum</Link></li>
              <li><Link to="/privacy#privacy-request" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Privacy Requests</Link></li>
            </ul>
          </nav>

          {/* Contact nav */}
          <nav aria-label="Contact links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Contact</h4>
            <ul className="space-y-1.5">
              <li><Link to="/contact" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Contact Us</Link></li>
              <li><a href="mailto:hello@developer312.com" aria-label="Email us at hello@developer312.com" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">hello@developer312.com</a></li>
              <li><a href="tel:+15104011225" aria-label="Call us at (510) 401-1225" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">(510) 401-1225</a></li>
            </ul>
          </nav>
        </div>

        <div className="mt-6 pt-6 border-t border-surface-200 dark:border-surface-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-2xs text-surface-400">© {year} Developer312. All rights reserved.</p>
          <p className="text-2xs text-surface-400">Developer312 is a subsidiary of NIGHT LITE USA LLC.</p>
        </div>
      </div>
    </footer>
  );
}