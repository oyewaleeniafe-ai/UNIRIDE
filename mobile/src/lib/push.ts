import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from '@/lib/api';

/**
 * Register this device for push notifications.
 *
 * Tokens are sent to the backend, which stores them against the signed-in user
 * and delivers ride updates through Expo's push service. Failures (emulator,
 * denied permission, no EAS project id) are non-fatal: the app still receives
 * in-app notifications from the API.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('rides', {
      name: 'Ride updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4338ca',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api('/api/mobile/push-token', {
      method: 'POST',
      body: { token: token.data, platform: Platform.OS },
    });
    return token.data;
  } catch {
    return null;
  }
}

export async function unregisterPushToken(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await api('/api/mobile/push-token', { method: 'DELETE', body: { token } });
  } catch {
    // Signing out must succeed even if the device is offline.
  }
}
