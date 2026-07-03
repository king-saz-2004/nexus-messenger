import { useI18n } from '../../hooks/useI18n';
import { usePwaInstallPrompt } from './usePwaInstallPrompt';

export default function PwaInstallPrompt() {
  const { t } = useI18n();
  const { canInstall, isStandalone, promptInstall, dismiss } = usePwaInstallPrompt();

  if (!canInstall || isStandalone) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-40 mx-auto max-w-sm sm:bottom-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-tg-border bg-tg-bg-surface p-3 text-tg-text-primary shadow-2xl">
        <img
          src="/brand/logo/nexus-messenger-logo.png"
          alt=""
          className="h-12 w-12 shrink-0 rounded-lg object-contain"
          draggable={false}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('Install Nexus')}</p>
          <p className="mt-0.5 text-xs leading-5 text-tg-text-secondary">
            {t('Add Nexus to your home screen for faster access.')}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="focus-ring rounded-md bg-tg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-tg-accent-hover"
            >
              {t('Install')}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="focus-ring rounded-md px-3 py-1.5 text-xs font-semibold text-tg-text-secondary hover:bg-tg-hover hover:text-tg-text-primary"
            >
              {t('Later')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
