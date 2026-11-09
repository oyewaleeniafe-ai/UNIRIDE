/* CampusCab service worker — offline fallback + safe caching.
 *
 * Rules that must never regress (payments and private data depend on them):
 *   - /api/* is never intercepted or cached. Payments, auth, rides and
 *     verification are always live requests.
 *   - Authenticated pages (/student, /driver, /admin) are never cached.
 *   - Responses marked Cache-Control: private or no-store are never cached.
 *   - While online, every page/form/payment goes to the network first, so a
 *     new deployment is visible immediately and no stale shell is served.
 *   - Offline, the user gets /offline.html — never a cached booking or
 *     payment confirmation.
 * Bump CACHE_VERSION whenever the caching strategy changes.
 */

const CACHE_VERSION = 'v3';
const STATIC_CACHE = `campuscab-static-${CACHE_VERSION}`;
const PAGE_CACHE = `campuscab-public-pages-${CACHE_VERSION}`;
const KEEP_CACHES = [STATIC_CACHE, PAGE_CACHE];

const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

// Never cached: pages that render private, per-user data.
const PRIVATE_PREFIXES = ['/student', '/driver', '/admin'];

const STATIC_EXTENSIONS = [
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
];

function isCacheablePath(pathname) {
  return !PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  // Only same-origin, complete (non-opaque) responses.
  if (response.type !== 'basic') return false;
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
    return false;
  }
  return true;
}

self.addEventListener('install', (event) => {
  // Cache each precache URL independently so one 404 cannot fail the install.
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) => cache.add(url).catch(() => null))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => !KEEP_CACHES.includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirstPage(request, pathname) {
  try {
    const response = await fetch(request);
    if (isCacheablePath(pathname) && isCacheableResponse(response)) {
      const copy = response.clone();
      caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        const copy = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => cached);

  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that is not a plain GET always goes to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only: payment provider assets, fonts, etc. are untouched.
  if (url.origin !== self.location.origin) return;

  // Never touch API traffic (auth, payments, bookings, verification).
  if (url.pathname.startsWith('/api/')) return;

  // Next.js build output is content-hashed and immutable; leave it to the browser.
  if (url.pathname.startsWith('/_next/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request, url.pathname));
    return;
  }

  if (STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/* ---- Web push (used only when the backend is configured with VAPID keys) ---- */

self.addEventListener('push', (event) => {
  let payload = { title: 'CampusCab', body: 'You have a new update.', url: '/' };

  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'CampusCab', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      data: { url: payload.url || '/', ...(payload.data || {}) },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let target = '/';
  try {
    target = new URL(
      (event.notification.data && event.notification.data.url) || '/',
      self.location.origin
    ).href;
  } catch {
    target = self.location.origin + '/';
  }

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }

      await self.clients.openWindow(target);
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
