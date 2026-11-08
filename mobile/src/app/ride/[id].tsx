import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, ErrorBanner, Row, Screen, SectionTitle } from '@/components/ui';
import { RouteLine, StatusTimeline } from '@/components/ride';
import { SosButton } from '@/components/sos-button';
import { API_BASE_URL, ApiError, api } from '@/lib/api';
import { useApi, poll } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { naira, rideTypeLabel, statusLabel } from '@/lib/format';
import type { Trip } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

export default function RideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const { colors } = useTheme();
  const isDriver = me?.user.role === 'DRIVER';

  const { data, loading, error, refresh, reload } = useApi<{ trip: Trip }>(
    id ? `/api/mobile/trips/${id}` : null
  );
  const trip = data?.trip;

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [score, setScore] = useState(5);
  const [feedback, setFeedback] = useState('');

  const act = async (action: string, extra?: Record<string, unknown>) => {
    if (!trip) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api<{ trip?: Trip; success?: boolean }>(`/api/mobile/trips/${trip.id}`, {
        method: 'POST',
        body: { action, ...extra },
      });
      if (result.trip) await refresh();
      else await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const payNow = async () => {
    if (!trip) return;
    setBusy(true);
    setActionError(null);
    try {
      const checkout = await api<{ checkoutUrl: string; reference: string }>('/api/mobile/payments', {
        method: 'POST',
        body: { action: 'init', tripId: trip.id },
      });
      const url = checkout.checkoutUrl.startsWith('http')
        ? checkout.checkoutUrl
        : `${API_BASE_URL}${checkout.checkoutUrl}`;
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
      const result = await poll(
        () =>
          api<{ status: string }>('/api/mobile/payments', {
            method: 'POST',
            body: { action: 'verify', reference: checkout.reference },
          }),
        (value) => value.status !== 'pending'
      );
      await refresh();
      if (result?.status !== 'successful') {
        setActionError('Payment is not confirmed yet. If you were charged, pull down to refresh.');
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not open checkout.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = () => {
    Alert.alert('Cancel this ride?', 'Cancelling cannot be undone.', [
      { text: 'Keep ride', style: 'cancel' },
      { text: 'Cancel ride', style: 'destructive', onPress: () => act('cancel') },
    ]);
  };

  const submitRating = async () => {
    setRatingOpen(false);
    await act('rate', { score, feedback });
  };

  if (loading && !trip) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Ride' }} />
        <ErrorBanner message={error ?? 'This ride could not be found.'} onRetry={reload} />
      </Screen>
    );
  }

  const paid = trip.payment?.status === 'SUCCESSFUL';
  const canCancel =
    !isDriver && (trip.status === 'PENDING' || trip.status === 'ACCEPTED');
  const canPay = !isDriver && trip.status === 'PENDING' && !paid;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      <Stack.Screen options={{ title: rideTypeLabel(trip.rideType) }} />

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Badge label={statusLabel(trip.status)} tone={trip.status === 'COMPLETED' ? 'success' : 'primary'} />
          <Text style={{ ...typography.h3, color: colors.text }}>{naira(trip.totalFare)}</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          <RouteLine label={trip.pickup} icon="radio-button-on" />
          <RouteLine label={trip.dropoff} icon="location" />
        </View>
        <Row label="Passengers" value={String(trip.passengerCount)} />
        <Row
          label="Payment"
          value={paid ? 'Paid' : statusLabel(trip.payment?.status ?? 'PENDING')}
          strong={paid}
        />
      </Card>

      {actionError ? <ErrorBanner message={actionError} /> : null}

      <Card>
        <SectionTitle>Progress</SectionTitle>
        <View style={{ marginTop: spacing.md }}>
          <StatusTimeline status={trip.status} />
        </View>
      </Card>

      {trip.driver ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle>{isDriver ? 'Passenger' : 'Your driver'}</SectionTitle>
          <Text style={{ ...typography.h3, color: colors.text }}>{trip.driver.name}</Text>
          {trip.driver.vehicle ? (
            <Text style={{ ...typography.small, color: colors.textMuted }}>
              {trip.driver.vehicle} · {trip.driver.plate ?? '—'}
            </Text>
          ) : null}
          <Text style={{ ...typography.small, color: colors.textMuted }}>
            ★ {trip.driver.rating.toFixed(1)} · {trip.driver.trips} trips
          </Text>
        </Card>
      ) : null}

      {isDriver ? (
        <View style={{ gap: spacing.md }}>
          {trip.status === 'ACCEPTED' ? (
            <Button title="Start ride" onPress={() => act('start')} loading={busy} icon="play" />
          ) : null}
          {trip.status === 'IN_PROGRESS' ? (
            <Button
              title="Complete ride"
              onPress={() => act('complete')}
              loading={busy}
              icon="checkmark-circle-outline"
            />
          ) : null}
          {trip.status === 'ACCEPTED' || trip.status === 'IN_PROGRESS' ? (
            <Button title="Cancel ride" variant="danger" onPress={confirmCancel} disabled={busy} />
          ) : null}
          {trip.status === 'COMPLETED' ? (
            <Card style={{ backgroundColor: colors.surfaceAlt }}>
              <Row label="Your earnings for this ride" value={naira(trip.driverEarnings)} strong />
              <Text style={{ ...typography.small, color: colors.textMuted }}>
                Payouts settle from your earnings screen once your bank account is verified.
              </Text>
            </Card>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {canPay ? (
            <Button
              title={`Pay ${naira(trip.totalFare)} now`}
              onPress={payNow}
              loading={busy}
              icon="card-outline"
            />
          ) : null}
          {canCancel ? (
            <Button title="Cancel ride" variant="danger" onPress={confirmCancel} disabled={busy} />
          ) : null}
          {trip.status === 'COMPLETED' && trip.driver ? (
            <Button
              title="Rate your ride"
              variant="secondary"
              onPress={() => setRatingOpen(true)}
              icon="star-outline"
            />
          ) : null}
          <SosButton />
        </View>
      )}

      <Modal visible={ratingOpen} transparent animationType="fade" onRequestClose={() => setRatingOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.lg,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.md,
              width: '100%',
            }}
          >
            <Text style={{ ...typography.h2, color: colors.text }}>How was your ride?</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setScore(value)}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} star${value > 1 ? 's' : ''}`}
                >
                  <Ionicons
                    name={value <= score ? 'star' : 'star-outline'}
                    size={32}
                    color={colors.warning}
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={feedback}
              onChangeText={setFeedback}
              placeholder="Add a note (optional)"
              placeholderTextColor={colors.textFaint}
              multiline
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
                minHeight: 80,
                color: colors.text,
                textAlignVertical: 'top',
              }}
            />
            <Button title="Submit rating" onPress={submitRating} loading={busy} />
            <Button title="Not now" variant="ghost" onPress={() => setRatingOpen(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
