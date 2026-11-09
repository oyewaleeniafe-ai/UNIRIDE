'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // updateViaCache: 'none' — never serve sw.js itself from the HTTP cache,
    // otherwise a new caching strategy can take a day to reach installed apps.
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        // Pick up a new deployment as soon as the app is reopened.
        const checkForUpdate = () => registration.update().catch(() => {});
        window.addEventListener('online', checkForUpdate);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });

        const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);
        return () => window.clearInterval(interval);
      })
      .catch(() => {
        // Service workers need HTTPS (or localhost). Failing silently keeps the
        // app usable — it just runs online-only.
      });
  }, []);

  return null;
}
