import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: rgb('--canvas'),
        surface: rgb('--surface'),
        'surface-2': rgb('--surface-2'),
        line: rgb('--line'),
        'line-soft': rgb('--line-soft'),
        fg: rgb('--fg'),
        'fg-muted': rgb('--fg-muted'),
        'fg-subtle': rgb('--fg-subtle'),
        brand: {
          DEFAULT: rgb('--brand'),
          hover: rgb('--brand-hover'),
          soft: rgb('--brand-soft'),
        },
        success: rgb('--success'),
        error: rgb('--error'),
        'error-soft': rgb('--error-soft'),
        warning: rgb('--warning'),
        pos: {
          noun: rgb('--pos-noun'),
          verb: rgb('--pos-verb'),
          adjective: rgb('--pos-adjective'),
          adverb: rgb('--pos-adverb'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { card: '12px', xl2: '14px' },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04)',
        raised: '0 4px 16px rgb(16 24 40 / 0.08)',
        pop: '0 12px 32px rgb(16 24 40 / 0.14)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-up': 'slide-up .22s ease-out',
      },
    },
  },
  plugins: [forms({ strategy: 'class' })],
} satisfies Config
