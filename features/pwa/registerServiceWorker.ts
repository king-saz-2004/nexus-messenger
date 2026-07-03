export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(error => {
      if (import.meta.env.DEV) {
        console.warn('Service worker registration failed:', error);
      }
    });
  });
}
