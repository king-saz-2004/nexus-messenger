import type { AppLocale, ThemeMode, ToastMessage } from '../../types';

type ToastHostProps = {
  toasts: ToastMessage[];
  language: AppLocale;
  theme: ThemeMode;
};

export default function ToastHost({ toasts, language, theme }: ToastHostProps) {
  return (
    <div className={`pointer-events-none fixed ${language === 'fa' ? 'left-4' : 'right-4'} top-4 z-[200] flex w-full max-w-sm flex-col gap-2`}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          dir="auto"
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-lg text-start bidi-text ${toast.kind === 'error'
              ? theme === 'light'
                ? 'border-red-300 bg-red-100 text-red-800'
                : 'border-red-500/40 bg-red-500/20 text-red-100'
              : toast.kind === 'success'
                ? theme === 'light'
                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                  : 'border-emerald-500/40 bg-emerald-500/20 text-emerald-100'
                : 'border-tg-border bg-tg-bg-surface text-tg-text-primary'
            }`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
