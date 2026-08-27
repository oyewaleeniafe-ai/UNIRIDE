'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered:', registration.scope);

          // Check for updates periodically
          setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000); // Every hour
        })
        .catch((err) => {
          console.warn('SW registration failed:', err);
        });
    }
  }, []);

  return null;
}
