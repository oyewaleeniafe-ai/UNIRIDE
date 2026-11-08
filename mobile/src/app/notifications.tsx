import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { EmptyState, ErrorBanner, LoadingView, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { relativeTime } from '@/lib/format';
import type { NotificationItem } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const { data, loading, error, refreshing, refresh, reload, setData } = useApi<{
    notifications: NotificationItem[];
  }>('/api/mobile/notifications');

  const items = data?.notifications ?? [];
  const unread = items.filter((item) => !item.isRead).length;

  const markAll = async () => {
    try {
      await api('/api/mobile/notifications', { method: 'POST', body: { id: 'all' } });
      setData({ notifications: items.map((item) => ({ ...item, isRead: true })) });
    } catch {
      // Leave state as-is; a retry tap will try again.
    }
  };

  const markOne = async (id: string) => {
    try {
      await api('/api/mobile/notifications', { method: 'POST', body: { id } });
      setData({
        notifications: items.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
      });
    } catch {
      // Non-critical.
    }
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Notifications',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />

      {formsRow(unread, markAll, colors.primary)}

      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView label="Loading notifications…" /> : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="Nothing yet"
          message="Ride updates and payment confirmations will appear here."
        />
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => markOne(item.id)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              padding: spacing.md,
              gap: 4,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {!item.isRead ? (
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: colors.primary,
                  }}
                />
              ) : null}
              <Text style={{ ...typography.bodyStrong, color: colors.text, flex: 1 }}>{item.title}</Text>
              <Text style={{ ...typography.small, color: colors.textFaint }}>
                {relativeTime(item.createdAt)}
              </Text>
            </View>
            <Text style={{ ...typography.small, color: colors.textMuted, lineHeight: 19 }}>
              {item.message}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

function formsRow(unread: number, markAll: () => void, color: string) {
  if (unread === 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, color }}>{unread} unread</Text>
      <Pressable onPress={markAll} accessibilityRole="button" hitSlop={8}>
        <Text style={{ fontSize: 13, fontWeight: '600', color }}>Mark all as read</Text>
      </Pressable>
    </View>
  );
}
