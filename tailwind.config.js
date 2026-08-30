/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b0b8c8',
          400: '#8590a8',
          500: '#67738e',
          600: '#525c75',
          700: '#434b60',
          800: '#3a4151',
          900: '#1f2433',
          950: '#131726',
        },
        brand: {
          50: '#eefbf3',
          100: '#d6f5e1',
          200: '#b0e9c7',
          300: '#7dd6a6',
          400: '#48bd80',
          500: '#22a163',
          600: '#15824f',
          700: '#116840',
          800: '#0f5234',
          900: '#0d432c',
          950: '#062718',
        },
        accent: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
      boxShadow: {
        soft: '0 2px 12px -2px rgba(19, 23, 38, 0.08), 0 1px 4px -1px rgba(19, 23, 38, 0.06)',
        card: '0 8px 30px -8px rgba(19, 23, 38, 0.12), 0 2px 8px -4px rgba(19, 23, 38, 0.06)',
        glow: '0 0 0 4px rgba(34, 161, 99, 0.12)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
