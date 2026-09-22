const CACHE_VERSION = 'v2';
const STATIC_CACHE = `campus-cab-static-${CACHE_VERSION}`;
const PAGE_CACHE = `campus-cab-pages-${CACHE_VERSION}`;
const KEEP_CACHES = [STATIC_CACHE, PAGE_CACHE];

// NOTE: Pages use NETWORK-FIRST (not cache-first). A cache-first shell is what
// caused stale deploys to keep showing after a new version went live:
// the old HTML was pinned in Cache Storage and never invalidated because
// cache names never changed between deployments. Version-bump CACHE_VERSION
// whenever the caching strategy itself changes.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Delete every cache from previous versions so existing users
// immediately drop the stale v1 shell.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => !KEEP_CACHES.includes(name))
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Non-GET requests always go to the network
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only — never intercept cross-origin (Paystack, fonts, etc.)
  if (url.origin !== self.location.origin) return;

  // API routes and Next.js internals: always network
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/')) return;

  // Navigations & pages: NETWORK-FIRST with cache fallback (offline only).
  // The network copy is always preferred, so a new deployment is visible
  // on the very first visit — no stale shell.
  if (request.mode === 'navigate' || url.pathname.startsWith('/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            if (request.mode === 'navigate') {
              return new Response(
                '<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>You are offline</h1><p>Please check your internet connection and try again.</p></div></body></html>',
                { status: 503, headers: { 'Content-Type': 'text/html' } }
              );
            }
            return new Response('Offline', { status: 503 });
          })
        )
    );
    return;
  }

  // Other same-origin static assets (.css/.js/.png/.svg/.ico):
  // stale-while-revalidate — instant response, updated in background
  if (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webp')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const clone = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
