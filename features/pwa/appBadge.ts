type NavigatorWithBadging = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

// TODO: For reliable launcher badges while the app is closed,
// implement Web Push notifications and unread-state handling in the service worker.
// The current App Badging API path is best-effort and browser-dependent.
export async function updateAppBadge(count: number, enabled: boolean): Promise<void> {
  if (typeof navigator === 'undefined') return;

  const nav = navigator as NavigatorWithBadging;

  try {
    if (!enabled || count <= 0) {
      if (typeof nav.clearAppBadge === 'function') {
        await nav.clearAppBadge();
      }
      return;
    }

    if (typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(count);
    }
  } catch {
    // Badge support is browser-dependent and should never interrupt app behavior.
  }
}
