import { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, ErrorBanner, LoadingView, Row, Screen, SectionTitle } from '@/components/ui';
import { RideCard } from '@/components/ride';
import { ApiError, api } from '@/lib/api';
import { useApi, useOnline } from '@/lib/hooks';
import { kobo, shortDate } from '@/lib/format';
import type { DriverSummary } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function DriverDashboard() {
  const router = useRouter();
  const { colors } = useTheme();
  const online = useOnline();

  const { data, loading, error, refreshing, refresh, reload, setData } =
    useApi<DriverSummary>('/api/mobile/driver');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleOnline = async (next: boolean) => {
    if (!data) return;
    if (next && !data.canGoOnline) {
      Alert.alert(
        'Inspection required',
        'Complete the vehicle inspection before going online. It only takes a minute.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Start inspection', onPress: () => router.push('/(driver)/inspection') },
        ]
      );
      return;
    }

    setBusy(true);
    setActionError(null);
    // Optimistic switch, reconciled from the response below.
    setData({ ...data, driver: { ...data.driver, isOnline: next } });
    try {
      const result = await api<{ isOnline: boolean }>('/api/mobile/driver', {
        method: 'POST',
        body: { action: 'online', online: next },
      });
      setData({ ...data, driver: { ...data.driver, isOnline: result.isOnline } });
      await refresh();
    } catch (err) {
      setData(data);
      setActionError(err instanceof ApiError ? err.message : 'Could not change your availability.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <LoadingView label="Loading your dashboard…" />
      </View>
    );
  }

  if (!data) {
    return (
      <Screen>
        <ErrorBanner message={error ?? 'Dashboard unavailable.'} onRetry={reload} />
      </Screen>
    );
  }

  const inspectionOk = data.canGoOnline;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      {error ? <ErrorBanner message={error} onRetry={reload} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.h3, color: colors.text }}>
              {data.driver.isOnline ? 'You are online' : 'You are offline'}
            </Text>
            <Text style={{ ...typography.small, color: colors.textMuted }}>
              {data.driver.isOnline
                ? 'Paid ride requests can reach you now.'
                : 'Go online to start receiving paid rides.'}
            </Text>
          </View>
          <Switch
            value={data.driver.isOnline}
            onValueChange={toggleOnline}
            disabled={busy || !online}
            trackColor={{ false: colors.border, true: colors.primary }}
            accessibilityLabel="Availability"
          />
        </View>

        {!inspectionOk ? (
          <View
            style={{
              backgroundColor: colors.warningSoft,
              borderRadius: radius.md,
              padding: spacing.md,
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
              <Text style={{ ...typography.smallStrong, color: colors.warning }}>
                Vehicle inspection required
              </Text>
            </View>
            <Text style={{ ...typography.small, color: colors.warning }}>
              The backend will not let you go online until every checklist item passes.
            </Text>
            <Button
              title="Start inspection"
              size="sm"
              variant="secondary"
              onPress={() => router.push('/(driver)/inspection')}
            />
          </View>
        ) : null}
      </Card>

      {data.activeTrip ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>Current ride</SectionTitle>
          <RideCard trip={data.activeTrip} onPress={() => router.push(`/ride/${data.activeTrip!.id}`)} />
          <Button
            title="Manage ride"
            onPress={() => router.push(`/ride/${data.activeTrip!.id}`)}
            icon="navigate-outline"
          />
        </View>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <SectionTitle>Today</SectionTitle>
        <Card>
          <Row label="Available requests" value={String(data.availableRequests)} strong />
          <Row label="Unpaid earnings" value={`${kobo(data.earnings.unpaidKobo)} (${data.earnings.unpaidCount})`} />
          <Row label="Lifetime earnings" value={kobo(data.earnings.lifetimeKobo)} />
          <Row label="Rating" value={`★ ${data.driver.rating.toFixed(1)}`} />
          <Row label="Completed trips" value={String(data.driver.totalTrips)} />
        </Card>
        <Button
          title={data.availableRequests > 0 ? `View ${data.availableRequests} ride request(s)` : 'View ride requests'}
          variant="secondary"
          onPress={() => router.push('/(driver)/requests')}
          icon="mail-unread-outline"
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionTitle>Vehicle</SectionTitle>
        <Card>
          {data.driver.vehicle ? (
            <>
              <Row
                label="Vehicle"
                value={`${data.driver.vehicle.color} ${data.driver.vehicle.make} ${data.driver.vehicle.model}`}
              />
              <Row label="Plate" value={data.driver.vehicle.plate} />
            </>
          ) : (
            <Text style={{ ...typography.small, color: colors.textMuted }}>No vehicle on file.</Text>
          )}
          <Row label="Driver ID" value={data.driver.driverCode} />
          <Row
            label="Last inspection"
            value={
              data.inspection
                ? `${data.inspection.status === 'COMPLETED' ? 'Passed' : 'Incomplete'} · ${shortDate(
                    data.inspection.createdAt
                  )}`
                : 'Not completed'
            }
          />
        </Card>
        <Button
          title="Vehicle inspection checklist"
          variant="secondary"
          onPress={() => router.push('/(driver)/inspection')}
          icon="checkbox-outline"
        />
      </View>

      <View style={{ height: StyleSheet.hairlineWidth }} />
    </Screen>
  );
}
