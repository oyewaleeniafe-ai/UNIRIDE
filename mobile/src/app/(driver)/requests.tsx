import { useState } from 'react';
import { Alert, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, EmptyState, ErrorBanner, LoadingView, Screen, SectionTitle } from '@/components/ui';
import { RouteLine } from '@/components/ride';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime, naira, rideTypeLabel } from '@/lib/format';
import type { Trip } from '@/lib/types';
import { spacing, typography, useTheme } from '@/lib/theme';

export default function DriverRequests() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, loading, error, refreshing, refresh, reload, setData } = useApi<{ rides: Trip[] }>(
    '/api/mobile/driver/requests'
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rides = data?.rides ?? [];

  const accept = async (trip: Trip) => {
    setBusyId(trip.id);
    setActionError(null);
    try {
      const result = await api<{ trip: Trip }>(`/api/mobile/trips/${trip.id}`, {
        method: 'POST',
        body: { action: 'accept' },
      });
      setData({ rides: rides.filter((item) => item.id !== trip.id) });
      router.push(`/ride/${result.trip.id}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not accept this ride.');
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const decline = (trip: Trip) => {
    setData({ rides: rides.filter((item) => item.id !== trip.id) });
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <Text style={{ ...typography.small, color: colors.textMuted }}>
        Only rides that have been paid for appear here.
      </Text>

      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {loading && !data ? <LoadingView label="Looking for paid rides…" /> : null}

      {!loading && rides.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title="No requests right now"
          message="New paid rides will appear here the moment a student books. Make sure you are online."
          action={
            <Button title="Refresh" variant="secondary" onPress={reload} icon="refresh" />
          }
        />
      ) : null}

      <View style={{ gap: spacing.md }}>
        {rides.map((trip) => (
          <Card key={trip.id} style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Badge label={rideTypeLabel(trip.rideType)} tone="primary" />
              <Text style={{ ...typography.bodyStrong, color: colors.text }}>{naira(trip.totalFare)}</Text>
            </View>

            <View style={{ gap: spacing.sm }}>
              <RouteLine label={trip.pickup} icon="radio-button-on" />
              <RouteLine label={trip.dropoff} icon="location" />
            </View>

            <SectionTitle>{trip.passengerCount === 1 ? '1 passenger' : `${trip.passengerCount} passengers`}</SectionTitle>
            <Text style={{ ...typography.small, color: colors.textFaint }}>
              Requested {dateTime(trip.createdAt)}
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                title="Accept"
                onPress={() => accept(trip)}
                loading={busyId === trip.id}
                disabled={busyId !== null}
                style={{ flex: 1 }}
              />
              <Button
                title="Decline"
                variant="secondary"
                onPress={() => decline(trip)}
                disabled={busyId !== null}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
