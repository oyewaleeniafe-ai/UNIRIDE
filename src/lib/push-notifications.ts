'use client';

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Push notification manager for Capacitor mobile app.
 * On web, this is a no-op — notifications fall back to in-app only.
 */

interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Check if running on a native platform (Android/iOS).
 */
export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Request notification permissions.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const permission = await PushNotifications.requestPermissions();
    return permission.receive === 'granted';
  } catch {
    return false;
  }
}

/**
 * Register for push notifications and get the device token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!isNativePlatform()) return null;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Request permission
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return null;

    // Register with APNs/FCM
    await PushNotifications.register();

    // Get the token
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10000);

      PushNotifications.addListener('registration', (token) => {
        clearTimeout(timeout);
        console.log('[Push] Registration token:', token.value);
        resolve(token.value);
      });

      PushNotifications.addListener('registrationError', (error) => {
        clearTimeout(timeout);
        console.error('[Push] Registration error:', error);
        resolve(null);
      });
    });
  } catch (err) {
    console.error('[Push] Failed to register:', err);
    return null;
  }
}

/**
 * Listen for incoming push notifications.
 */
export function onPushNotificationReceived(
  handler: (notification: PushNotificationPayload) => void
): (() => void) | null {
  if (!isNativePlatform()) return null;

  let removeListener: (() => void) | null = null;

  import('@capacitor/push-notifications').then(({ PushNotifications }) => {
    const listener = PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        handler({
          title: notification.title || 'Campus Cab',
          body: notification.body || '',
          data: notification.data as Record<string, unknown> | undefined,
        });
      }
    );

    removeListener = () => {
      listener.then((l) => l.remove());
    };
  });

  return () => {
    removeListener?.();
  };
}

/**
 * Listen for notification tap (user opened the notification).
 */
export function onPushNotificationOpened(
  handler: (data: Record<string, unknown>) => void
): (() => void) | null {
  if (!isNativePlatform()) return null;

  let removeListener: (() => void) | null = null;

  import('@capacitor/push-notifications').then(({ PushNotifications }) => {
    const listener = PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => {
        handler(action.notification.data as Record<string, unknown> || {});
      }
    );

    removeListener = () => {
      listener.then((l) => l.remove());
    };
  });

  return () => {
    removeListener?.();
  };
}

/**
 * Show a local notification (for offline or immediate feedback).
 */
export async function showLocalNotification(payload: PushNotificationPayload): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    await LocalNotifications.requestPermissions();

    await LocalNotifications.schedule({
      notifications: [
        {
          title: payload.title,
          body: payload.body,
          id: Math.floor(Math.random() * 100000),
          extra: payload.data || {},
        },
      ],
    });
  } catch {
    // Fallback: use browser notification if available
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(payload.title, { body: payload.body });
    }
  }
}

/**
 * React hook for push notifications.
 * Automatically registers and listens for notifications.
 */
export function usePushNotifications(userId?: string) {
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    async function setup() {
      const token = await registerForPushNotifications();
      if (token) {
        tokenRef.current = token;

        // Store token on server
        try {
          await fetch('/api/push-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, userId }),
          });
        } catch {
          // Token storage failed — will retry on next app open
        }
      }
    }

    setup();
  }, [userId]);

  return { token: tokenRef.current };
}
