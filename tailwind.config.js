/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf6',
          100: '#dcfce9',
          200: '#bbf7d4',
          300: '#86efad',
          400: '#4ade7f',
          500: '#16a34a',
          600: '#0d7a3a',
          700: '#0a5c2d',
          800: '#0c4a26',
          900: '#0a3d21',
          950: '#042113',
        },
        surface: {
          0: '#ffffff',
          50: '#f8faf9',
          100: '#f1f4f2',
          200: '#e8ece9',
          300: '#d1d8d3',
          400: '#9ca8a0',
          // Theme-aware: see the --surface-500 block in src/index.css. The old
          // fixed #6b7a70 failed WCAG AA in both themes at ~156 usage sites.
          500: 'var(--surface-500, #647368)',
          600: '#4a5a4f',
          700: '#3a493f',
          800: '#1e2b23',
          900: '#141f18',
          950: '#0a120d',
        },
        accent: {
          // Unchanged: this feeds bg-accent, ring-accent/40, border-accent and
          // the /NN opacity modifiers, which cannot take a var() colour —
          // Tailwind has no alpha channel to substitute into one, and the build
          // fails outright on `ring-accent/40`.
          DEFAULT: '#0d9488',
          light: '#2dd4bf',
          dark: '#0f766e',
          // Accent as TEXT, where the 4.5:1 minimum applies. #0d9488 measures
          // 3.74:1 on white; this resolves to the palette's own accent.dark in
          // light mode and stays #0d9488 in dark mode (4.53:1 on surface.900).
          // See --accent-text in src/index.css.
          text: 'var(--accent-text, #0f766e)',
        },
        risk: {
          low: '#16a34a',
          medium: '#d97706',
          high: '#dc2626',
          info: '#0284c7',
        },
      },
      fontFamily: {
        // 'Inter Fallback' is the metric-matched @font-face in src/index.css —
        // it keeps the pre-swap layout identical to the post-swap one.
        sans: ['Inter', 'Inter Fallback', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
    },
  },
  plugins: [],
};