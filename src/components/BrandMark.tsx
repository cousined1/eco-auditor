interface BrandMarkProps {
  /** Tailwind size classes; the mark is square. */
  className?: string;
  /**
   * Accessible name. Leave unset when the mark sits next to the "Eco-Auditor"
   * wordmark, where it is decorative and a screen reader would only repeat the
   * brand name; set it when the mark stands alone.
   */
  label?: string;
}

/**
 * The one Eco-Auditor logo. Header, Footer, the app shell, the auth pages and
 * the chat widget each used to carry their own inline SVG, and two different
 * marks had drifted apart: this green tile on the marketing pages, and a
 * cycle-and-leaf drawing (navy arcs on a transparent background) everywhere
 * else, which is unreadable at 28 px and vanishes on the dark theme. Render this
 * component instead of drawing a logo inline.
 */
export default function BrandMark({ className = 'w-7 h-7', label }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="28" height="28" rx="7" fill="currentColor" className="text-brand-600" />
      <path d="M8 20V8l6 4 6-4v12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
