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
          500: '#6b7a70',
          600: '#4a5a4f',
          700: '#3a493f',
          800: '#1e2b23',
          900: '#141f18',
          950: '#0a120d',
        },
        accent: {
          DEFAULT: '#0d9488',
          light: '#2dd4bf',
          dark: '#0f766e',
        },
        risk: {
          low: '#16a34a',
          medium: '#d97706',
          high: '#dc2626',
          info: '#0284c7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
    },
  },
  plugins: [],
};