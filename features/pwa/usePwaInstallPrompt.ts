import { useCallback, useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const DISMISSED_STORAGE_KEY = 'nexus.pwaInstallPrompt.dismissedAt';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const isBrowser = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const isStandaloneDisplayMode = () => {
  if (!isBrowser()) return false;

  const nav = navigator as NavigatorWithStandalone;
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
};

const readDismissedAt = () => {
  if (!isBrowser()) return null;

  try {
    const value = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!value) return null;

    const dismissedAt = Number(value);
    return Number.isFinite(dismissedAt) ? dismissedAt : null;
  } catch {
    return null;
  }
};

const isDismissedRecently = () => {
  const dismissedAt = readDismissedAt();
  return dismissedAt !== null && Date.now() - dismissedAt < DISMISS_DURATION_MS;
};

const writeDismissedAt = () => {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, String(Date.now()));
  } catch {
    // localStorage can be unavailable in hardened/private browser modes.
  }
};

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() => isStandaloneDisplayMode());
  const [isDismissed, setIsDismissed] = useState(() => isDismissedRecently());

  useEffect(() => {
    if (!isBrowser()) return undefined;

    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => setIsStandalone(isStandaloneDisplayMode());
    const handleBeforeInstallPrompt = (nativeEvent: Event) => {
      nativeEvent.preventDefault();

      if (isStandaloneDisplayMode() || isDismissedRecently()) {
        setDeferredPrompt(null);
        setIsDismissed(isDismissedRecently());
        return;
      }

      setDeferredPrompt(nativeEvent as BeforeInstallPromptEvent);
      setIsDismissed(false);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    standaloneQuery.addEventListener('change', syncStandalone);
    syncStandalone();

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      standaloneQuery.removeEventListener('change', syncStandalone);
    };
  }, []);

  const dismiss = useCallback(() => {
    writeDismissedAt();
    setDeferredPrompt(null);
    setIsDismissed(true);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    const promptEvent = deferredPrompt;
    setDeferredPrompt(null);

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'dismissed') {
        dismiss();
      }
    } catch {
      dismiss();
    }
  }, [deferredPrompt, dismiss]);

  const canInstall = useMemo(
    () => Boolean(deferredPrompt) && !isStandalone && !isDismissed,
    [deferredPrompt, isDismissed, isStandalone]
  );

  return {
    canInstall,
    isStandalone,
    promptInstall,
    dismiss
  };
}
