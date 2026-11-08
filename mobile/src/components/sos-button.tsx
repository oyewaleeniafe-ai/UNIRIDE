import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, api } from '@/lib/api';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

/**
 * Emergency alert.
 *
 * Sends the current coordinates when location permission is available; the
 * alert is still raised without them, because safety must never depend on a
 * permission prompt. The server records the alert and attaches the active ride.
 */
export function SosButton({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    let coords: { latitude?: number; longitude?: number } = {};
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === 'granted') {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      }
    } catch {
      // Location is best-effort.
    }

    try {
      await api('/api/mobile/sos', { method: 'POST', body: coords });
      Alert.alert(
        'Emergency alert sent',
        'Campus security has been notified with your ride details. Stay on this screen and call campus security if you are in immediate danger.'
      );
    } catch (error) {
      Alert.alert(
        'Alert not sent',
        error instanceof ApiError ? error.message : 'Could not reach CampusCab. Call campus security directly.'
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const fire = () => {
      if (Platform.OS === 'ios') {
        Alert.alert('Send SOS alert?', 'Campus security will be alerted with your ride and location.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send alert', style: 'destructive', onPress: send },
        ]);
      } else {
        Alert.alert('Send SOS alert?', 'Campus security will be alerted with your ride and location.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send alert', style: 'destructive', onPress: send },
        ]);
      }
    };
    fire();
  };

  return (
    <Pressable
      onPress={confirm}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Send emergency SOS alert"
      style={({ pressed }) => ({
        backgroundColor: colors.dangerSoft,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.danger,
        paddingVertical: compact ? spacing.sm : spacing.md,
        paddingHorizontal: spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        opacity: busy || pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="shield-half-outline" size={compact ? 16 : 20} color={colors.danger} />
      <View>
        <Text style={{ ...typography.bodyStrong, color: colors.danger }}>
          {busy ? 'Sending…' : 'SOS emergency'}
        </Text>
      </View>
    </Pressable>
  );
}
