const CACHE_NAME = 'nexus-pwa-v1';
const CACHE_PREFIX = 'nexus-pwa-';
const APP_SHELL_URL = '/';
const STATIC_PATH_PREFIXES = ['/assets/', '/brand/', '/icons/'];
const BYPASS_PATH_PREFIXES = ['/api', '/socket.io', '/uploads', '/media'];
const STATIC_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style']);

const isHttpRequest = (url) => url.protocol === 'http:' || url.protocol === 'https:';

const isBypassedPath = (pathname) => BYPASS_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix));

const isStaticAssetRequest = (request, url) => {
  if (STATIC_DESTINATIONS.has(request.destination)) return true;
  if (url.pathname === '/manifest.webmanifest') return true;
  return STATIC_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
};

const isCacheableResponse = (response) => {
  return response && response.ok && (response.type === 'basic' || response.type === 'default');
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.add(new Request(APP_SHELL_URL, { cache: 'reload' }));
    } catch {
      // Installability should not depend on the app shell pre-cache succeeding.
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(cacheName => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
        .map(cacheName => caches.delete(cacheName))
    );

    await self.clients.claim();
  })());
});

const handleNavigationRequest = async (request) => {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(APP_SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const cachedShell = await caches.match(APP_SHELL_URL);
    if (cachedShell) return cachedShell;
    throw new Error('Navigation request failed and no app shell is cached.');
  }
};

const handleStaticAssetRequest = async (request) => {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (request.headers.has('authorization')) return;
  if (request.headers.has('range')) return;

  const url = new URL(request.url);
  if (!isHttpRequest(url)) return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/service-worker.js') return;
  if (isBypassedPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});
