import { RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, ErrorBanner, LoadingView, Row, SectionTitle, Screen } from '@/components/ui';
import { RideCard } from '@/components/ride';
import { SosButton } from '@/components/sos-button';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { naira } from '@/lib/format';
import type { LocationsResponse, Trip } from '@/lib/types';
import { spacing, typography, useTheme } from '@/lib/theme';

export default function StudentHome() {
  const { me, refresh } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();

  const trips = useApi<{ trips: Trip[] }>('/api/mobile/trips?scope=active');
  const fares = useApi<LocationsResponse>('/api/mobile/locations');

  const activeTrip = trips.data?.trips[0] ?? null;
  const firstName = me?.user.name.split(' ')[0] ?? 'there';

  const loading = trips.loading && !trips.data;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={trips.refreshing}
          onRefresh={async () => {
            await Promise.all([trips.refresh(), fares.refresh(), refresh()]);
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={{ gap: 2 }}>
        <Text style={{ ...typography.small, color: colors.textMuted }}>Welcome back</Text>
        <Text style={{ ...typography.title, color: colors.text }}>{firstName}</Text>
      </View>

      {trips.error ? <ErrorBanner message={trips.error} onRetry={trips.reload} /> : null}
      {loading ? <LoadingView label="Checking your rides…" /> : null}

      {activeTrip ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>Your active ride</SectionTitle>
          <RideCard trip={activeTrip} onPress={() => router.push(`/ride/${activeTrip.id}`)} />
          <Button
            title="View ride status"
            onPress={() => router.push(`/ride/${activeTrip.id}`)}
            variant="secondary"
            icon="navigate-outline"
          />
        </View>
      ) : null}

      {!loading && !activeTrip ? (
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="car-sport-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.h3, color: colors.text }}>Need a ride?</Text>
              <Text style={{ ...typography.small, color: colors.textMuted }}>
                Book a cab across campus in a few taps.
              </Text>
            </View>
          </View>
          <Button title="Book a ride" onPress={() => router.push('/(student)/book')} icon="add" />
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <SectionTitle>Fares</SectionTitle>
        <Card>
          {fares.loading && !fares.data ? (
            <Text style={{ ...typography.small, color: colors.textMuted }}>Loading fares…</Text>
          ) : fares.data ? (
            <>
              <Row
                label="Solo Cab"
                value={`${naira(fares.data.fares.SOLO_QUICK_CAB.totalAmount)} · fare + ₦${
                  fares.data.fares.SOLO_QUICK_CAB.platformFee
                } fee`}
              />
              <Row
                label="Shared Shuttle"
                value={`${naira(fares.data.fares.SHARED_SHUTTLE.totalAmount)} · fare + ₦${
                  fares.data.fares.SHARED_SHUTTLE.platformFee
                } fee`}
              />
            </>
          ) : (
            <Text style={{ ...typography.small, color: colors.textMuted }}>
              Fares could not be loaded. Pull down to try again.
            </Text>
          )}
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionTitle>Safety</SectionTitle>
        <Card>
          <Text style={{ ...typography.small, color: colors.textMuted }}>
            Share your trip with a friend and use SOS if anything feels wrong. Alerts reach campus
            security with your live location.
          </Text>
          <SosButton />
        </Card>
      </View>
    </Screen>
  );
}
