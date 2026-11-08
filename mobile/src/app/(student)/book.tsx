import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, ErrorBanner, Row, Screen, SectionTitle, Stepper } from '@/components/ui';
import { RouteLine } from '@/components/ride';
import { ApiError, API_BASE_URL, api } from '@/lib/api';
import { useApi, useOnline, poll } from '@/lib/hooks';
import { naira } from '@/lib/format';
import type { CampusLocation, LocationsResponse, RideType, Trip } from '@/lib/types';
import { radius, spacing, typography, useTheme } from '@/lib/theme';

type Step = 'pickup' | 'dropoff' | 'type' | 'review';
const ORDER: Step[] = ['pickup', 'dropoff', 'type', 'review'];

export default function BookRideScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const online = useOnline();
  const { data, loading, error, reload } = useApi<LocationsResponse>('/api/mobile/locations');

  const [step, setStep] = useState<Step>('pickup');
  const [pickup, setPickup] = useState<CampusLocation | null>(null);
  const [dropoff, setDropoff] = useState<CampusLocation | null>(null);
  const [query, setQuery] = useState('');
  const [rideType, setRideType] = useState<RideType>('SHARED_SHUTTLE');
  const [passengers, setPassengers] = useState(1);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const stepIndex = ORDER.indexOf(step);

  // Android back returns to the previous booking step before leaving the screen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stepIndex > 0) {
        setStep(ORDER[stepIndex - 1]);
        setFormError(null);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [stepIndex]);

  const locations = useMemo(() => {
    const all = data?.locations ?? [];
    const term = query.trim().toLowerCase();
    const filtered = term ? all.filter((item) => item.name.toLowerCase().includes(term)) : all;
    if (step === 'dropoff' && pickup) return filtered.filter((item) => item.id !== pickup.id);
    return filtered;
  }, [data?.locations, query, step, pickup]);

  const fare = data?.fares[rideType];

  const choose = (location: CampusLocation) => {
    if (step === 'pickup') {
      setPickup(location);
      if (dropoff?.id === location.id) setDropoff(null);
      setStep('dropoff');
    } else {
      setDropoff(location);
      setStep('type');
    }
    setQuery('');
    setFormError(null);
  };

  const pay = async () => {
    if (!pickup || !dropoff || !fare) return;
    if (!online) {
      setFormError('You are offline. Reconnect to book and pay for a ride.');
      return;
    }

    setBusy(true);
    setFormError(null);
    let tripId: string | null = null;

    try {
      const created = await api<{ trip: Trip }>('/api/mobile/trips', {
        method: 'POST',
        body: {
          pickupLocationId: pickup.id,
          dropoffLocationId: dropoff.id,
          passengerCount: passengers,
          rideType,
        },
      });
      tripId = created.trip.id;

      const checkout = await api<{ checkoutUrl: string; reference: string }>('/api/mobile/payments', {
        method: 'POST',
        body: { action: 'init', tripId },
      });

      const url = checkout.checkoutUrl.startsWith('http')
        ? checkout.checkoutUrl
        : `${API_BASE_URL}${checkout.checkoutUrl}`;

      await WebBrowser.openBrowserAsync(url, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });

      // The browser is back; ask the server to verify with Flutterwave.
      const result = await poll(
        () =>
          api<{ status: string; tripId?: string }>('/api/mobile/payments', {
            method: 'POST',
            body: { action: 'verify', reference: checkout.reference },
          }),
        (value) => value.status !== 'pending'
      );

      if (result?.status === 'successful') {
        router.replace(`/ride/${tripId}`);
        return;
      }

      // Not confirmed yet (webhook may still land) — the ride screen shows the
      // pending payment and lets the student retry verification.
      router.replace(`/ride/${tripId}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not start checkout. Please try again.');
      if (tripId) {
        Alert.alert(
          'Payment not completed',
          'Your ride is saved as unpaid and no driver can accept it. Open the ride to try again.',
          [{ text: 'Open ride', onPress: () => router.replace(`/ride/${tripId}`) }]
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <Screen scroll={false}>
        <ErrorBanner message={error} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {ORDER.map((item, index) => (
          <View
            key={item}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: index <= stepIndex ? colors.primary : colors.border,
            }}
          />
        ))}
      </View>

      {pickup || dropoff ? (
        <Card style={{ gap: spacing.sm }}>
          {pickup ? <RouteLine label={pickup.name} icon="radio-button-on" /> : null}
          {dropoff ? <RouteLine label={dropoff.name} icon="location" /> : null}
        </Card>
      ) : null}

      {formError ? <ErrorBanner message={formError} /> : null}

      {step === 'pickup' || step === 'dropoff' ? (
        <View style={{ gap: spacing.md }}>
          <SectionTitle>{step === 'pickup' ? 'Where are you now?' : 'Where are you going?'}</SectionTitle>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              paddingHorizontal: spacing.md,
            }}
          >
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search campus locations"
              placeholderTextColor={colors.textFaint}
              style={{ flex: 1, paddingVertical: 12, color: colors.text, fontSize: 15 }}
              autoCorrect={false}
              accessibilityLabel="Search campus locations"
            />
          </View>

          <Card style={{ padding: 0 }}>
            {locations.length === 0 ? (
              <Text style={{ ...typography.small, color: colors.textMuted, padding: spacing.lg }}>
                No locations match “{query}”.
              </Text>
            ) : (
              locations.map((location, index) => (
                <Pressable
                  key={location.id}
                  onPress={() => choose(location)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                  })}
                >
                  <Ionicons name="location-outline" size={18} color={colors.primary} />
                  <Text style={{ ...typography.body, color: colors.text, flex: 1 }}>{location.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </Pressable>
              ))
            )}
          </Card>

          {step === 'dropoff' ? (
            <Button title="Change pickup" variant="ghost" onPress={() => setStep('pickup')} />
          ) : null}
        </View>
      ) : null}

      {step === 'type' && data ? (
        <View style={{ gap: spacing.md }}>
          <SectionTitle>Choose your ride</SectionTitle>
          {(['SHARED_SHUTTLE', 'SOLO_QUICK_CAB'] as RideType[]).map((type) => {
            const selected = rideType === type;
            const price = data.fares[type];
            return (
              <Pressable
                key={type}
                onPress={() => setRideType(type)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  borderRadius: radius.lg,
                  borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: colors.surface,
                  padding: spacing.lg,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ ...typography.h3, color: colors.text }}>
                    {type === 'SHARED_SHUTTLE' ? 'Shared Shuttle' : 'Solo Cab'}
                  </Text>
                  <Text style={{ ...typography.h3, color: colors.text }}>{naira(price.totalAmount)}</Text>
                </View>
                <Text style={{ ...typography.small, color: colors.textMuted }}>
                  {type === 'SHARED_SHUTTLE'
                    ? 'Share the ride and pay less. Great for busy hours.'
                    : 'A cab to yourself, direct to your destination.'}
                </Text>
                <Text style={{ ...typography.small, color: colors.textFaint }}>
                  {naira(price.rideFare)} fare + {naira(price.platformFee)} service fee
                </Text>
              </Pressable>
            );
          })}

          <Button title="Continue" onPress={() => setStep('review')} />
          <Button title="Back" variant="ghost" onPress={() => setStep('dropoff')} />
        </View>
      ) : null}

      {step === 'review' && data && fare ? (
        <View style={{ gap: spacing.md }}>
          <SectionTitle>Review and pay</SectionTitle>
          <Card style={{ gap: spacing.md }}>
            <View style={{ gap: spacing.sm }}>
              <RouteLine label={pickup?.name ?? ''} icon="radio-button-on" />
              <RouteLine label={dropoff?.name ?? ''} icon="location" />
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: spacing.sm,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              }}
            >
              <View>
                <Text style={{ ...typography.bodyStrong, color: colors.text }}>Passengers</Text>
                <Text style={{ ...typography.small, color: colors.textMuted }}>
                  Price is per ride, not per passenger
                </Text>
              </View>
              <Stepper value={passengers} onChange={setPassengers} />
            </View>
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <Row label="Ride type" value={rideType === 'SOLO_QUICK_CAB' ? 'Solo Cab' : 'Shared Shuttle'} />
            <Row label="Ride fare" value={naira(fare.rideFare)} />
            <Row label="Service fee" value={naira(fare.platformFee)} />
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
            <Row label="Total" value={naira(fare.totalAmount)} strong />
          </Card>

          <Button
            title={`Pay ${naira(fare.totalAmount)} with Flutterwave`}
            onPress={pay}
            loading={busy}
            icon="card-outline"
            disabled={!online}
          />
          {!online ? (
            <Text style={{ ...typography.small, color: colors.textMuted, textAlign: 'center' }}>
              Connect to the internet to pay. No booking is confirmed offline.
            </Text>
          ) : null}
          <Button title="Back" variant="ghost" onPress={() => setStep('type')} disabled={busy} />
        </View>
      ) : null}
    </Screen>
  );
}
