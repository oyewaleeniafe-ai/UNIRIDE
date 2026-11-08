import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOnline } from '@/lib/hooks';
import { spacing, typography, useTheme } from '@/lib/theme';

/** Persistent, non-blocking notice when the device has no connectivity. */
export function OfflineBanner() {
  const online = useOnline();
  const { colors } = useTheme();

  if (online) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.warningSoft,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
      <Text style={{ ...typography.small, color: colors.warning, flex: 1 }}>
        You are offline. Ride updates will resume when you reconnect.
      </Text>
    </View>
  );
}
