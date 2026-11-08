import { useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { EmptyState, ErrorBanner, LoadingView, Screen } from '@/components/ui';
import { RideCard } from '@/components/ride';
import { useApi } from '@/lib/hooks';
import type { Trip } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function StudentRides() {
  const router = useRouter();
  const { colors } = useTheme();
  const [scope, setScope] = useState<'active' | 'history'>('active');

  const { data, loading, error, refreshing, refresh, reload } = useApi<{ trips: Trip[] }>(
    `/api/mobile/trips?scope=${scope}`
  );

  const trips = data?.trips ?? [];

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          padding: 4,
        }}
      >
        {(['active', 'history'] as const).map((tab) => {
          const selected = scope === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => setScope(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={{
                flex: 1,
                paddingVertical: spacing.sm,
                borderRadius: radius.sm,
                alignItems: 'center',
                backgroundColor: selected ? colors.surface : 'transparent',
              }}
            >
              <Text
                style={{
                  ...typography.smallStrong,
                  color: selected ? colors.text : colors.textMuted,
                  textTransform: 'capitalize',
                }}
              >
                {tab === 'active' ? 'Active' : 'History'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView label="Loading rides…" /> : null}

      {!loading && trips.length === 0 ? (
        <EmptyState
          icon="car-outline"
          title={scope === 'active' ? 'No active rides' : 'No past rides yet'}
          message={
            scope === 'active'
              ? 'Book a ride and it will appear here until it is completed.'
              : 'Your completed and cancelled rides will be listed here.'
          }
          action={
            scope === 'active' ? (
              <Pressable onPress={() => router.push('/(student)/book')} accessibilityRole="button">
                <Text style={{ ...typography.bodyStrong, color: colors.primary }}>Book a ride</Text>
              </Pressable>
            ) : undefined
          }
        />
      ) : null}

      <View style={{ gap: spacing.md }}>
        {trips.map((trip) => (
          <RideCard
            key={trip.id}
            trip={trip}
            onPress={() => router.push(`/ride/${trip.id}`)}
          />
        ))}
      </View>
    </Screen>
  );
}
