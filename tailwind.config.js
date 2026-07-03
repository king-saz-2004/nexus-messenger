/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './shared/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: {
            page: 'var(--tg-bg-page)',
            sidebar: 'var(--tg-bg-sidebar)',
            chat: 'var(--tg-bg-chat-area)',
            'chat-area': 'var(--tg-bg-chat-area)',
            header: 'var(--tg-bg-header)',
            input: 'var(--tg-bg-input-area)',
            'input-area': 'var(--tg-bg-input-area)',
            field: 'var(--tg-bg-input-field)',
            'input-field': 'var(--tg-bg-input-field)',
            surface: 'var(--tg-bg-surface)',
            modal: 'var(--tg-bg-modal)'
          },
          bubble: {
            out: 'var(--tg-bubble-out)',
            in: 'var(--tg-bubble-in)',
            outHover: 'var(--tg-bubble-out-hover)',
            inHover: 'var(--tg-bubble-in-hover)',
            'out-hover': 'var(--tg-bubble-out-hover)',
            'in-hover': 'var(--tg-bubble-in-hover)'
          },
          text: {
            primary: 'var(--tg-text-primary)',
            secondary: 'var(--tg-text-secondary)',
            tertiary: 'var(--tg-text-tertiary)',
            link: 'var(--tg-text-link)',
            outTime: 'var(--tg-text-out-time)',
            inTime: 'var(--tg-text-in-time)',
            success: 'var(--tg-text-success)'
          },
          accent: {
            DEFAULT: 'var(--tg-accent)',
            hover: 'var(--tg-accent-hover)'
          },
          badge: {
            bg: 'var(--tg-badge-bg)',
            muted: 'var(--tg-badge-muted-bg)',
            text: 'var(--tg-badge-text)'
          },
          border: 'var(--tg-border)',
          hover: 'var(--tg-hover)',
          active: 'var(--tg-active)',
          selected: 'var(--tg-selected)'
        }
      }
    }
  },
  plugins: []
};
