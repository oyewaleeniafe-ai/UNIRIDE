'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePushNotifications, isNativePlatform } from '@/lib/push-notifications';

export default function PushNotificationProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id;

  // Initialize push notifications
  usePushNotifications(userId);

  useEffect(() => {
    if (!isNativePlatform()) return;

    // Listen for incoming notifications when app is in foreground
    let cleanup: (() => void) | null = null;

    import('@/lib/push-notifications').then(({ onPushNotificationReceived }) => {
      cleanup = onPushNotificationReceived((notification) => {
        console.log('[Push] Received:', notification.title, notification.body);
        // Could show an in-app toast here
      });
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return <>{children}</>;
}
