import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Card } from '@/components/ui';
import { radius, spacing, typography, useTheme } from '@/lib/theme';
import { dateTime, naira, rideTypeLabel, statusLabel } from '@/lib/format';
import type { Trip, TripStatus } from '@/lib/types';

const statusTone = (status: TripStatus) => {
  switch (status) {
    case 'COMPLETED':
      return 'success' as const;
    case 'CANCELLED':
      return 'danger' as const;
    case 'IN_PROGRESS':
      return 'primary' as const;
    case 'ACCEPTED':
      return 'primary' as const;
    default:
      return 'warning' as const;
  }
};

export function RideCard({ trip, onPress }: { trip: Trip; onPress?: () => void }) {
  const { colors } = useTheme();
  const paid = trip.payment?.status === 'SUCCESSFUL';

  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge label={statusLabel(trip.status)} tone={statusTone(trip.status)} />
        <Text style={{ ...typography.small, color: colors.textFaint }}>{dateTime(trip.createdAt)}</Text>
      </View>

      <View style={{ gap: spacing.sm, marginTop: 2 }}>
        <RouteLine label={trip.pickup} icon="radio-button-on" />
        <View
          style={{
            width: StyleSheet.hairlineWidth * 2,
            height: 14,
            backgroundColor: colors.border,
            marginLeft: 5,
          }}
        />
        <RouteLine label={trip.dropoff} icon="location" />
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: spacing.sm,
        }}
      >
        <Text style={{ ...typography.small, color: colors.textMuted }}>
          {rideTypeLabel(trip.rideType)} · {trip.passengerCount}{' '}
          {trip.passengerCount === 1 ? 'passenger' : 'passengers'}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ ...typography.bodyStrong, color: colors.text }}>{naira(trip.totalFare)}</Text>
          {trip.payment ? (
            <Text
              style={{
                ...typography.small,
                color: paid ? colors.success : colors.textFaint,
              }}
            >
              {paid ? 'Paid' : statusLabel(trip.payment.status)}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

export function RouteLine({ label, icon }: { label: string; icon: 'radio-button-on' | 'location' }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Ionicons name={icon} size={12} color={colors.primary} />
      <Text style={{ ...typography.body, color: colors.text }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const STEPS: Array<{ key: TripStatus; label: string; caption: string }> = [
  { key: 'PENDING', label: 'Booked', caption: 'Looking for a nearby driver' },
  { key: 'ACCEPTED', label: 'Driver assigned', caption: 'Your driver is on the way' },
  { key: 'IN_PROGRESS', label: 'On the way', caption: 'Enjoy your ride' },
  { key: 'COMPLETED', label: 'Completed', caption: 'Ride finished' },
];

export function StatusTimeline({ status }: { status: TripStatus }) {
  const { colors } = useTheme();

  if (status === 'CANCELLED') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="close-circle" size={18} color={colors.danger} />
        <Text style={{ ...typography.bodyStrong, color: colors.danger }}>This ride was cancelled</Text>
      </View>
    );
  }

  const currentIndex = STEPS.findIndex((step) => step.key === status);

  return (
    <View style={{ gap: spacing.md }}>
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step.key} style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ alignItems: 'center', width: 20 }}>
              <View
                style={{
                  width: done || active ? 14 : 10,
                  height: done || active ? 14 : 10,
                  borderRadius: radius.pill,
                  backgroundColor: done ? colors.success : active ? colors.primary : colors.border,
                  marginTop: 4,
                }}
              />
              {index < STEPS.length - 1 ? (
                <View
                  style={{
                    width: StyleSheet.hairlineWidth * 2,
                    flex: 1,
                    minHeight: 26,
                    backgroundColor: done ? colors.success : colors.border,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: index < STEPS.length - 1 ? spacing.sm : 0 }}>
              <Text
                style={{
                  ...typography.bodyStrong,
                  color: active ? colors.text : done ? colors.textMuted : colors.textFaint,
                }}
              >
                {step.label}
              </Text>
              <Text style={{ ...typography.small, color: colors.textFaint }}>{step.caption}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
