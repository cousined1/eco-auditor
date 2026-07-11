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
              <svg width="24" height="24" viewBox="0 0 512 512" fill="none" aria-hidden="true">
                <path fill="none" stroke="#06b6d4" strokeWidth="24" strokeLinecap="round" d="M380 310 A150 150 0 0 0 132 310" />
                <polygon points="115,295 132,270 148,298" fill="#06b6d4" />
                <path fill="none" stroke="#1e3a5f" strokeWidth="24" strokeLinecap="round" d="M132 202 A150 150 0 0 0 380 202" />
                <polygon points="397,217 380,242 364,214" fill="#1e3a5f" />
                <path fill="#52b788" d="M256 120 C256 120 200 170 200 260 C200 310 225 350 256 380 C287 350 312 310 312 260 C312 170 256 120 256 120Z" />
                <path fill="#ffffff" d="M256 160 C256 160 225 200 225 260 C225 300 240 330 256 350 C272 330 287 300 287 260 C287 200 256 160 256 160Z" />
                <line x1="256" y1="155" x2="256" y2="365" stroke="#2d6a4f" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
                <circle cx="256" cy="430" r="28" fill="#1e3a5f" />
                <polyline points="242,430 252,440 270,420" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
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
              <li><Link to="/contact" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Contact Us</Link></li>
            </ul>
          </nav>

          {/* Company nav */}
          <nav aria-label="Company links">
            <h4 className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-3">Company</h4>
            <ul className="space-y-1.5">
              <li><Link to="/contact" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">Contact Us</Link></li>
              <li><a href="mailto:hello@developer312.com" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">hello@developer312.com</a></li>
              <li><a href="tel:+15104011225" className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">(510) 401-1225</a></li>
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

        {/* Developer312 Suite Interlinking */}
        <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-800">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-surface-500">
            <span className="font-medium text-surface-600 dark:text-surface-400">Developer312 suite:</span>
            <a href="https://provenance-os.com" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">ProvenanceOS</a>
            <span className="text-surface-300">·</span>
            <a href="https://sim-2-real.com" className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">Sim2Real</a>
          </div>
        </div>
      </div>
    </footer>
  );
}